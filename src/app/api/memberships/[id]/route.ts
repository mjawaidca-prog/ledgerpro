import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { z } from 'zod';

const updateSchema = z.object({
  role: z.enum(['owner', 'admin', 'bookkeeper', 'viewer']),
});

// PUT /api/memberships/[id] — update a member's role
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;

    const membershipId = params.id;

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Find the membership
    const membership = await db.membership.findUnique({
      where: { id: membershipId },
      include: { user: { select: { name: true } } },
    });
    if (!membership || membership.companyId !== companyId) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    }

    // Prevent owners from demoting themselves (the last owner)
    if (membership.userId === userId && membership.role === 'owner' && parsed.data.role !== 'owner') {
      const ownerCount = await db.membership.count({
        where: { companyId, role: 'owner' },
      });
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot change role — you are the last owner of this company.' },
          { status: 403 }
        );
      }
    }

    // Only owners can promote to owner
    if (parsed.data.role === 'owner') {
      const currentUserMembership = await db.membership.findUnique({
        where: { userId_companyId: { userId: userId!, companyId } },
      });
      if (currentUserMembership?.role !== 'owner') {
        return NextResponse.json(
          { error: 'Only owners can promote members to owner.' },
          { status: 403 }
        );
      }
    }

    const updated = await db.membership.update({
      where: { id: membershipId },
      data: { role: parsed.data.role },
      include: { user: { select: { name: true, email: true } } },
    });

    await auditLog(companyId, userId, 'membership.update', 'membership', membershipId, {
      previousRole: membership.role,
      newRole: updated.role,
      memberName: updated.user.name,
    });

    return NextResponse.json({
      data: {
        id: updated.id,
        userId: updated.userId,
        userName: updated.user.name,
        userEmail: updated.user.email,
        role: updated.role,
      },
    });
  } catch (error) {
    console.error('PUT /api/memberships/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update membership' }, { status: 500 });
  }
}

// DELETE /api/memberships/[id] — remove a member from the company
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;

    const membershipId = params.id;

    const membership = await db.membership.findUnique({
      where: { id: membershipId },
      include: { user: { select: { name: true } } },
    });
    if (!membership || membership.companyId !== companyId) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    }

    // Prevent removing the last owner
    if (membership.role === 'owner') {
      const ownerCount = await db.membership.count({
        where: { companyId, role: 'owner' },
      });
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last owner. Transfer ownership first.' },
          { status: 403 }
        );
      }
    }

    // Cannot remove yourself unless you're not the last owner
    if (membership.userId === userId) {
      const otherOwners = await db.membership.count({
        where: { companyId, role: 'owner', userId: { not: userId! } },
      });
      if (membership.role === 'owner' && otherOwners === 0) {
        return NextResponse.json(
          { error: 'Cannot remove yourself as the last owner.' },
          { status: 403 }
        );
      }
    }

    await db.membership.delete({ where: { id: membershipId } });

    await auditLog(companyId, userId, 'membership.delete', 'membership', membershipId, {
      removedUser: membership.user.name,
      removedRole: membership.role,
    });

    return NextResponse.json({ data: { removed: true } });
  } catch (error) {
    console.error('DELETE /api/memberships/[id] error:', error);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}
