'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { money } from '@/lib/money';
import { Plus, Loader2 } from 'lucide-react';

function kindLabel(kind: string): string {
  if (kind === 'term') return 'Term loan';
  if (kind === 'shareholder_advance') return 'Due from shareholder';
  return 'Due to shareholder';
}

function kindBadge(kind: string): 'info' | 'pending' | 'neutral' {
  if (kind === 'term') return 'info';
  if (kind === 'shareholder_advance') return 'pending';
  return 'neutral';
}

export default function LoansPage() {
  const router = useRouter();
  const [loans, setLoans] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/loans').then((r) => r.json()),
      fetch('/api/loans/summary').then((r) => r.json()),
    ])
      .then(([loansJson, summaryJson]) => {
        setLoans(loansJson.data || []);
        setSummary(summaryJson.data || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const warnings = summary?.shareholderWarnings || [];
  const seriesFlags = summary?.seriesFlags || [];
  const fyInterest = summary?.fiscalYearInterest || [];

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">Loans</h1>
          <p className="sub">
            Every loan with its amortization schedule, principal/interest split, and — for shareholder
            loans — the s.15(2) repayment deadlines.
          </p>
        </div>
        <div className="spacer" />
        <Button onClick={() => router.push('/loans/new')}>
          <Plus size={16} /> New Loan
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : (
        <>
          {warnings.length > 0 && (
            <div className="mb-4">
              <Alert variant="warning">
                <p className="font-semibold">
                  {warnings.length} shareholder-loan deadline{warnings.length === 1 ? '' : 's'} need
                  attention
                </p>
                {warnings.slice(0, 3).map((w: any, i: number) => (
                  <p key={i} className="text-sm mt-1">
                    {w.lenderName}: {money(w.outstanding)} advanced {w.advanceDate} must be repaid by{' '}
                    {w.deadline}
                    {w.daysRemaining < 0
                      ? ` — ${Math.abs(w.daysRemaining)} days past the deadline`
                      : ` — ${w.daysRemaining} days left`}
                    .
                  </p>
                ))}
              </Alert>
            </div>
          )}

          {seriesFlags.length > 0 && (
            <div className="mb-4">
              <Alert variant="warning">
                {seriesFlags.map((f: any, i: number) => (
                  <p key={i} className="text-sm">
                    <span className="font-semibold">{f.lenderName}:</span> {f.message}
                  </p>
                ))}
              </Alert>
            </div>
          )}

          {fyInterest.length > 0 && (
            <Card className="mb-4">
              <CardHeader>
                <h3 className="font-semibold text-[var(--text-strong)]">
                  Interest expense by fiscal year (all term loans)
                </h3>
              </CardHeader>
              <CardBody>
                <div className="flex flex-wrap gap-6">
                  {fyInterest.map((fy: any) => (
                    <div key={fy.label}>
                      <div className="text-xs text-[var(--text-muted)]">
                        {fy.label} · {fy.start} → {fy.end}
                      </div>
                      <div className="font-mono tabular-nums text-lg">{money(fy.interest)}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[var(--text-faint)] mt-2">
                  The T2 interest figure (GIFI 8710), sliced on this company&apos;s own year-end from
                  each loan&apos;s schedule.
                </p>
              </CardBody>
            </Card>
          )}

          {loans.length === 0 ? (
            <Card>
              <CardBody>
                <div className="py-12 text-center">
                  <p className="text-sm text-[var(--text-muted)] mb-4">
                    No loans yet. Add a vehicle or term loan and the schedule, split journals and
                    year-end interest totals are generated for you — no more booking a whole loan
                    payment to one expense account.
                  </p>
                  <Button onClick={() => router.push('/loans/new')}>
                    <Plus size={14} /> Add your first loan
                  </Button>
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {loans.map((loan) => (
                <Card key={loan.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between w-full">
                      <div>
                        <h3 className="font-semibold text-[var(--text-strong)]">{loan.lenderName}</h3>
                        <span className="text-xs text-[var(--text-muted)]">
                          {loan.purpose || kindLabel(loan.kind)}
                          {loan.kind === 'term' && <> · {Number(loan.annualRatePct).toFixed(2)}% {loan.rateType}</>}
                        </span>
                      </div>
                      <Badge variant={kindBadge(loan.kind)}>{kindLabel(loan.kind)}</Badge>
                    </div>
                  </CardHeader>
                  <CardBody>
                    <div className="flex items-end justify-between mb-3">
                      <div>
                        <div className="text-xs text-[var(--text-muted)]">Balance today</div>
                        <div className="font-mono tabular-nums text-xl">
                          {money(loan.summary?.balanceToday ?? 0)}
                        </div>
                      </div>
                      {loan.kind === 'term' && loan.summary?.nextPayment && (
                        <div className="text-right">
                          <div className="text-xs text-[var(--text-muted)]">Next payment</div>
                          <div className="text-sm">
                            {money(loan.summary.nextPayment.amount)} · {loan.summary.nextPayment.date}
                          </div>
                        </div>
                      )}
                      {loan.kind === 'shareholder_advance' && loan.summary?.activeWarnings > 0 && (
                        <Badge variant="overdue">{loan.summary.activeWarnings} deadline warning(s)</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => router.push(`/loans/${loan.id}`)}
                      >
                        Open
                      </Button>
                      {loan.status !== 'active' && <Badge variant="draft">{loan.status.replace('_', ' ')}</Badge>}
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
