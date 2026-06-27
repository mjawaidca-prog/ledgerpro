import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { contactUpdateSchema } from '@/lib/validators/contact';

// GET /api/contacts/[id] — single contact
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const contact = await db.contact.findUnique({
      where: { id: params.id, companyId },
      include: {
        invoices: {
          select: { id: true, total: true, status: true, issueDate: true },
          orderBy: { issueDate: 'desc' },
          take: 10,
        },
        bills: {
          select: { id: true, total: true, status: true, billDate: true },
          orderBy: { billDate: 'desc' },
          take: 10,
        },
      },
    });

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    return NextResponse.json({ data: contact });
  } catch (error) {
    console.error('GET /api/contacts/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contact' },
      { status: 500 }
    );
  }
}

// PUT /api/contacts/[id] — update contact
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const parsed = contactUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const existing = await db.contact.findUnique({ where: { id: params.id, companyId } });
    if (!existing) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const contact = await db.contact.update({
      where: { id: params.id },
      data: parsed.data,
    });

    return NextResponse.json({ data: contact });
  } catch (error) {
    console.error('PUT /api/contacts/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to update contact' },
      { status: 500 }
    );
  }
}

// DELETE /api/contacts/[id] — delete contact
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const existing = await db.contact.findUnique({ where: { id: params.id, companyId } });

    if (!existing) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // Check if contact has related invoices or bills — soft-delete instead
    const [invoiceCount, billCount] = await Promise.all([
      db.invoice.count({ where: { customerId: params.id } }),
      db.bill.count({ where: { vendorId: params.id } }),
    ]);

    if (invoiceCount > 0 || billCount > 0) {
      // Soft delete: mark inactive instead
      const contact = await db.contact.update({
        where: { id: params.id },
        data: { status: 'inactive' },
      });
      return NextResponse.json({
        data: contact,
        note: 'Contact has related transactions — marked inactive instead of deleted.',
      });
    }

    await db.contact.delete({ where: { id: params.id } });
    return NextResponse.json({ data: { id: params.id, deleted: true } });
  } catch (error) {
    console.error('DELETE /api/contacts/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to delete contact' },
      { status: 500 }
    );
  }
}
