import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { sendInvoice } from '@/lib/email';
export const dynamic = 'force-dynamic';

// POST /api/send — send an invoice via email
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json();
    const { invoiceId, to } = body;

    if (!invoiceId || !to) {
      return NextResponse.json({ error: 'invoiceId and to email are required' }, { status: 400 });
    }

    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!invoice || invoice.companyId !== companyId) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { name: true, legalName: true },
    });

    const customerName = invoice.customer?.name || 'Customer';
    const total = Number(invoice.total);
    const dueDate = new Date(invoice.dueDate).toLocaleDateString();

    const result = await sendInvoice(to, invoiceId, customerName, total, dueDate, company?.name);

    // Mark invoice as sent
    await db.invoice.update({
      where: { id: invoiceId },
      data: { status: 'sent', sentAt: new Date() },
    });

    await auditLog(companyId, userId, 'invoice.email_sent', 'invoice', invoiceId, null, { to, emailId: result.messageId });

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('POST /api/send error:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
