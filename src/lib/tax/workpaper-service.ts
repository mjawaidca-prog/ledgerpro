import { Prisma, TaxRegime, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { calculateWorkpaper, sourceHash, WorkpaperInputs, WorkpaperSource } from './workpaper';
import { TaxPostingError } from './posting-service';

const cents=(value:Prisma.Decimal|number|string)=>{
  const n=new Prisma.Decimal(value).mul(100);
  if(!n.isInteger()||n.abs().greaterThan(Number.MAX_SAFE_INTEGER)) throw new TaxPostingError('invalid_amount','Workpaper source amounts must be exact cents.');
  return n.toNumber();
};
const day=(value:Date)=>value.toISOString().slice(0,10);
const MUTATE:UserRole[]=['owner','admin','bookkeeper'];
const REVIEW:UserRole[]=['owner','admin'];

export async function loadWorkpaperSource(companyId:string,registrationId:string,start:Date,end:Date):Promise<WorkpaperSource>{
  if(start>end) throw new TaxPostingError('invalid_period','Period start must not be after period end.');
  const endExclusive=new Date(end); endExclusive.setUTCDate(endExclusive.getUTCDate()+1);
  const [company,registration,configuration]=await Promise.all([
    db.company.findUnique({where:{id:companyId},select:{id:true,name:true,currency:true}}),
    db.companyTaxRegistration.findFirst({where:{id:registrationId,companyId},select:{id:true,regime:true,registrationNumber:true,province:true,method:true,filingFrequency:true,active:true,validFrom:true,validTo:true,reviewedAt:true}}),
    db.companyTaxConfiguration.findUnique({where:{companyId},include:{gstHstOutputAccount:true,gstHstRecoverableAccount:true,qstOutputAccount:true,qstRecoverableAccount:true,pstRstPayableAccount:true,taxClearingAccount:true}}),
  ]);
  if(!company||!registration) throw new TaxPostingError('registration_not_found','Tax registration not found.',404);
  const blockers:string[]=[];
  if(!configuration?.enabled) blockers.push('The reviewed tax workflow is not enabled for this company.');
  if(!registration.active||!registration.reviewedAt||registration.validFrom>start||(registration.validTo&&registration.validTo<end)) blockers.push('The reviewed registration must be active for the full filing period.');
  const roleAccounts:Record<string,{code:string}|null|undefined>=registration.regime==='gst_hst'
    ?{output:configuration?.gstHstOutputAccount,recovery:configuration?.gstHstRecoverableAccount,clearing:configuration?.taxClearingAccount}
    :registration.regime==='qst'?{output:configuration?.qstOutputAccount,recovery:configuration?.qstRecoverableAccount,clearing:configuration?.taxClearingAccount}
    :{output:configuration?.pstRstPayableAccount,clearing:configuration?.taxClearingAccount};
  const accountCodes=Object.fromEntries(Object.entries(roleAccounts).filter((x):x is [string,{code:string}]=>Boolean(x[1])).map(([k,v])=>[k,v.code]));
  if(!accountCodes.output) blockers.push('The output-tax control account is not mapped.');
  if((registration.regime==='gst_hst'||registration.regime==='qst')&&!accountCodes.recovery) blockers.push('The recoverable-tax control account is not mapped.');
  const income=await db.chartOfAccount.findMany({where:{companyId,type:'income',active:true},select:{code:true}});
  const codes=[...new Set([...Object.values(accountCodes),...income.map(a=>a.code)])];
  const [snapshots,journals,openingLines]=await Promise.all([
    db.documentLineTaxSnapshot.findMany({where:{companyId,taxPointDate:{gte:start,lt:endExclusive}},include:{components:true,posting:{include:{journalEntry:true}}},orderBy:[{taxPointDate:'asc'},{id:'asc'}]}),
    db.journalEntry.findMany({where:{companyId,entryDate:{gte:start,lt:endExclusive},lines:{some:{glAccountCode:{in:codes}}}},include:{lines:{where:{glAccountCode:{in:codes}}},taxPosting:true},orderBy:[{entryDate:'asc'},{id:'asc'}]}),
    db.journalLine.findMany({where:{journalEntry:{companyId,entryDate:{lt:start}},glAccountCode:{in:Object.values(accountCodes)}},select:{glAccountCode:true,debit:true,credit:true}}),
  ]);
  if(snapshots.some(s=>!s.posting)) blockers.push('A tax snapshot is not linked to its source journal and requires review.');
  const roleByCode=new Map<string,'output'|'recovery'|'clearing'|'income'>();
  Object.entries(accountCodes).forEach(([r,c])=>roleByCode.set(c,r as 'output'|'recovery'|'clearing'));
  income.forEach(a=>{if(!roleByCode.has(a.code))roleByCode.set(a.code,'income');});
  return {company,registration:{...registration,regime:registration.regime,province:registration.province},start:day(start),end:day(end),
    sources:snapshots.map(s=>({id:s.id,postingId:s.postingId??`unlinked:${s.id}`,journalId:s.posting?.journalEntryId??'',documentId:s.posting?.journalEntry.sourceId??null,sourceType:s.posting?.journalEntry.sourceType??'unlinked',date:day(s.taxPointDate),direction:s.direction,jurisdiction:s.jurisdiction,treatment:s.treatment,netMinor:cents(s.netHome),homeCurrency:s.homeCurrency,reversalOfId:s.reversalOfId,components:s.components.map(c=>({type:c.type,treatment:c.treatment,outputMinor:cents(c.outputTaxHome),recoveryMinor:cents(c.recoverableTaxHome),nonrecoverableMinor:cents(c.nonrecoverableTaxHome)}))})),
    ledger:journals.flatMap(j=>j.lines.map(l=>({id:l.id,journalId:j.id,date:day(j.entryDate),code:l.glAccountCode,role:roleByCode.get(l.glAccountCode)!,debitMinor:cents(l.debit),creditMinor:cents(l.credit),postingId:j.taxPosting?.id??null,description:l.description??j.description}))),
    opening:openingLines.reduce<Record<string,number>>((a,l)=>{a[l.glAccountCode]=(a[l.glAccountCode]??0)+cents(l.debit)-cents(l.credit);return a;},{}),accountCodes,blockers};
}

export async function calculateCurrent(companyId:string,registrationId:string,start:Date,end:Date,inputs:WorkpaperInputs){
  const source=await loadWorkpaperSource(companyId,registrationId,start,end);
  return {calculated:calculateWorkpaper(source,inputs),sourceHash:sourceHash(source)};
}
async function role(companyId:string,userId:string){return (await db.membership.findUnique({where:{userId_companyId:{userId,companyId}},select:{role:true}}))?.role;}
export async function createWorkpaper(companyId:string,userId:string,registrationId:string,start:Date,end:Date,inputs:WorkpaperInputs){
  if(!MUTATE.includes((await role(companyId,userId))!)) throw new TaxPostingError('insufficient_permissions','Owner, admin, or bookkeeper access is required.',403);
  const {calculated,sourceHash:hash}=await calculateCurrent(companyId,registrationId,start,end,inputs);
  const overlap=await db.taxReturnWorkpaper.findFirst({where:{companyId,registrationId,periodStart:{lte:end},periodEnd:{gte:start},NOT:{periodStart:start,periodEnd:end}},select:{id:true}});
  if(overlap) throw new TaxPostingError('workpaper_period_overlap','This registration already has a workpaper for an overlapping filing period.',409);
  const latest=await db.taxReturnWorkpaper.findFirst({where:{companyId,registrationId,periodStart:start,periodEnd:end},orderBy:{version:'desc'}});
  if(latest&&latest.status!=='filed_recorded') throw new TaxPostingError('workpaper_exists','An open workpaper already exists for this registration and period.',409);
  return db.taxReturnWorkpaper.create({data:{companyId,registrationId,regime:calculated.registration.regime as TaxRegime,periodStart:start,periodEnd:end,version:(latest?.version??0)+1,inputs:inputs as Prisma.InputJsonObject,snapshot:calculated as unknown as Prisma.InputJsonObject,sourceHash:hash,createdById:userId}});
}
export async function getWorkpaper(companyId:string,id:string){
  const saved=await db.taxReturnWorkpaper.findFirst({where:{id,companyId}}); if(!saved)throw new TaxPostingError('workpaper_not_found','Tax workpaper not found.',404);
  const {calculated,sourceHash:hash}=await calculateCurrent(companyId,saved.registrationId,saved.periodStart,saved.periodEnd,saved.inputs as unknown as WorkpaperInputs);
  return {saved,current:calculated,sourceChanged:hash!==saved.sourceHash,currentSourceHash:hash};
}
export async function transitionWorkpaper(companyId:string,userId:string,id:string,action:'save'|'prepare'|'review'|'record_filing'|'reopen',inputs?:WorkpaperInputs,confirmation?:string){
  const memberRole=await role(companyId,userId); if(!MUTATE.includes(memberRole!))throw new TaxPostingError('insufficient_permissions','Owner, admin, or bookkeeper access is required.',403);
  return db.$transaction(async tx=>{
    const saved=await tx.taxReturnWorkpaper.findFirst({where:{id,companyId}}); if(!saved)throw new TaxPostingError('workpaper_not_found','Tax workpaper not found.',404);
    const nextInputs=inputs??saved.inputs as unknown as WorkpaperInputs;
    const {calculated,sourceHash:hash}=await calculateCurrent(companyId,saved.registrationId,saved.periodStart,saved.periodEnd,nextInputs);
    if(action==='save'&&saved.status!=='draft')throw new TaxPostingError('workpaper_locked','Only draft workpapers can be edited.',409);
    if(action==='prepare'&&saved.status!=='draft')throw new TaxPostingError('invalid_status','Only a draft can be prepared.',409);
    if((action==='prepare'||action==='review')&&calculated.blockers.length)throw new TaxPostingError('workpaper_not_reconciled',calculated.blockers.join(' '),409);
    if(action==='review'&&(saved.status!=='prepared'||!REVIEW.includes(memberRole!)))throw new TaxPostingError('review_not_allowed','An owner or admin may review a prepared workpaper.',403);
    if(action==='review'&&hash!==saved.sourceHash)throw new TaxPostingError('workpaper_source_changed','Source data changed after preparation. Reopen, refresh, and prepare the workpaper again.',409);
    if(action==='record_filing'&&(saved.status!=='reviewed'||!REVIEW.includes(memberRole!)||!(confirmation?.trim().length&&confirmation.trim().length<=200)))throw new TaxPostingError('filing_not_allowed','An owner or admin must provide the external filing confirmation for a reviewed workpaper.',409);
    if(action==='record_filing'&&hash!==saved.sourceHash)throw new TaxPostingError('workpaper_source_changed','Source data changed after review. Reopen and prepare a refreshed workpaper before recording filing.',409);
    if(action==='reopen'&&(!REVIEW.includes(memberRole!)||!['prepared','reviewed'].includes(saved.status)))throw new TaxPostingError('reopen_not_allowed','An owner or admin may reopen a prepared or reviewed workpaper.',403);
    const status=action==='prepare'?'prepared':action==='review'?'reviewed':action==='record_filing'?'filed_recorded':action==='reopen'?'draft':saved.status;
    const result=await tx.taxReturnWorkpaper.update({where:{id},data:{inputs:nextInputs as Prisma.InputJsonObject,snapshot:calculated as unknown as Prisma.InputJsonObject,sourceHash:hash,status,preparedById:action==='prepare'?userId:action==='reopen'?null:undefined,reviewedById:action==='review'?userId:action==='reopen'?null:undefined,reviewedAt:action==='review'?new Date():action==='reopen'?null:undefined,filingConfirmation:action==='record_filing'?confirmation!.trim():undefined,filedAt:action==='record_filing'?new Date():undefined}});
    await tx.auditLog.create({data:{companyId,userId,action:`tax.workpaper.${action}`,entityType:'TaxReturnWorkpaper',entityId:id,metadata:{status,sourceHash:hash}}}); return result;
  });
}
