import { NextRequest, NextResponse } from 'next/server';
import { sendLeadNotification } from '@/lib/email';

/**
 * Public lead endpoint for landing-page forms (December pilot).
 * Accepts { email, role, question?, source? } and emails the monitored
 * inbox. `website` is a honeypot: real users never fill it; if it has a
 * value we pretend success and drop the submission.
 */

const SUBJECT_PREFIXES: Record<string, string> = {
  'intercompany-accounting': '[LedgerPro Review]',
  'nexvar-pay-fit-call': '[Nexvar Pay Fit Call]',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  // Honeypot — silently accept and discard bot submissions.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return NextResponse.json({ ok: true });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const role = typeof body.role === 'string' ? body.role.trim() : '';
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';
  const source =
    typeof body.source === 'string' && SUBJECT_PREFIXES[body.source]
      ? body.source
      : 'intercompany-accounting';

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ ok: false, error: 'Please enter a valid work email.' }, { status: 400 });
  }
  if (role === '' || role.length > 120) {
    return NextResponse.json({ ok: false, error: 'Please tell us your role.' }, { status: 400 });
  }

  const result = await sendLeadNotification({
    email,
    role,
    question: question || undefined,
    source,
    subjectPrefix: SUBJECT_PREFIXES[source],
  });

  if (!result.success) {
    return NextResponse.json(
      { ok: false, error: 'Something went wrong sending your request. Please email hello@nexvarlab.com directly.' },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
