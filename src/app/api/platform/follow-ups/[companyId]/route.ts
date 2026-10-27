import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePlatformAdmin, platformAudit } from '@/lib/platform/auth';
import { isValidFollowUpStatus, buildFollowUpEmailDraft } from '@/lib/platform/rollup';
import { serializeFollowUp, latestSubscriptionsByCompany } from '@/lib/platform/subscribers';
export const dynamic = 'force-dynamic';

// GET — the follow-up for one company (null when none exists yet) plus a
// copyable / mailto email draft. There is NO send endpoint by design (CC-3).
export async function GET(_req: NextRequest, { params }: { params: { companyId: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const company = await db.company.findUnique({ where: { id: params.companyId }, select: { id: true, name: true } });
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  const [followUp, ownerMembership, subByCompany] = await Promise.all([
    (db as any).subscriberFollowUp.findUnique({ where: { companyId: params.companyId } }).catch(() => null),
    db.membership.findFirst({ where: { companyId: params.companyId, role: 'owner' }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'asc' } }),
    latestSubscriptionsByCompany(),
  ]);
  const sub: any = subByCompany.get(params.companyId);
  const draft = buildFollowUpEmailDraft({
    companyName: company.name, contactName: ownerMembership?.user?.name ?? null,
    email: ownerMembership?.user?.email ?? null,
    trialEndsAt: sub?.trialEndsAt ? new Date(sub.trialEndsAt).toISOString().slice(0, 10) : null,
  });
  return NextResponse.json({ data: { company, followUp: followUp ? serializeFollowUp(followUp) : null, contact: ownerMembership?.user ?? null, emailDraft: draft } });
}

// PUT — create or update the follow-up (status workflow, note, dates,
// assignee, opt-out). Every write is platform-audited. Opt-out is a flag the
// admin sets from a contact's request; it never deletes history.
export async function PUT(req: NextRequest, { params }: { params: { companyId: string } }) {
  const { ctx, error } = await requirePlatformAdmin();
  if (error) return error;
  const company = await db.company.findUnique({ where: { id: params.companyId }, select: { id: true, name: true } });
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  if (body.status !== undefined && !isValidFollowUpStatus(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const parseDate = (v: unknown) => {
    if (v === null || v === '') return null;
    if (typeof v !== 'string') return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const nextFollowUpAt = body.nextFollowUpAt !== undefined ? parseDate(body.nextFollowUpAt) : undefined;
  const lastContactedAt = body.lastContactedAt !== undefined ? parseDate(body.lastContactedAt) : undefined;
  if (nextFollowUpAt === undefined && body.nextFollowUpAt !== undefined && body.nextFollowUpAt !== null && body.nextFollowUpAt !== '') return NextResponse.json({ error: 'Invalid nextFollowUpAt' }, { status: 400 });
  if (lastContactedAt === undefined && body.lastContactedAt !== undefined && body.lastContactedAt !== null && body.lastContactedAt !== '') return NextResponse.json({ error: 'Invalid lastContactedAt' }, { status: 400 });

  const existing = await (db as any).subscriberFollowUp.findUnique({ where: { companyId: params.companyId } }).catch(() => null);
  const historyEntry = { at: new Date().toISOString(), byUserId: ctx!.userId, action: existing ? 'update' : 'create', status: body.status ?? existing?.status ?? 'new', note: typeof body.note === 'string' ? body.note.slice(0, 500) : undefined, contactOptOut: typeof body.contactOptOut === 'boolean' ? body.contactOptOut : undefined };
  const history = [...(Array.isArray(existing?.history) ? existing.history : []), historyEntry].slice(-100);

  const data: any = {
    status: body.status ?? existing?.status ?? 'new',
    note: typeof body.note === 'string' ? body.note.slice(0, 5000) : (existing?.note ?? null),
    contactOptOut: typeof body.contactOptOut === 'boolean' ? body.contactOptOut : (existing?.contactOptOut ?? false),
    assignedAdminId: body.assignedAdminId === undefined ? (existing?.assignedAdminId ?? ctx!.userId) : (body.assignedAdminId || null),
    history,
  };
  if (nextFollowUpAt !== undefined) data.nextFollowUpAt = nextFollowUpAt;
  if (lastContactedAt !== undefined) data.lastContactedAt = lastContactedAt;

  const saved = existing
    ? await (db as any).subscriberFollowUp.update({ where: { companyId: params.companyId }, data })
    : await (db as any).subscriberFollowUp.create({ data: { companyId: params.companyId, createdById: ctx!.userId, ...data } });

  await platformAudit({ adminUserId: ctx!.userId, action: existing ? 'follow_up.update' : 'follow_up.create', targetType: 'subscriber_follow_up', targetId: saved.id, companyId: params.companyId, metadata: { status: saved.status, contactOptOut: saved.contactOptOut } });
  return NextResponse.json({ data: serializeFollowUp(saved) });
}
