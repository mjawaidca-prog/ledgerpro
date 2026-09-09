import { NextRequest,NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { getWorkpaper } from '@/lib/tax/workpaper-service';
import { workpaperCsv } from '@/lib/tax/workpaper';
import { TaxPostingError } from '@/lib/tax/posting-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:{id:string}}){try{const {companyId,error}=await requireCompany(req);if(error)return error;const data=await getWorkpaper(companyId!,params.id);const frozen=data.saved.snapshot as unknown as typeof data.current;return new NextResponse(workpaperCsv(frozen,data.saved.status,data.saved.filingConfirmation),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="tax-workpaper-${frozen.registration.regime}-${frozen.start}-${frozen.end}-v${data.saved.version}.csv"`,'Cache-Control':'no-store'}});}catch(e){if(e instanceof TaxPostingError)return NextResponse.json({error:e.message},{status:e.status});return NextResponse.json({error:'Failed to export workpaper.'},{status:500});}}
