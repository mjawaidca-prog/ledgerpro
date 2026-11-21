'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { money } from '@/lib/money';
import { ArrowLeft, Loader2, Sparkles, ExternalLink } from 'lucide-react';

// Mirrors LOW_CONFIDENCE_THRESHOLD in lib/receipts/ocr-provider.ts —
// fields the AI read below this get the reviewer's eye first (the
// receipts inbox pattern; kept local so this page imports no server
// OCR code).
const LOW_CONFIDENCE = 0.8;

const selectClass =
  'font-sans text-base text-[var(--text-strong)] bg-[var(--surface)] border border-[var(--border-strong)] rounded-md h-[var(--control-h)] px-3 w-full focus:outline-none focus:border-[var(--border-focus)]';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-[var(--text-strong)] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[var(--text-faint)] mt-1">{hint}</span>}
    </label>
  );
}

const flagStyle = (flagged: boolean): React.CSSProperties | undefined =>
  flagged ? { borderColor: '#d97706', boxShadow: '0 0 0 1px #d97706' } : undefined;

function confChip(confidence: number | null) {
  if (confidence === null || confidence === undefined) return null;
  const low = confidence < LOW_CONFIDENCE;
  return (
    <span
      className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        low ? 'bg-[#fdf6e3] text-[#8a6d00]' : 'bg-[var(--surface-3)] text-[var(--text-muted)]'
      }`}
    >
      {Math.round(confidence * 100)}%{low ? ' — check' : ''}
    </span>
  );
}

function ReadField({
  label,
  value,
  confidence,
}: {
  label: string;
  value: string | null;
  confidence: number | null;
}) {
  return (
    <div>
      <div className="text-xs text-[var(--text-muted)]">
        {label}
        {confChip(confidence)}
      </div>
      <div
        className="font-medium text-[var(--text-strong)] rounded-md px-1 -mx-1"
        style={flagStyle(value !== null && confidence !== null && confidence < LOW_CONFIDENCE)}
      >
        {value ?? <span className="text-[var(--text-faint)]">Not on the statement</span>}
      </div>
    </div>
  );
}

export default function LoanStatementReviewPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [statement, setStatement] = useState<any>(null);
  const [loans, setLoans] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Path A — new loan from the statement.
  const [form, setForm] = useState({
    lenderName: '',
    purpose: '',
    principal: '',
    annualRatePct: '',
    startDate: '',
    firstPaymentDate: '',
    paymentAmount: '',
    paymentFrequency: 'monthly',
    paymentAccountCode: '',
  });
  const [creating, setCreating] = useState(false);

  // Path B — check against an existing loan.
  const [checkLoanId, setCheckLoanId] = useState('');
  const [check, setCheck] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [acceptCorrection, setAcceptCorrection] = useState(true);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sJson, lJson, cJson] = await Promise.all([
        fetch(`/api/loans/statements/${params.id}`).then((r) => r.json()),
        fetch('/api/loans').then((r) => r.json()),
        fetch('/api/coa').then((r) => r.json()),
      ]);
      const s = sJson.data?.statement ?? null;
      setStatement(s);
      setLoans(Array.isArray(lJson.data) ? lJson.data : []);
      setAccounts(Array.isArray(cJson.data) ? cJson.data : []);
      if (s?.prefill) {
        const p = s.prefill;
        setForm((f) => ({
          ...f,
          lenderName: p.lenderName.value ?? '',
          principal: p.principal.value != null ? String(p.principal.value) : '',
          annualRatePct: p.annualRatePct.value != null ? String(p.annualRatePct.value) : '',
          startDate: p.startDate.value ?? f.startDate,
          firstPaymentDate: p.firstPaymentDate.value ?? '',
          paymentAmount: p.paymentAmount.value != null ? String(p.paymentAmount.value) : '',
        }));
      }
    } catch {
      setError('Failed to load the statement.');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function retryRead() {
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch(`/api/loans/statements/${params.id}/extract`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'The read failed');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The read failed');
    } finally {
      setRetrying(false);
    }
  }

  async function createLoan(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'term',
          lenderName: form.lenderName.trim(),
          purpose: form.purpose.trim() || null,
          principal: Number(form.principal || 0),
          annualRatePct: Number(form.annualRatePct || 0),
          rateType: 'fixed',
          startDate: form.startDate,
          firstPaymentDate: form.firstPaymentDate || form.startDate,
          paymentFrequency: form.paymentFrequency,
          paymentAmount: Number(form.paymentAmount || 0),
          numberOfPayments: null,
          paymentAccountCode: form.paymentAccountCode || null,
          notes: `Created from a captured lender statement (${statement.originalFileName}).`,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const details = json.details ? Object.values(json.details).flat().join(' ') : '';
        throw new Error(`${json.error || 'Failed to create loan'} ${details}`.trim());
      }
      const loanId = json.data.id;
      // Link the statement to the new loan and set its statement leg.
      const applyRes = await fetch(`/api/loans/statements/${params.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, acceptCorrection: false }),
      });
      if (!applyRes.ok) {
        const applyJson = await applyRes.json().catch(() => ({}));
        setNotice(
          `Loan created, but linking the statement failed: ${applyJson.error || 'unknown error'} — the loan itself is fine.`,
        );
        setCreating(false);
        router.push(`/loans/${loanId}`);
        return;
      }
      router.push(`/loans/${loanId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create loan');
      setCreating(false);
    }
  }

  async function runCheck() {
    if (!checkLoanId) return;
    setChecking(true);
    setError(null);
    setCheck(null);
    try {
      const res = await fetch(`/api/loans/statements/${params.id}/check?loanId=${checkLoanId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'The check failed');
      setCheck(json.data);
      setAcceptCorrection(json.data.correction?.available ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The check failed');
    } finally {
      setChecking(false);
    }
  }

  async function applyCheck() {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`/api/loans/statements/${params.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId: checkLoanId, acceptCorrection }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Applying the statement failed');
      setNotice(
        json.data.correctionApplied
          ? 'Applied — the schedule now re-amortizes from the statement balance, and the loan’s statement leg is set.'
          : 'Applied — the loan’s statement balance is set from this statement.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Applying the statement failed');
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-48">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      </AppShell>
    );
  }

  if (!statement) {
    return (
      <AppShell>
        <Alert variant="danger">{error || 'Statement not found.'}</Alert>
      </AppShell>
    );
  }

  const f = statement.fields;
  const p = statement.prefill;
  const termLoans = loans.filter((l) => l.kind === 'term');
  const bankAccounts = accounts.filter((a) => a.type === 'asset' && a.active !== false);
  const applied = Boolean(statement.appliedAt);
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">Review statement</h1>
          <p className="sub">
            {statement.originalFileName} — read it against the paper, then create the loan or check
            an existing schedule. Nothing reaches a loan until you apply it.
          </p>
        </div>
        <div className="spacer" />
        <a
          href={`/api/loans/statements/${statement.id}/image`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-[var(--primary)] hover:underline"
        >
          View the statement <ExternalLink size={14} />
        </a>
        <Button variant="ghost" onClick={() => router.push('/loans/import')}>
          <ArrowLeft size={16} /> All statements
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert variant="success">{notice}</Alert>
        </div>
      )}

      {statement.extractionStatus === 'unavailable' && (
        <Card className="mb-4">
          <CardBody>
            <p className="text-sm text-[var(--text)] mb-2 font-semibold">Automatic reading isn’t set up</p>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              The statement is stored safely, but no document-reading service is configured for this
              workspace, so there is no draft to review. Enter the loan by hand — the schedule,
              splits and deadlines all work the same — or try the read again after the service is
              configured.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => router.push('/loans/new')}>Enter the loan manually</Button>
              <Button variant="secondary" onClick={retryRead} disabled={retrying}>
                {retrying ? <Loader2 size={14} className="animate-spin" /> : null} Try the read again
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {statement.extractionStatus === 'failed' && (
        <div className="mb-4">
          <Alert variant="danger">
            <p className="font-semibold">The automatic read failed</p>
            <p className="text-sm mt-1">{statement.extractionError || 'The document could not be read.'}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={retryRead} disabled={retrying}>
                {retrying ? <Loader2 size={14} className="animate-spin" /> : null} Retry the read
              </Button>
              <Button size="sm" variant="secondary" onClick={() => router.push('/loans/new')}>
                Enter the loan manually
              </Button>
            </div>
          </Alert>
        </div>
      )}

      {statement.extractionStatus === 'extracted' && f && (
        <>
          <Card className="mb-4">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-[#2f4b9b]" />
                <h3 className="font-semibold text-[var(--text-strong)]">What the statement says</h3>
              </div>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-3 gap-4">
                <ReadField label="Lender" value={f.lenderName.value} confidence={f.lenderName.confidence} />
                <ReadField label="Statement date" value={f.statementDate.value} confidence={f.statementDate.confidence} />
                <ReadField
                  label="Account"
                  value={f.accountNumber.masked}
                  confidence={f.accountNumber.confidence}
                />
                <ReadField
                  label="Current balance"
                  value={f.currentBalance.value != null ? money(f.currentBalance.value) : null}
                  confidence={f.currentBalance.confidence}
                />
                <ReadField
                  label="Regular payment"
                  value={f.paymentAmount.value != null ? money(f.paymentAmount.value) : null}
                  confidence={f.paymentAmount.confidence}
                />
                <ReadField
                  label="Interest rate"
                  value={f.annualRatePct.value != null ? `${f.annualRatePct.value}%` : null}
                  confidence={f.annualRatePct.confidence}
                />
                <ReadField label="Next payment due" value={f.nextPaymentDate.value} confidence={f.nextPaymentDate.confidence} />
                {p?.remainingPayments?.value != null && (
                  <div>
                    <div className="text-xs text-[var(--text-muted)]">
                      Payments remaining
                      <span className="ml-2 rounded-full bg-[var(--surface-3)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                        calculated
                      </span>
                    </div>
                    <div className="font-medium text-[var(--text-strong)]">{p.remainingPayments.value}</div>
                    <div className="text-xs text-[var(--text-faint)]">
                      Solved by the loan engine from the balance, payment and rate (monthly) — not
                      printed on the statement.
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-[var(--text-faint)] mt-3">
                Fields outlined in amber were read with low confidence — double-check those against
                the statement itself.
              </p>
            </CardBody>
          </Card>

          {applied && statement.check && (
            <div className="mb-4">
              <Alert variant="success">
                Applied {statement.appliedAt ? `on ${new Date(statement.appliedAt).toLocaleDateString()}` : ''}:
                statement balance {money(statement.check.statementBalance)} vs schedule{' '}
                {money(statement.check.scheduleBalance)} at {statement.check.statementDate} —
                difference {money(statement.check.difference)}
                {statement.correctionApplied ? ', correction accepted (tail re-amortized)' : ''}.
              </Alert>
            </div>
          )}

          {!applied && (
            <>
              <Card className="mb-4">
                <CardHeader>
                  <h3 className="font-semibold text-[var(--text-strong)]">Check against an existing loan</h3>
                </CardHeader>
                <CardBody>
                  <div className="flex gap-2 items-end mb-4">
                    <div className="flex-1">
                      <Field label="Loan">
                        <select
                          className={selectClass}
                          value={checkLoanId}
                          onChange={(e) => {
                            setCheckLoanId(e.target.value);
                            setCheck(null);
                          }}
                        >
                          <option value="">Choose a term loan…</option>
                          {termLoans.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.lenderName}
                              {l.purpose ? ` — ${l.purpose}` : ''}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Button onClick={runCheck} disabled={!checkLoanId || checking}>
                      {checking ? <Loader2 size={14} className="animate-spin" /> : null} Compare
                    </Button>
                  </div>

                  {check && (
                    <div>
                      <div className="grid grid-cols-3 gap-4 mb-3">
                        <div>
                          <div className="text-xs text-[var(--text-muted)]">Statement balance ({check.check.statementDate})</div>
                          <div className="font-mono tabular-nums text-lg">{money(check.check.statementBalance)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-muted)]">Schedule balance</div>
                          <div className="font-mono tabular-nums text-lg">{money(check.check.scheduleBalance)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-muted)]">Difference (statement − schedule)</div>
                          <div className="font-mono tabular-nums text-lg">{money(check.check.difference)}</div>
                        </div>
                      </div>
                      <div className="mb-3">
                        {check.check.drift === 'match' && <Badge variant="info">Matches to the cent</Badge>}
                        {check.check.drift === 'small' && (
                          <Badge variant="pending">Small difference — usually interest timing or a payment in transit</Badge>
                        )}
                        {check.check.drift === 'large' && (
                          <Badge variant="overdue">Large difference — understand it before accepting a correction</Badge>
                        )}
                      </div>
                      {check.correction.available && (
                        <label className="flex items-start gap-2 text-sm text-[var(--text)] mb-3">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={acceptCorrection}
                            onChange={(e) => setAcceptCorrection(e.target.checked)}
                          />
                          <span>
                            Accept the correction: re-amortize the remaining schedule from the
                            statement balance of {money(check.check.statementBalance)} (posted
                            payments are never changed).
                          </span>
                        </label>
                      )}
                      <Button onClick={applyCheck} disabled={applying}>
                        {applying ? <Loader2 size={14} className="animate-spin" /> : null} Apply to this loan
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card className="mb-4">
                <CardHeader>
                  <h3 className="font-semibold text-[var(--text-strong)]">Or create a new loan from this statement</h3>
                </CardHeader>
                <CardBody>
                  <form onSubmit={createLoan}>
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Lender">
                        <Input value={form.lenderName} onChange={set('lenderName')} required style={flagStyle(p?.lenderName.lowConfidence ?? false)} />
                      </Field>
                      <Field label="Purpose / asset">
                        <Input value={form.purpose} onChange={set('purpose')} placeholder="2023 Ford F-150" />
                      </Field>
                      <Field label="Payments come from (bank account)">
                        <select className={selectClass} value={form.paymentAccountCode} onChange={set('paymentAccountCode')} required>
                          <option value="">Choose…</option>
                          {bankAccounts.map((a) => (
                            <option key={a.code} value={a.code}>
                              {a.code} — {a.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Balance owing (from the statement)" hint="Registered as the loan's principal — the loan is being recorded mid-life, from the paper">
                        <Input type="number" step="0.01" min="0" value={form.principal} onChange={set('principal')} required style={flagStyle(p?.principal.lowConfidence ?? false)} />
                      </Field>
                      <Field label="Statement date (loan start for the schedule)">
                        <Input type="date" value={form.startDate} onChange={set('startDate')} required style={flagStyle(p?.startDate.lowConfidence ?? false)} />
                      </Field>
                      <Field label="Annual interest rate (%)">
                        <Input type="number" step="0.0001" min="0" value={form.annualRatePct} onChange={set('annualRatePct')} required style={flagStyle(p?.annualRatePct.lowConfidence ?? false)} />
                      </Field>
                      <Field label="Regular payment ($)" hint="The schedule solves how many payments remain">
                        <Input type="number" step="0.01" min="0" value={form.paymentAmount} onChange={set('paymentAmount')} required style={flagStyle(p?.paymentAmount.lowConfidence ?? false)} />
                      </Field>
                      <Field label="First payment date">
                        <Input type="date" value={form.firstPaymentDate} onChange={set('firstPaymentDate')} style={flagStyle(p?.firstPaymentDate.lowConfidence ?? false)} />
                      </Field>
                      <Field label="Payment frequency">
                        <select className={selectClass} value={form.paymentFrequency} onChange={set('paymentFrequency')}>
                          <option value="monthly">Monthly</option>
                          <option value="biweekly">Bi-weekly</option>
                          <option value="weekly">Weekly</option>
                        </select>
                      </Field>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Button type="submit" disabled={creating}>
                        {creating ? <Loader2 size={16} className="animate-spin" /> : null} Create loan from statement
                      </Button>
                    </div>
                  </form>
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
