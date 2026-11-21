import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { answerQuestion, libraryForDisplay } from '@/lib/ask/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/ask-books
 * The question library: the fixed set of questions the grounded
 * question box can answer, with examples (drives the page's chips).
 *
 * POST /api/reports/ask-books  { question }
 * Answer one question from the library over the company's computed
 * report figures — or refuse honestly, with the library, when the
 * question is outside it. Every question is audit-logged per company
 * (question, intent, parameters, timestamp — never amounts).
 */
export async function GET(req: NextRequest) {
  try {
    const { error } = await requireCompany(req);
    if (error) return error;
    return NextResponse.json({ data: { library: libraryForDisplay() } });
  } catch (error) {
    console.error('GET /api/reports/ask-books error:', error);
    return NextResponse.json({ error: 'Failed to load the question library' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json().catch(() => null);
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (question.length < 3) {
      return NextResponse.json({ error: 'Ask a question of at least a few words.' }, { status: 400 });
    }
    if (question.length > 500) {
      return NextResponse.json({ error: 'That question is too long — keep it to one short question.' }, { status: 400 });
    }

    const response = await answerQuestion(companyId, userId ?? null, question);
    return NextResponse.json({ data: response });
  } catch (error) {
    console.error('POST /api/reports/ask-books error:', error);
    return NextResponse.json({ error: 'Failed to answer the question' }, { status: 500 });
  }
}
