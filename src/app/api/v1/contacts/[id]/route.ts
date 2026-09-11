import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { moneyString, isoDate } from '@/lib/api/serialize';
import { contactUpdateSchema, validationErrorResponse } from '@/lib/api/validation';
import { auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// GET /api/v1/contacts/[id] — one contact, scoped to the key's company.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const contact = await db.contact.findFirst({ where: { id: params.id, companyId: context!.companyId } });
  if (!contact) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Contact not found.' } }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      id: contact.id,
      name: contact.name,
      companyName: contact.companyName,
      type: contact.type,
      email: contact.email,
      phone: contact.phone,
      address: contact.address,
      currency: contact.currency,
      outstandingBalance: moneyString(contact.outstandingBalance),
      status: contact.status,
      notes: contact.notes,
      createdAt: isoDate(contact.createdAt),
      updatedAt: isoDate(contact.updatedAt),
    },
  });
}

// PATCH /api/v1/contacts/[id] — update editable fields (write_draft).
// PATCH replays are naturally safe (same fields re-applied); no idempotency
// key required, but the request is still scoped to the key's company.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'write_draft' });
  if (error) return error;

  const parsed = contactUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'No fields to update.', fields: { _: 'Provide at least one field.' } } },
      { status: 400 }
    );
  }

  const existing = await db.contact.findFirst({
    where: { id: params.id, companyId: context!.companyId },
    select: { id: true, name: true, currency: true },
  });
  if (!existing) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Contact not found.' } }, { status: 404 });
  }

  const currency = parsed.data.currency ?? existing.currency;
  const updated = await db.contact.update({
    where: { id: params.id },
    data: {
      name: parsed.data.name ?? undefined,
      companyName: parsed.data.companyName === undefined ? undefined : parsed.data.companyName,
      email: parsed.data.email === undefined ? undefined : parsed.data.email,
      phone: parsed.data.phone === undefined ? undefined : parsed.data.phone,
      address: parsed.data.address === undefined ? undefined : parsed.data.address,
      currency,
      notes: parsed.data.notes === undefined ? undefined : parsed.data.notes,
    },
    select: { id: true, name: true, currency: true },
  });

  await auditLog(context!.companyId, undefined, 'api.contact.update', 'contact', updated.id, undefined, {
    apiKeyId: context!.apiKeyId,
    apiKeyName: context!.apiKeyName,
  });

  return NextResponse.json({ data: { id: updated.id, name: updated.name, currency: updated.currency } });
}
