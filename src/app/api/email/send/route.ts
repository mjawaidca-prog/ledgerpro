import { NextRequest, NextResponse } from 'next/server';
import { sendInvoice } from '@/lib/email';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json();
    const { invoiceId } = body;

    if (!invoiceId) {
      return NextResponse.json(
        { error: 'invoiceId is required' },
        { status: 400 }
      );
    }

    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId, companyId },
      include: { customer: true },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    if (!invoice.customer?.email) {
      return NextResponse.json(
        { error: 'Customer has no email address on file' },
        { status: 400 }
      );
    }

    const result = await sendInvoice(
      invoice.customer.email,
      invoice.id,
      invoice.customer.name,
      Number(invoice.total),
      invoice.dueDate.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    );

    // Update invoice: mark as sent
    await db.invoice.update({
      where: { id: invoiceId, companyId },
      data: {
        status: 'sent',
        sentAt: new Date(),
      },
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('POST /api/email/send error:', error);
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    );
  }
}
