'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { money, moneySigned } from '@/lib/money';
import { ArrowLeft, Loader2, Download, Trash2 } from 'lucide-react';

const selectClass =
  'font-sans text-base text-[var(--text-strong)] bg-[var(--surface)] border border-[var(--border-strong)] rounded-md h-[var(--control-h)] px-3 w-full focus:outline-none focus:border-[var(--border-focus)]';

function levelBadge(level: string | null): 'overdue' | 'pending' | 'info' | 'neutral' {
  if (level === 'overdue' || level === 'critical') return 'overdue';
  if (level === 'warning') return 'pending';
  if (level === 'watch') return 'info';
  return 'neutral';
}

export default function LoanDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [loan, setLoan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Post-a-payment inline state
  const [postingId, setPostingId] = useState<string | null>(null);
  const [actualAmount, setActualAmount] = useState('');
  const [actualDate, setActualDate] = useState('');
  const [busy, setBusy] = useState(false);

  // Statement balance editor
  const [stmtBalance, setStmtBalance] = useState('');
  const [stmtDate, setStmtDate] = useState('');

  // Advance form
  const [advKind, setAdvKind] = useState<'advance' | 'repayment'>('advance');
  const [advDate, setAdvDate] = useState(new Date().toISOString().slice(0, 10));
  const [advAmount, setAdvAmount] = useState('');
  const [advNotes, setAdvNotes] = useState('');

  // Prescribed rate editor
  const [prescribed, setPrescribed] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/loans/${id}`);
    const json = await res.json();
    if (res.ok) {
      setLoan(json.data);
      setStmtBalance(json.data.statementBalance != null ? String(json.data.statementBalance) : '');
      setStmtDate(json.data.statementBalanceDate || '');
      setPrescribed(json.data.prescribedRatePct != null ? String(json.data.prescribedRatePct) : '');
    } else {
      setError(json.error || 'Failed to load loan');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  async function patch(body: any, noticeText: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/loans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      setNotice(noticeText);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function postPayment(payment: any) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/loans/${id}/payments/${payment.id}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualAmount: actualAmount ? Number(actualAmount) : undefined,
          actualDate: actualDate || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Posting failed');
      setNotice(
        `Payment ${payment.periodNumber} posted: ${money(json.data.principal)} principal + ${money(json.data.interest)} interest. New balance ${money(json.data.closingBalance)}.${json.data.paidOff ? ' Loan paid off.' : ''}`
      );
      setPostingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Posting failed');
    } finally {
      setBusy(false);
    }
  }

  async function skipPayment(payment: any) {
    if (!confirm(`Mark payment ${payment.periodNumber} as missed? The schedule rolls it forward one period.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/loans/${id}/payments/${payment.id}/skip`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Skip failed');
      setNotice(`Payment ${payment.periodNumber} marked missed — the remaining schedule was re-amortized.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Skip failed');
    } finally {
      setBusy(false);
    }
  }

  async function addAdvance(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/loans/${id}/advances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: advKind, date: advDate, amount: Number(advAmount), notes: advNotes || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to record');
      setAdvAmount('');
      setAdvNotes('');
      setNotice('Recorded. (Register only — no journal was posted.)');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAdvance(advanceId: string) {
    if (!confirm('Delete this advance record?')) return;
    await fetch(`/api/loans/${id}/advances/${advanceId}`, { method: 'DELETE' });
    await load();
  }

  function exportCsv() {
    if (!loan) return;
    const rows = [
      ['Period', 'Date', 'Opening balance', 'Payment', 'Interest', 'Principal', 'Closing balance', 'Status'],
      ...loan.payments.map((p: any) => [
        p.periodNumber,
        p.dueDate,
        p.openingBalance,
        p.paymentAmount,
        p.interestPortion,
        p.principalPortion,
        p.closingBalance,
        p.status,
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `loan-schedule-${loan.lenderName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
  if (!loan) {
    return (
      <AppShell>
        <Alert variant="danger">{error || 'Loan not found'}</Alert>
      </AppShell>
    );
  }

  const accountName = (code: string | null) =>
    loan.accounts?.find((a: any) => a.code === code)?.name || '';
  const proof = loan.proof;
  const summary = loan.summary;

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">{loan.lenderName}</h1>
          <p className="sub">
            {loan.purpose || ''} {loan.kind === 'term' && `· ${Number(loan.annualRatePct).toFixed(2)}% ${loan.rateType} · ${loan.paymentFrequency}`}
            {loan.kind !== 'term' && `· since ${loan.startDate}`}
          </p>
        </div>
        <div className="spacer" />
        <Button variant="ghost" onClick={() => router.push('/loans')}>
          <ArrowLeft size={16} /> All loans
        </Button>
        {loan.status === 'active' && (
          <Button variant="secondary" disabled={busy} onClick={() => patch({ status: 'closed' }, 'Loan closed.')}>
            Close loan
          </Button>
        )}
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

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card>
          <CardHeader>
            <h3 className="font-semibold text-[var(--text-strong)]">Balance proof</h3>
          </CardHeader>
          <CardBody>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 text-[var(--text-muted)]">Schedule balance (today)</td>
                  <td className="py-1 text-right font-mono tabular-nums">{money(proof.scheduleBalance)}</td>
                </tr>
                <tr>
                  <td className="py-1 text-[var(--text-muted)]">
                    GL balance — {loan.loanAccountCode} {accountName(loan.loanAccountCode)}
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    {proof.glBalance != null ? money(proof.glBalance) : 'account not found'}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-[var(--text-muted)]">
                    Lender statement{proof.statementBalanceDate ? ` (${proof.statementBalanceDate})` : ''}
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    {proof.statementBalance != null ? money(proof.statementBalance) : 'not entered'}
                  </td>
                </tr>
                {proof.scheduleVsGl != null && proof.scheduleVsGl !== 0 && (
                  <tr>
                    <td className="py-1 text-[var(--danger)]">Difference — schedule vs GL</td>
                    <td className="py-1 text-right font-mono tabular-nums text-[var(--danger)]">
                      {moneySigned(proof.scheduleVsGl)}
                    </td>
                  </tr>
                )}
                {proof.scheduleVsStatement != null && proof.scheduleVsStatement !== 0 && (
                  <tr>
                    <td className="py-1 text-[var(--danger)]">Difference — schedule vs statement</td>
                    <td className="py-1 text-right font-mono tabular-nums text-[var(--danger)]">
                      {moneySigned(proof.scheduleVsStatement)}
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="py-1 text-[var(--text-muted)]">Due within 12 months (current portion)</td>
                  <td className="py-1 text-right font-mono tabular-nums">{money(proof.currentPortion)}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-2">
              {proof.tiesOut ? (
                <Badge variant="paid">Ties out</Badge>
              ) : (
                <Badge variant="overdue">Differences above — investigate before year-end</Badge>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <Input
                type="number"
                step="0.01"
                placeholder="Statement balance"
                value={stmtBalance}
                onChange={(e) => setStmtBalance(e.target.value)}
              />
              <Input type="date" value={stmtDate} onChange={(e) => setStmtDate(e.target.value)} />
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  patch(
                    {
                      statementBalance: stmtBalance ? Number(stmtBalance) : null,
                      statementBalanceDate: stmtDate || null,
                    },
                    'Statement balance saved.'
                  )
                }
              >
                Save
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="font-semibold text-[var(--text-strong)]">Loan facts</h3>
          </CardHeader>
          <CardBody>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 text-[var(--text-muted)]">Status</td>
                  <td className="py-1 text-right">{loan.status.replace('_', ' ')}</td>
                </tr>
                <tr>
                  <td className="py-1 text-[var(--text-muted)]">Original principal</td>
                  <td className="py-1 text-right font-mono tabular-nums">{money(loan.principal)}</td>
                </tr>
                <tr>
                  <td className="py-1 text-[var(--text-muted)]">Balance today</td>
                  <td className="py-1 text-right font-mono tabular-nums">{money(summary.balanceToday)}</td>
                </tr>
                <tr>
                  <td className="py-1 text-[var(--text-muted)]">Loan account</td>
                  <td className="py-1 text-right">
                    {loan.loanAccountCode} {accountName(loan.loanAccountCode)}
                  </td>
                </tr>
                {loan.interestAccountCode && (
                  <tr>
                    <td className="py-1 text-[var(--text-muted)]">Interest account</td>
                    <td className="py-1 text-right">
                      {loan.interestAccountCode} {accountName(loan.interestAccountCode)}
                    </td>
                  </tr>
                )}
                {loan.paymentAccountCode && (
                  <tr>
                    <td className="py-1 text-[var(--text-muted)]">Payments from</td>
                    <td className="py-1 text-right">
                      {loan.paymentAccountCode} {accountName(loan.paymentAccountCode)}
                    </td>
                  </tr>
                )}
                {loan.notes && (
                  <tr>
                    <td className="py-1 text-[var(--text-muted)]">Notes</td>
                    <td className="py-1 text-right">{loan.notes}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      {loan.kind === 'term' && (
        <>
          <Card className="mb-4">
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <h3 className="font-semibold text-[var(--text-strong)]">Interest by fiscal year</h3>
                <Button variant="secondary" size="sm" onClick={exportCsv}>
                  <Download size={14} /> Schedule CSV
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              <div className="flex flex-wrap gap-6">
                {summary.fiscalYearInterest.map((fy: any) => (
                  <div key={fy.label}>
                    <div className="text-xs text-[var(--text-muted)]">{fy.label}</div>
                    <div className="font-mono tabular-nums text-lg">{money(fy.interest)}</div>
                    <div className="text-xs text-[var(--text-faint)]">
                      interest · {money(fy.principal)} principal · {fy.paymentCount} payments
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="font-semibold text-[var(--text-strong)]">Amortization schedule</h3>
            </CardHeader>
            <CardBody>
              <p className="text-xs text-[var(--text-faint)] mb-3">
                A scheduled payment is a proposal — nothing reaches the ledger until you post it. Posting
                writes Dr loan principal / Dr interest expense / Cr bank in the scheduled split; if the
                actual payment differed, enter it and the rest of the schedule re-amortizes.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                      <th className="py-2 pr-2">#</th>
                      <th className="py-2 pr-2">Date</th>
                      <th className="py-2 pr-2 text-right">Opening</th>
                      <th className="py-2 pr-2 text-right">Payment</th>
                      <th className="py-2 pr-2 text-right">Interest</th>
                      <th className="py-2 pr-2 text-right">Principal</th>
                      <th className="py-2 pr-2 text-right">Closing</th>
                      <th className="py-2 pr-2">Status</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loan.payments.map((p: any) => (
                      <Fragment key={p.id}>
                        <tr className="border-b border-[var(--border)]">
                          <td className="py-2 pr-2">{p.periodNumber}</td>
                          <td className="py-2 pr-2">{p.actualDate || p.dueDate}</td>
                          <td className="py-2 pr-2 text-right font-mono tabular-nums">{money(p.openingBalance)}</td>
                          <td className="py-2 pr-2 text-right font-mono tabular-nums">{money(p.actualAmount ?? p.paymentAmount)}</td>
                          <td className="py-2 pr-2 text-right font-mono tabular-nums">{money(p.interestPortion)}</td>
                          <td className="py-2 pr-2 text-right font-mono tabular-nums">{money(p.principalPortion)}</td>
                          <td className="py-2 pr-2 text-right font-mono tabular-nums">{money(p.closingBalance)}</td>
                          <td className="py-2 pr-2">
                            {p.status === 'posted' && <Badge variant="paid">posted</Badge>}
                            {p.status === 'scheduled' && <Badge variant="neutral">scheduled</Badge>}
                            {p.status === 'skipped' && <Badge variant="draft">missed</Badge>}
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            {p.status === 'scheduled' && loan.status === 'active' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => {
                                    setPostingId(postingId === p.id ? null : p.id);
                                    setActualAmount(String(p.paymentAmount));
                                    setActualDate(p.dueDate);
                                  }}
                                >
                                  Post
                                </Button>{' '}
                                <Button size="sm" variant="ghost" disabled={busy} onClick={() => skipPayment(p)}>
                                  Missed
                                </Button>
                              </>
                            )}
                            {p.status === 'posted' && p.journalEntryId && (
                              <Button size="sm" variant="ghost" onClick={() => router.push(`/journal/${p.journalEntryId}`)}>
                                Journal
                              </Button>
                            )}
                          </td>
                        </tr>
                        {postingId === p.id && (
                          <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                            <td colSpan={9} className="py-3 px-2">
                              <div className="flex items-end gap-3 flex-wrap">
                                <label className="block">
                                  <span className="block text-xs text-[var(--text-muted)] mb-1">Actual amount</span>
                                  <Input type="number" step="0.01" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)} />
                                </label>
                                <label className="block">
                                  <span className="block text-xs text-[var(--text-muted)] mb-1">Actual date</span>
                                  <Input type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} />
                                </label>
                                <Button size="sm" disabled={busy} onClick={() => postPayment(p)}>
                                  Approve &amp; post journal
                                </Button>
                                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPostingId(null)}>
                                  Cancel
                                </Button>
                                <span className="text-xs text-[var(--text-faint)]">
                                  Split: interest {money(p.interestPortion)} first, the rest to principal.
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </>
      )}

      {loan.kind !== 'term' && (
        <>
          {loan.kind === 'shareholder_advance' && summary.deadlines?.length > 0 && (
            <Card className="mb-4">
              <CardHeader>
                <h3 className="font-semibold text-[var(--text-strong)]">s.15(2) repayment deadlines</h3>
              </CardHeader>
              <CardBody>
                <div className="space-y-2">
                  {summary.deadlines.map((d: any, i: number) => (
                    <div key={i} className="flex items-start justify-between gap-4">
                      <p className="text-sm">{d.message}</p>
                      <Badge variant={levelBadge(d.level)}>
                        {d.level === 'overdue'
                          ? `${Math.abs(d.daysRemaining)}d overdue`
                          : d.level
                            ? `${d.daysRemaining}d left`
                            : `due ${d.deadline}`}
                      </Badge>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[var(--text-faint)] mt-3">
                  Warnings only — the tool never posts a clearing journal. Legitimate clearance paths are
                  repayment, a salary (T4) or a dividend (T5); ask your accountant which fits.
                </p>
              </CardBody>
            </Card>
          )}

          {summary.seriesFlags?.length > 0 && (
            <div className="mb-4">
              <Alert variant="warning" title="Series of loans and repayments">
                {summary.seriesFlags.map((f: any, i: number) => (
                  <p key={i}>{f.message}</p>
                ))}
              </Alert>
            </div>
          )}

          {loan.kind === 'shareholder_advance' && (
            <Card className="mb-4">
              <CardHeader>
                <h3 className="font-semibold text-[var(--text-strong)]">s.80.4 interest benefit (estimate)</h3>
              </CardHeader>
              <CardBody>
                {summary.benefitCurrentYear != null ? (
                  <p className="text-sm">
                    Estimated benefit this fiscal year to date:{' '}
                    <span className="font-mono tabular-nums font-semibold">{money(summary.benefitCurrentYear)}</span>{' '}
                    — balance × (prescribed {Number(loan.prescribedRatePct).toFixed(2)}% − loan{' '}
                    {Number(loan.annualRatePct).toFixed(2)}%). The number and dates are supplied here; T4
                    box 117 reporting is the accountant&apos;s call.
                  </p>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">
                    Set the CRA prescribed rate to estimate the deemed interest benefit on this
                    low-interest loan.
                  </p>
                )}
                <div className="flex gap-2 mt-3">
                  <Input
                    type="number"
                    step="0.0001"
                    placeholder="Prescribed rate %"
                    value={prescribed}
                    onChange={(e) => setPrescribed(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      patch({ prescribedRatePct: prescribed ? Number(prescribed) : null }, 'Prescribed rate saved.')
                    }
                  >
                    Save rate
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <h3 className="font-semibold text-[var(--text-strong)]">Advances &amp; repayments</h3>
            </CardHeader>
            <CardBody>
              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2 text-right">Amount</th>
                    <th className="py-2 pr-2">Notes</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {loan.advances.map((a: any) => (
                    <tr key={a.id} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-2">{a.date}</td>
                      <td className="py-2 pr-2">{a.kind === 'advance' ? 'Advance' : 'Repayment'}</td>
                      <td className="py-2 pr-2 text-right font-mono tabular-nums">{money(a.amount)}</td>
                      <td className="py-2 pr-2">{a.notes || ''}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => deleteAdvance(a.id)}
                          className="p-1.5 rounded-md text-[var(--text-faint)] hover:text-[var(--danger)]"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {loan.advances.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-[var(--text-muted)]">
                        No movements recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <form onSubmit={addAdvance} className="flex items-end gap-3 flex-wrap">
                <label className="block">
                  <span className="block text-xs text-[var(--text-muted)] mb-1">Type</span>
                  <select className={selectClass} value={advKind} onChange={(e) => setAdvKind(e.target.value as typeof advKind)}>
                    <option value="advance">Advance</option>
                    <option value="repayment">Repayment</option>
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs text-[var(--text-muted)] mb-1">Date</span>
                  <Input type="date" value={advDate} onChange={(e) => setAdvDate(e.target.value)} required />
                </label>
                <label className="block">
                  <span className="block text-xs text-[var(--text-muted)] mb-1">Amount</span>
                  <Input type="number" step="0.01" min="0" value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} required />
                </label>
                <label className="block flex-1 min-w-[160px]">
                  <span className="block text-xs text-[var(--text-muted)] mb-1">Notes</span>
                  <Input value={advNotes} onChange={(e) => setAdvNotes(e.target.value)} />
                </label>
                <Button type="submit" disabled={busy}>
                  Record
                </Button>
              </form>
            </CardBody>
          </Card>
        </>
      )}
    </AppShell>
  );
}
