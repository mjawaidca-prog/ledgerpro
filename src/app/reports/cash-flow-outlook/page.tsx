'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import {
  Loader2, CalendarClock, AlertTriangle, ChevronDown, ChevronRight, Landmark,
} from 'lucide-react';
import type { CashflowItem, CashflowOutlook } from '@/lib/cashflow/engine';

interface OutlookData extends CashflowOutlook {
  companyName: string;
}

const KIND_LABEL: Record<CashflowItem['kind'], string> = {
  invoice: 'Invoice',
  bill: 'Bill',
  loan: 'Loan',
  recurring: 'Recurring',
  payroll: 'Payroll',
  remittance: 'CRA remittance',
  gst: 'GST/HST',
};

function fmtDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function fmtDateFull(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function ItemRow({ item }: { item: CashflowItem }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 border-b border-[var(--border)] last:border-0">
      <span className="font-mono text-xs tabular-nums text-[var(--text-muted)] w-16 shrink-0">
        {fmtDate(item.date)}
      </span>
      <div className="min-w-0">
        <span className="text-sm text-[var(--text)]">{item.label}</span>
        <span className="text-xs text-[var(--text-muted)]"> · {KIND_LABEL[item.kind]}</span>
        {item.detail && <span className="text-xs text-[var(--text-muted)]"> · {item.detail}</span>}
        {item.pastDue && (
          <span className="text-xs font-medium text-[var(--danger)]"> · already due — shown in week 1</span>
        )}
      </div>
      <span className="spacer" />
      <span
        className={cn(
          'font-mono tabular-nums text-sm',
          item.direction === 'in' ? 'text-[var(--success)]' : 'text-[var(--text-strong)]'
        )}
      >
        {item.direction === 'in' ? '+' : '−'}{money(item.amountCents / 100)}
      </span>
    </div>
  );
}

