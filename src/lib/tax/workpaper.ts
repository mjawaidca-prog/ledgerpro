import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isTaxDate } from './date';

export const taxPeriodDate = z.string().refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && isTaxDate(value), 'Use a valid YYYY-MM-DD date.');
export const workpaperInputs = z.object({
  classifications: z.array(z.object({
    lineId: z.string().min(1),
    treatment: z.enum(['line101', 'line103', 'line104', 'line106', 'line107', 'line110', 'reconciliation_only']),
    reason: z.string().trim().min(5).max(2000),
    evidence: z.string().trim().min(3).max(2000),
  }).strict()).max(1000).default([]),
  periodEvidence: z.string().trim().min(5).max(2000),
  reviewNote: z.string().trim().max(2000).default(''),
}).strict();
export type WorkpaperInputs = z.infer<typeof workpaperInputs>;
export interface SourceLine {
  id: string; postingId: string; journalId: string; documentId: string | null; sourceType: string;
  date: string; direction: string; jurisdiction: string; treatment: string;
  netMinor: number; homeCurrency: string; reversalOfId: string | null;
  components: { type: string; treatment: string; outputMinor: number; recoveryMinor: number; nonrecoverableMinor: number }[];
}
export interface LedgerLine {
  id: string; journalId: string; date: string; code: string; role: 'output' | 'recovery' | 'clearing' | 'income';
  debitMinor: number; creditMinor: number; postingId: string | null; description: string;
}
export interface WorkpaperSource {
  company: { id: string; name: string; currency: string };
  registration: { id: string; regime: string; registrationNumber: string; province: string | null; method: string; filingFrequency: string };
  start: string; end: string; sources: SourceLine[]; ledger: LedgerLine[];
  opening: Record<string, number>; accountCodes: Record<string, string>;
  blockers: string[];
}
export function sourceHash(source: WorkpaperSource): string {
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}
export const safeSum = (values: number[]): number => {
  const total = values.reduce((sum, n) => sum + BigInt(n), BigInt(0));
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Workpaper exceeds supported exact amount range.');
  return Number(total);
};

