import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { createWorkpaper } from '@/lib/tax/workpaper-service';
import { taxPeriodDate,workpaperInputs } from '@/lib/tax/workpaper';
import { TaxPostingError } from '@/lib/tax/posting-service';
export const dynamic='force-dynamic';
const createSchema=z.object({registrationId:z.string().min(1),periodStart:taxPeriodDate,periodEnd:taxPeriodDate,inputs:workpaperInputs}).strict();
export async function GET(req:NextRequest){const {companyId,error}=await requireCompany(req);if(error)return error;const [workpapers,registrations]=await Promise.all([db.taxReturnWorkpaper.findMany({where:{companyId},orderBy:[{periodEnd:'desc'},{createdAt:'desc'}]}),db.companyTaxRegistration.findMany({where:{companyId,active:true},orderBy:[{regime:'asc'},{validFrom:'desc'}]})]);return NextResponse.json({data:{workpapers,registrations}});}
export async function POST(req:NextRequest){try{const {companyId,userId,error}=await requireCompany(req,{roles:['owner','admin','bookkeeper'],requireOnboarding:true});if(error)return error;const parsed=createSchema.safeParse(await req.json());if(!parsed.success)return NextResponse.json({error:'Invalid tax workpaper request.',details:parsed.error.flatten()},{status:400});const x=parsed.data;return NextResponse.json({data:await createWorkpaper(companyId!,userId!,x.registrationId,new Date(x.periodStart+'T00:00:00Z'),new Date(x.periodEnd+'T00:00:00Z'),x.inputs)},{status:201});}catch(e){if(e instanceof TaxPostingError)return NextResponse.json({error:e.message,code:e.code},{status:e.status});if(e instanceof Error&&e.message.includes('Unique constraint'))return NextResponse.json({error:'A workpaper already exists for this registration and period.'},{status:409});console.error(e);return NextResponse.json({error:'Failed to create tax workpaper.'},{status:500});}}
