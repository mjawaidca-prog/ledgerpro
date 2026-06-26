'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { format, addYears, subYears } from 'date-fns';
import { Lock, CheckCircle2, AlertTriangle, Loader2, Calendar } from 'lucide-react';

export default function PeriodClosePage() {
  const [periods, setPeriods] = useState<any[]>([]);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);

  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [compRes, perRes] = await Promise.all([
        fetch('/api/companies').then(r => r.json()),
        fetch('/api/period-close').then(r => r.json()),
      ]);
      const comp = compRes.data?.[0];
      setCompany(comp);
      setPeriods(perRes.data || []);

      // Default period = current fiscal year
      if (comp?.fiscalYearStart) {
        const fyStart = new Date(comp.fiscalYearStart);
        const now = new Date();
        // Determine current fiscal year
        let fyYear = fyStart.getFullYear();
        const fyMonth = fyStart.getMonth();
        const fyDay = fyStart.getDate();
        // If we're past the fiscal year start this year, use this year
        if (now.getMonth() > fyMonth || (now.getMonth() === fyMonth && now.getDate() >= fyDay)) {
          fyYear = now.getFullYear();
        } else {
          fyYear = now.getFullYear() - 1;
        }

        const start = new Date(fyYear, fyMonth, fyDay);
        const end = new Date(fyYear + 1, fyMonth, fyDay);
        end.setDate(end.getDate() - 1);

        setPeriodStart(start.toISOString().slice(0, 10));
        setPeriodEnd(end.toISOString().slice(0, 10));
      } else {
        // Fallback: calendar year
        const now = new Date();
        setPeriodStart(`${now.getFullYear()}-01-01`);
        setPeriodEnd(`${now.getFullYear()}-12-31`);
      }
    } catch {} finally { setLoading(false); }
  }

  async function handleClose() {
    setClosing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/period-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodStart: new Date(periodStart).toISOString(),
          periodEnd: new Date(periodEnd).toISOString(),
          notes: `Fiscal year-end close: ${format(new Date(periodStart), 'MMM d, yyyy')} — ${format(new Date(periodEnd), 'MMM d, yyyy')}`,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed'); }
      setMessage({ type: 'success', text: `Fiscal year ending ${format(new Date(periodEnd), 'MMMM d, yyyy')} has been closed. No further changes can be made.` });
      fetchData();
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally { setClosing(false); }
  }

  const isAlreadyClosed = periods.some(
    (p) => p.status === 'closed' && new Date(p.periodStart) <= new Date(periodEnd) && new Date(p.periodEnd) >= new Date(periodStart)
  );

  const isFuture = new Date(periodStart) > new Date();
  const fyLabel = company?.fiscalYearStart
    ? `Fiscal Year: ${format(new Date(company.fiscalYearStart), 'MMM d')} — ${company.fiscalYearEnd ? format(new Date(company.fiscalYearEnd), 'MMM d') : '(not set)'}`
    : 'Calendar Year';

  return (
    <AppShell>
      <div className="max-w-3xl">
        <div className="content-head">
          <div>
            <h1 className="greet">Period Close</h1>
            <p className="sub">Close your fiscal year to lock the books and prevent changes to finalized periods.</p>
          </div>
        </div>

        {message && <Alert variant={message.type} className="mb-6">{message.text}</Alert>}

        {/* Fiscal Year Info */}
        <Card className="mb-6">
          <CardHeader><h3 className="t-h3">Current Fiscal Year</h3></CardHeader>
          <CardBody>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[var(--primary-soft)] grid place-items-center">
                <Calendar size={18} className="text-[var(--primary)]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-strong)]">{fyLabel}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Default year-end: {periodEnd ? format(new Date(periodEnd), 'MMMM d, yyyy') : 'Not set'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="field">
                <label>Period Start</label>
                <input type="date" className="input" value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div className="field">
                <label>Period End</label>
                <input type="date" className="input" value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>

            {isFuture ? (
              <div className="flex items-center gap-3 p-4 bg-[var(--neutral-soft)] rounded-xl text-sm text-[var(--text-muted)]">
                <AlertTriangle size={18} className="text-[var(--warning)]" />
                You cannot close a future period.
              </div>
            ) : isAlreadyClosed ? (
              <div className="flex items-center gap-3 p-4 bg-[var(--success-soft)] rounded-xl">
                <CheckCircle2 size={20} className="text-[var(--success)]" />
                <div>
                  <p className="text-sm font-semibold text-[var(--success)]">This period is already closed.</p>
                  <p className="text-xs text-[var(--text-muted)]">No changes can be made to dates within this period.</p>
                </div>
              </div>
            ) : (
              <Button onClick={handleClose} disabled={closing} className="w-full" size="lg">
                {closing ? <Loader2 size={18} className="animate-spin" /> : <><Lock size={16} /> Close Fiscal Year</>}
              </Button>
            )}
          </CardBody>
        </Card>

        {/* Closed Periods History */}
        <Card>
          <CardHeader><h3 className="t-h3">Closed Periods</h3></CardHeader>
          <CardBody>
            {loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-[var(--text-muted)]" /></div>
            ) : periods.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-8">No periods have been closed yet. Close your first fiscal year above.</p>
            ) : (
              <div className="space-y-2">
                {periods.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-xl border border-[var(--border)]">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[var(--success-soft)] grid place-items-center"><Lock size={15} className="text-[var(--success)]" /></div>
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-strong)]">
                          {format(new Date(p.periodStart), 'MMM d, yyyy')} — {format(new Date(p.periodEnd), 'MMM d, yyyy')}
                        </p>
                        {p.notes && <p className="text-xs text-[var(--text-muted)]">{p.notes}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="paid">{p.status}</Badge>
                      {p.closedBy && <span className="text-xs text-[var(--text-faint)]">by {p.closedBy}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