export default function CashFlowOutlookPage() {
  const [data, setData] = useState<OutlookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/cash-flow-outlook').then((r) => r.json());
      if (res.error) {
        setError(res.error);
        return;
      }
      setData(res.data);
    } catch {
      setError('Failed to build the cash-flow outlook.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <AppShell>
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      </AppShell>
    );
  }

  const neg = data?.firstNegative;

  return (
    <AppShell>
      <div className="max-w-5xl">
        <div className="content-head">
          <div>
            <h1 className="greet">Cash-Flow Outlook</h1>
            <p className="sub">
              The next 13 weeks, built from due dates and your own payroll pattern — open invoices
              and bills, loan schedules, recurring entries, payroll with CRA remittances on the
              15th, and GST/HST owing. Every week drills down to the items behind its figures.
            </p>
          </div>
          <div className="spacer" />
          {data?.payrollPattern && (
            <Badge variant="pending">{data.payrollPattern.description}</Badge>
          )}
        </div>

        {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

        {data && (
          <>
            {neg && (
              <Alert variant="danger" className="mb-4">
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle size={15} />
                  <span>
                    <strong>Cash goes negative in week {neg.weekIndex + 1}</strong> — on{' '}
                    {fmtDateFull(neg.date)} the projected balance reaches{' '}
                    <span className="font-mono tabular-nums">{money(neg.closingCents / 100)}</span>.
                  </span>
                </span>
              </Alert>
            )}

            <Card className="mb-6">
              <CardHeader>
                <span className="inline-flex items-center gap-2">
                  <Landmark size={15} /> Opening position — {fmtDateFull(data.windowStart)}
                </span>
                <span className="spacer" />
                <span className="font-mono tabular-nums font-semibold text-[var(--text-strong)]">
                  {money(data.openingCents / 100)}
                </span>
              </CardHeader>
              <CardBody>
                {data.accounts.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    No bank accounts on file — the outlook starts from zero. Add a bank account to
                    anchor it to a real position.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-x-8 gap-y-1">
                    {data.accounts.map((a) => (
                      <span key={a.name} className="text-sm text-[var(--text-muted)]">
                        {a.name}:{' '}
                        <span className="font-mono tabular-nums text-[var(--text)]">
                          {money(a.balanceCents / 100)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card className="mb-6">
              <CardBody>
                <div className="grid grid-cols-[28px_1fr_110px_110px_110px_120px] gap-2 pb-2 border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                  <div />
                  <div>Week</div>
                  <div className="text-right">In</div>
                  <div className="text-right">Out</div>
                  <div className="text-right">Net</div>
                  <div className="text-right">Balance</div>
                </div>
                {data.weeks.map((week) => {
                  const isOpen = expanded === week.index;
                  return (
                    <div key={week.index} className="border-b border-[var(--surface-3)] last:border-b-0">
                      <button
                        onClick={() => setExpanded(isOpen ? null : week.index)}
                        className="w-full grid grid-cols-[28px_1fr_110px_110px_110px_120px] gap-2 py-2.5 text-left items-baseline hover:bg-[var(--surface-2)] transition-colors"
                      >
                        <span className="text-[var(--text-faint)]">
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </span>
                        <span className="text-sm text-[var(--text)]">
                          <span className="font-medium text-[var(--text-strong)]">Week {week.index + 1}</span>{' '}
                          <span className="text-[var(--text-muted)]">
                            {fmtDate(week.start)} – {fmtDate(week.end)}
                          </span>
                          {week.items.length > 0 && (
                            <span className="text-xs text-[var(--text-faint)]"> · {week.items.length} item{week.items.length === 1 ? '' : 's'}</span>
                          )}
                        </span>
                        <span className="text-right font-mono tabular-nums text-sm text-[var(--success)]">
                          {week.inflowCents > 0 ? money(week.inflowCents / 100) : '—'}
                        </span>
                        <span className="text-right font-mono tabular-nums text-sm text-[var(--text)]">
                          {week.outflowCents > 0 ? money(week.outflowCents / 100) : '—'}
                        </span>
                        <span className={cn('text-right font-mono tabular-nums text-sm', week.netCents < 0 ? 'text-[var(--danger)]' : 'text-[var(--text)]')}>
                          {week.netCents !== 0 ? money(week.netCents / 100, true) : '—'}
                        </span>
                        <span className={cn('text-right font-mono tabular-nums text-sm font-semibold', week.closingCents < 0 ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]')}>
                          {money(week.closingCents / 100)}
                        </span>
                      </button>
                      {isOpen && (
                        <div className="pb-3 pl-[36px] pr-1">
                          {week.items.length === 0 ? (
                            <p className="text-sm text-[var(--text-muted)] py-1">Nothing due this week.</p>
                          ) : (
                            week.items.map((item, i) => <ItemRow key={`${item.kind}-${item.date}-${i}`} item={item} />)
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="grid grid-cols-[28px_1fr_110px_110px_110px_120px] gap-2 pt-2 font-mono text-sm">
                  <div />
                  <div className="font-sans font-medium text-[var(--text-strong)]">13-week total</div>
                  <div className="text-right tabular-nums text-[var(--success)]">{money(data.totalInflowCents / 100)}</div>
                  <div className="text-right tabular-nums">{money(data.totalOutflowCents / 100)}</div>
                  <div />
                  <div className="text-right tabular-nums font-semibold text-[var(--text-strong)]">
                    {money(data.weeks[data.weeks.length - 1].closingCents / 100)}
                  </div>
                </div>
              </CardBody>
            </Card>

            {data.afterWindow.length > 0 && (
              <Card className="mb-6">
                <CardHeader>Just beyond this window</CardHeader>
                <CardBody>
                  {data.afterWindow.map((item, i) => (
                    <ItemRow key={`after-${item.kind}-${item.date}-${i}`} item={item} />
                  ))}
                </CardBody>
              </Card>
            )}

            <Card>
              <CardHeader>
                <span className="inline-flex items-center gap-2">
                  <CalendarClock size={15} /> How this outlook is built
                </span>
              </CardHeader>
              <CardBody>
                <ul className="list-disc pl-5 space-y-1.5">
                  {data.assumptions.map((a) => (
                    <li key={a} className="text-sm text-[var(--text-muted)]">{a}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
