import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import {
  createRelatedPartyLink,
  getRelatedPartyLinks,
} from '@/lib/intercompany/link';
export const dynamic = 'force-dynamic';

// GET — list related-party links visible to the current user
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await requireCompany(req);
    if (error) return error;

    const links = await getRelatedPartyLinks(userId!);

    return NextResponse.json({ data: links });
  } catch (error: any) {
    console.error('GET /api/related-parties error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch related parties' },
      { status: 500 }
    );
  }
}

// POST — declare a related-party link between two companies
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      roles: ['owner', 'admin'],
      requireOnboarding: true,
    });
    if (error) return error;

    const body = await req.json();
    const { companyX, companyY } = body as {
      companyX: string;
      companyY: string;
    };

    if (!companyX || !companyY) {
      return NextResponse.json(
        { error: 'Both company IDs are required' },
        { status: 400 }
      );
    }

    if (companyX === companyY) {
      return NextResponse.json(
        { error: 'Cannot link a company to itself' },
        { status: 400 }
      );
    }

    const link = await createRelatedPartyLink(userId!, companyX, companyY);

    await auditLog(companyId, userId, 'related_party.create', 'RelatedPartyLink', link.id, {
      companyA: companyX,
      companyB: companyY,
    } as any);

    return NextResponse.json({ data: link }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/related-parties error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create related-party link' },
      { status: 500 }
    );
  }
}
