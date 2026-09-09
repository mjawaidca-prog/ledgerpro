import {calculateWorkpaper,csvCell,workpaperCsv,WorkpaperSource} from '@/lib/tax/workpaper';

const source=():WorkpaperSource=>({
 company:{id:'c',name:'Synthetic Ontario filer',currency:'CAD'},registration:{id:'r',regime:'gst_hst',registrationNumber:'SYNTHETIC',province:'ON',method:'regular',filingFrequency:'quarterly'},start:'2026-01-01',end:'2026-03-31',blockers:[],
 accountCodes:{output:'2300',recovery:'1300',clearing:'2310'},opening:{'2300':0,'1300':0,'2310':0},
 sources:[
  {id:'sale',postingId:'ps',journalId:'js',documentId:'i',sourceType:'invoice',date:'2026-01-15',direction:'sale',jurisdiction:'ON',treatment:'taxable',netMinor:100000,homeCurrency:'CAD',reversalOfId:null,components:[{type:'hst',treatment:'taxable',outputMinor:13000,recoveryMinor:0,nonrecoverableMinor:0}]},
  {id:'buy',postingId:'pb',journalId:'jb',documentId:'b',sourceType:'bill',date:'2026-02-01',direction:'purchase',jurisdiction:'ON',treatment:'taxable',netMinor:40000,homeCurrency:'CAD',reversalOfId:null,components:[{type:'hst',treatment:'taxable',outputMinor:0,recoveryMinor:5200,nonrecoverableMinor:0}]},
 ],
 ledger:[
  {id:'lo',journalId:'js',date:'2026-01-15',code:'2300',role:'output',debitMinor:0,creditMinor:13000,postingId:'ps',description:'HST sale'},
  {id:'lr',journalId:'jb',date:'2026-02-01',code:'1300',role:'recovery',debitMinor:5200,creditMinor:0,postingId:'pb',description:'HST ITC'},
 ]
});
const input={classifications:[],periodEvidence:'Synthetic test reconciliation',reviewNote:''};
test('calculates an ordinary GST/HST regular-method workpaper exactly',()=>{const w=calculateWorkpaper(source(),input);expect(w.lines).toMatchObject({'101':100000,'103':13000,'105':13000,'106':5200,'108':5200,'109':7800,'113C':7800,'115':7800});expect(w.blockers).toEqual([]);expect(w.reconciled).toBe(true);});
test('rounds line 101 to whole dollars while retaining exact source revenue',()=>{const s=source();s.sources[0].netMinor=100050;const w=calculateWorkpaper(s,input);expect(w.revenueMinor).toBe(100050);expect(w.lines['101']).toBe(100100);});
test('requires evidence-backed classification for manual tax lines',()=>{const s=source();s.ledger.push({id:'manual',journalId:'jm',date:'2026-03-15',code:'2300',role:'output',debitMinor:0,creditMinor:100,postingId:null,description:'Adjustment'});expect(calculateWorkpaper(s,input).blockers[0]).toContain('require classification');const w=calculateWorkpaper(s,{...input,classifications:[{lineId:'manual',treatment:'line104',reason:'Reviewed taxable adjustment',evidence:'Journal JM support'}]});expect(w.lines['104']).toBe(100);expect(w.lines['109']).toBe(7900);expect(w.blockers).toEqual([]);});
test('blocks offsetting snapshot-to-ledger errors at the posting level',()=>{const s=source();s.ledger[0].creditMinor-=100;s.ledger[1].debitMinor-=100;expect(calculateWorkpaper(s,input).blockers).toContain('Tax snapshots do not reconcile to the mapped GL accounts for one or more postings.');});
test('keeps QST as a separate supporting schedule',()=>{const s=source();s.registration.regime='qst';s.registration.province='QC';s.sources[0].jurisdiction='QC';s.sources[0].components=[{type:'qst',treatment:'taxable',outputMinor:9975,recoveryMinor:0,nonrecoverableMinor:0}];s.sources[1].jurisdiction='QC';s.sources[1].components=[{type:'qst',treatment:'taxable',outputMinor:0,recoveryMinor:3990,nonrecoverableMinor:0}];s.ledger[0].creditMinor=9975;s.ledger[1].debitMinor=3990;const w=calculateWorkpaper(s,input);expect(w.scheduleOnly).toBe(true);expect(w.netTaxMinor).toBe(5985);});
test('exports a frozen labelled CSV and neutralizes spreadsheet formulas',()=>{const w=calculateWorkpaper(source(),input);expect(workpaperCsv(w,'draft',null)).toContain('NOT FILED');expect(csvCell('=cmd')).toBe('"\'=cmd"');expect(csvCell(-25)).toBe('"-25"');});