export function calculateWorkpaper(source: WorkpaperSource, input: WorkpaperInputs) {
  const blockers = [...source.blockers];
  if (source.company.currency !== 'CAD' || source.sources.some(s => s.homeCurrency !== 'CAD')) blockers.push('CAD filing reconciliation is required. Non-CAD home ledgers are outside this workpaper release.');
  if (source.registration.method !== 'regular') blockers.push('Only the regular method is supported.');
  const regime = source.registration.regime;
  const matches = (kind: string, province: string) => regime === 'gst_hst' ? ['gst','hst'].includes(kind) : kind === regime && (regime === 'qst' || province === source.registration.province);
  const selected = source.sources.flatMap(s => s.components.filter(c => matches(c.type,s.jurisdiction)).map(c => ({ ...c, snapshotId: s.id })));
  const outputMinor = safeSum(selected.map(c => c.outputMinor));
  const recoveryMinor = safeSum(selected.map(c => c.recoveryMinor));
  const revenueMinor = safeSum(source.sources.filter(s => s.direction === 'sale' && s.treatment !== 'out_of_scope' && (regime === 'gst_hst' || s.components.some(c => matches(c.type,s.jurisdiction)))).map(s => s.netMinor));
  const lines: Record<string,number> = { '101': revenueMinor, '103': outputMinor, '104':0, '106':recoveryMinor, '107':0, '110':0 };
  const byId = new Map(source.ledger.map(l => [l.id,l]));
  const used = new Set<string>();
  for (const c of input.classifications) {
    const l = byId.get(c.lineId);
    if (!l || l.postingId || used.has(c.lineId)) { blockers.push(`Invalid or duplicate manual classification ${c.lineId}.`); continue; }
    used.add(c.lineId);
    if (c.treatment === 'reconciliation_only') continue;
    const code = c.treatment.slice(4);
    const allowed = code === '101' ? l.role === 'income' : code === '110' ? l.role === 'clearing' : l.role === 'output' || l.role === 'recovery';
    if (!allowed) { blockers.push(`Journal line ${l.id} cannot be assigned to ${c.treatment}.`); continue; }
    const value = ['106','107','110'].includes(code) ? l.debitMinor-l.creditMinor : l.creditMinor-l.debitMinor;
    lines[code] = safeSum([lines[code],value]);
  }
  // CRA line 101 is reported to the nearest whole dollar; retain revenueMinor
  // below so the source schedule still shows the exact ledger amount.
  lines['101']=Math.sign(lines['101'])*Math.floor((Math.abs(lines['101'])+50)/100)*100;
  const unclassified = source.ledger.filter(l => !l.postingId && !used.has(l.id));
  if (unclassified.length) blockers.push(`${unclassified.length} manual or legacy ledger line(s) require classification and supporting evidence.`);
  // Reconcile each posting separately so two wrong documents cannot cancel out.
  const postingChecks = [...new Set(source.sources.map(s=>s.postingId))].map(id => {
    const ss=source.sources.filter(s=>s.postingId===id);
    const cs=ss.flatMap(s=>s.components.filter(c=>matches(c.type,s.jurisdiction)));
    const gl=source.ledger.filter(l=>l.postingId===id);
    const expectedOutput=safeSum(cs.map(c=>c.outputMinor));
    const expectedRecovery=safeSum(cs.map(c=>c.recoveryMinor));
    const output=safeSum(gl.filter(l=>l.role==='output').map(l=>l.creditMinor-l.debitMinor));
    const recovery=safeSum(gl.filter(l=>l.role==='recovery').map(l=>l.debitMinor-l.creditMinor));
    return { postingId:id, outputDifferenceMinor:output-expectedOutput, recoveryDifferenceMinor:recovery-expectedRecovery };
  });
  if (postingChecks.some(c=>c.outputDifferenceMinor || c.recoveryDifferenceMinor)) blockers.push('Tax snapshots do not reconcile to the mapped GL accounts for one or more postings.');
  if (source.ledger.some(l=>l.postingId && !source.sources.some(s=>s.postingId===l.postingId))) blockers.push('A tax journal in the period has missing or differently dated source snapshots.');
  if (selected.some(c=>c.treatment==='legacy_unclassified') || source.sources.some(s=>s.treatment==='legacy_unclassified')) blockers.push('Unclassified tax treatment requires review.');
  lines['105']=safeSum([lines['103'],lines['104']]);
  lines['108']=safeSum([lines['106'],lines['107']]);
  lines['109']=safeSum([lines['105'],-lines['108']]);
  lines['112']=lines['110']; // Rebates and self-assessment are explicitly outside this release.
  lines['113A']=safeSum([lines['109'],-lines['112']]);
  lines['113B']=0; lines['113C']=lines['113A'];
  lines['114']=Math.max(0,-lines['113C']); lines['115']=Math.max(0,lines['113C']);
  if (['101','103','104','106','107','110'].some(k=>lines[k]<0)) blockers.push('Negative return input requires accountant treatment outside the supported ordinary return workflow.');
  const balances = Object.entries(source.accountCodes).map(([role,code])=> {
    const openingMinor=source.opening[code]??0;
    const movementMinor=safeSum(source.ledger.filter(l=>l.code===code).map(l=>l.debitMinor-l.creditMinor));
    return {role,code,openingMinor,movementMinor,closingMinor:safeSum([openingMinor,movementMinor])};
  });
  return { schemaVersion:1, ...source, inputs:input, lines, outputMinor,recoveryMinor,revenueMinor,
    netTaxMinor:lines['109'], balanceDueMinor:lines['113C'],
    scheduleOnly:regime!=='gst_hst', postingChecks, balances, unclassified,
    blockers:[...new Set(blockers)], reconciled:blockers.length===0 };
}
export type CalculatedWorkpaper=ReturnType<typeof calculateWorkpaper>;
export function csvCell(value: unknown): string {
  let s=String(value??'');
  if (typeof value==='string' && /^[\s]*[=+@-]/.test(s)) s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
export function workpaperCsv(w: CalculatedWorkpaper, status: string, confirmation: string | null): string {
  const rows:unknown[][]=[['LedgerPro tax workpaper',status==='filed_recorded'?'EXTERNAL FILING RECORDED':'NOT FILED'],['Company',w.company.name],['Registration',w.registration.registrationNumber],['Regime',w.registration.regime],['Period',w.start,w.end],['Filing confirmation',confirmation??''],['Amounts','CAD'],['Blockers',w.blockers.join(' | ')],['Schedule',w.scheduleOnly?'Supporting schedule only; not a provincial return form':'Regular GST/HST'],[],['Return line','CAD amount']];
  if (!w.scheduleOnly) Object.entries(w.lines).forEach(([k,v])=>rows.push([k,(v/100).toFixed(2)]));
  else rows.push(['Output tax',(w.outputMinor/100).toFixed(2)],['Recoverable tax',(w.recoveryMinor/100).toFixed(2)],['Net with reviewed adjustments',(w.netTaxMinor/100).toFixed(2)]);
  rows.push([],['Control role','Account','Opening debit balance','Movement debit balance','Closing debit balance']);
  w.balances.forEach(b=>rows.push([b.role,b.code,b.openingMinor/100,b.movementMinor/100,b.closingMinor/100]));
  rows.push([],['Snapshot','Document','Journal','Tax date','Direction','Province','Net CAD','Component','Treatment','Output CAD','Recoverable CAD','Nonrecoverable CAD','Reversal of']);
  w.sources.forEach(s=>s.components.forEach(c=>rows.push([s.id,s.documentId,s.journalId,s.date,s.direction,s.jurisdiction,s.netMinor/100,c.type,c.treatment,c.outputMinor/100,c.recoveryMinor/100,c.nonrecoverableMinor/100,s.reversalOfId])));
  rows.push([],['Journal line','Journal','Date','Account','Debit CAD','Credit CAD','Classification','Reason','Evidence']);
  w.ledger.forEach(l=>{const c=w.inputs.classifications.find(c=>c.lineId===l.id);rows.push([l.id,l.journalId,l.date,l.code,l.debitMinor/100,l.creditMinor/100,c?.treatment??'source posting',c?.reason,c?.evidence]);});
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
