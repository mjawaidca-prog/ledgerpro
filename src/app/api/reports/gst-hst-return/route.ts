import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { computeGstReturn, defaultGstPeriod, markGstReturnFiled, saveGstAdjustments } from '@/lib/tax/gst-return-service';
import { gstReturnCsv } from '@/lib/tax/gst-return';
import { taxPeriodDate } from '@/lib/tax/workpaper';
import { TaxPostingError } from '@/lib/tax/posting-service';

export const dynamic = 'force-dynamic';

const periodSchema = z.object({ from: taxPeriodDate, to: taxPeriodDate });

const filedSchema = z.object({
  periodStart: taxPeriodDate,
  periodEnd: taxPeriodDate,
  confirmation: z.string().trim().min(1).max(200),
  registrationId: z.string().min(1).optional(),
  createRegistration: z.object({
    registrationNumber: z.string().trim().min(1).max(50),
    filingFrequency: z.enum(['monthly', 'quarterly', 'annual']),
  }).optional(),
}).strict();

const adjustmentItemSchema = z.object({
  amount: z.number().finite().min(0),
  note: z.string().trim().min(1).max(500),
}).strict();

const adjustmentsSchema = z.object({
  periodStart: taxPeriodDate,
  periodEnd: taxPeriodDate,
  adjustments: z.object({
    add: z.array(adjustmentItemSchema).max(50).default([]),
    deduct: z.array(adjustmentItemSchema).max(50).default([]),
    instalments: z.array(adjustmentItemSchema).max(50).default([]),
    rebates: z.array(adjustmentItemSchema).max(50).default([]),
  }).strict(),
  registrationId: z.string().min(1).optional(),
  createRegistration: z.object({
    registrationNumber: z.string().trim().min(1).max(50),
    filingFrequency: z.enum(['monthly', 'quarterly', 'annual']),
  }).optional(),
}).strict();

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;
    const params = req.nextUrl.searchParams;
    const from = params.get('from');
    const to = params.get('to');
    let period: { start: string; end: string };
    if (from && to) {
      const parsed = periodSchema.safeParse({ from, to });
      if (!parsed.success) return NextResponse.json({ error: 'Use valid YYYY-MM-DD dates for from and to.' }, { status: 400 });
      period = { start: from, end: to };
    } else {
      period = await defaultGstPeriod(companyId!);
    }
    const view = await computeGstReturn(companyId!, period.start, period.end);

    if (params.get('format') === 'csv') {
      const company = await db.company.findUnique({ where: { id: companyId! }, select: { name: true } });
      const csv = gstReturnCsv({
        companyName: company?.name ?? 'Company',
        periodStart: view.periodStart,
        periodEnd: view.periodEnd,
        filedLabel: view.filed
          ? `FILED — recorded ${view.filed.filedAt.slice(0, 10)}, confirmation ${view.filed.filingConfirmation ?? ''}`
          : 'NOT FILED — working copy',
        result: view.result,
      });
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="gst-hst-return-${view.periodStart}-to-${view.periodEnd}.csv"`,
        },
      });
    }
    return NextResponse.json({ data: view });
  } catch (e) {
    if (e instanceof TaxPostingError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: 'Failed to compute GST/HST return.' }, { status: 500 });
  }
}

/** Replace the period's simple-path adjustments (lines 104/107/110/111). Owner/admin only. */
export async function PUT(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'], requireOnboarding: true });
    if (error) return error;
    const parsed = adjustmentsSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid adjustments request. Each adjustment needs an amount of $0 or more and a short note.', details: parsed.error.flatten() }, { status: 400 });
    const saved = await saveGstAdjustments({ companyId: companyId!, userId: userId!, ...parsed.data });
    return NextResponse.json({ data: saved });
  } catch (e) {
    if (e instanceof TaxPostingError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: 'Failed to save adjustments.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin', 'bookkeeper'], requireOnboarding: true });
    if (error) return error;
    const parsed = filedSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid mark-as-filed request.', details: parsed.error.flatten() }, { status: 400 });
    const { workpaperId } = await markGstReturnFiled({ companyId: companyId!, userId: userId!, ...parsed.data });
    return NextResponse.json({ data: { workpaperId } }, { status: 201 });
  } catch (e) {
    if (e instanceof TaxPostingError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: 'Failed to record the filing.' }, { status: 500 });
  }
}
