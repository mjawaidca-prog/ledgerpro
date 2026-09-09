import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCompany } from '@/lib/api-helpers';
import { getWorkpaper,transitionWorkpaper } from '@/lib/tax/workpaper-service';
import { workpaperInputs } from '@/lib/tax/workpaper';
import { TaxPostingError } from '@/lib/tax/posting-service';
export const dynamic='force-dynamic';
const update=z.object({action:z.enum(['save','prepare','review','record_filing','reopen']),inputs:workpaperInputs.optional(),confirmation:z.string().trim().max(200).optional()}).strict();
const fail=(e:unknown)=>e instanceof TaxPostingError?NextResponse.json({error:e.message,code:e.code},{status:e.status}):(console.error(e),NextResponse.json({error:'Tax workpaper request failed.'},{status:500}));
export async function GET(req:NextRequest,{params}:{params:{id:string}}){try{const {companyId,error}=await requireCompany(req);if(error)return error;return NextResponse.json({data:await getWorkpaper(companyId!,params.id)});}catch(e){return fail(e);}}
export async function PATCH(req:NextRequest,{params}:{params:{id:string}}){try{const {companyId,userId,error}=await requireCompany(req,{roles:['owner','admin','bookkeeper']});if(error)return error;const parsed=update.safeParse(await req.json());if(!parsed.success)return NextResponse.json({error:'Invalid workpaper update.',details:parsed.error.flatten()},{status:400});return NextResponse.json({data:await transitionWorkpaper(companyId!,userId!,params.id,parsed.data.action,parsed.data.inputs,parsed.data.confirmation)});}catch(e){return fail(e);}}
