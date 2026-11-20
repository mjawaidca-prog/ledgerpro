'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { ArrowLeft, Loader2 } from 'lucide-react';

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

export default function NewLoanPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<'term' | 'shareholder_advance' | 'shareholder_funding'>('term');
  const [solveMode, setSolveMode] = useState<'payment' | 'term'>('payment');
  const [form, setForm] = useState({
    lenderName: '',
    purpose: '',
    principal: '',
    annualRatePct: '',
    rateType: 'fixed',
    compoundingPerYear: '',
    startDate: new Date().toISOString().slice(0, 10),
    firstPaymentDate: '',
    paymentFrequency: 'monthly',
    paymentAmount: '',
    numberOfPayments: '',
    balloonAmount: '',
    loanAccountCode: '',
    interestAccountCode: '',
    paymentAccountCode: '',
    assetAccountCode: '',
    prescribedRatePct: '',
    initialAdvanceDate: new Date().toISOString().slice(0, 10),
    initialAdvanceAmount: '',
    notes: '',
  });
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    fetch('/api/coa')
      .then((r) => r.json())
      .then((json) => setAccounts(Array.isArray(json.data) ? json.data : []))
      .catch(() => {});
  }, []);

  const byType = (type: string) => accounts.filter((a) => a.type === type && a.active !== false);
  const accountOptions = (list: any[], autoLabel?: string) => (
    <>
      {autoLabel && <option value="">{autoLabel}</option>}
      {list.map((a) => (
        <option key={a.code} value={a.code}>
          {a.code} — {a.name}
        </option>
      ))}
    </>
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const num = (s: string) => (s.trim() === '' ? null : Number(s));
    const body: any = {
      kind,
      lenderName: form.lenderName.trim(),
      purpose: form.purpose.trim() || null,
      principal: kind === 'term' ? Number(form.principal || 0) : Number(form.initialAdvanceAmount || 0),
      annualRatePct: Number(form.annualRatePct || 0),
      rateType: form.rateType,
      compoundingPerYear: num(form.compoundingPerYear),
      startDate: form.startDate,
      notes: form.notes.trim() || null,
    };
    if (kind === 'term') {
      body.firstPaymentDate = form.firstPaymentDate || form.startDate;
      body.paymentFrequency = form.paymentFrequency;
      body.paymentAmount = solveMode === 'payment' ? Number(form.paymentAmount || 0) : null;
      body.numberOfPayments = solveMode === 'term' ? Number(form.numberOfPayments || 0) : null;
      body.balloonAmount = num(form.balloonAmount);
      body.loanAccountCode = form.loanAccountCode || null;
      body.interestAccountCode = form.interestAccountCode || null;
      body.paymentAccountCode = form.paymentAccountCode || null;
      body.assetAccountCode = form.assetAccountCode || null;
    } else {
      body.loanAccountCode = form.loanAccountCode || null;
      body.prescribedRatePct = kind === 'shareholder_advance' ? num(form.prescribedRatePct) : null;
      if (form.initialAdvanceAmount) {
        body.initialAdvance = {
          date: form.initialAdvanceDate,
          amount: Number(form.initialAdvanceAmount),
        };
      }
    }
    try {
      const res = await fetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        const details = json.details
          ? Object.values(json.details).flat().join(' ')
          : '';
        throw new Error(`${json.error || 'Failed to create loan'} ${details}`.trim());
      }
      router.push(`/loans/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create loan');
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">New Loan</h1>
          <p className="sub">Create the loan once, from its real paperwork — the schedule does the rest.</p>
        </div>
        <div className="spacer" />
        <Button variant="ghost" onClick={() => router.push('/loans')}>
          <ArrowLeft size={16} /> Back to Loans
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Card className="mb-4">
          <CardHeader>
            <h3 className="font-semibold text-[var(--text-strong)]">What kind of loan?</h3>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Loan type">
                <select
                  className={selectClass}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                >
                  <option value="term">Term loan (vehicle, equipment, bank loan…)</option>
                  <option value="shareholder_advance">Due from shareholder (corporation lent to shareholder)</option>
                  <option value="shareholder_funding">Due to shareholder (shareholder funded the corporation)</option>
                </select>
              </Field>
              <Field
                label={kind === 'term' ? 'Lender' : 'Shareholder name'}
                hint={kind === 'term' ? 'e.g. Ford Credit, TD Bank' : 'The shareholder this loan is with'}
              >
                <Input value={form.lenderName} onChange={set('lenderName')} required placeholder={kind === 'term' ? 'Ford Credit' : 'Shareholder name'} />
              </Field>
            </div>
          </CardBody>
        </Card>

        {kind === 'term' ? (
          <>
            <Card className="mb-4">
              <CardHeader>
                <h3 className="font-semibold text-[var(--text-strong)]">Terms</h3>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Purpose / asset">
                    <Input value={form.purpose} onChange={set('purpose')} placeholder="2023 Ford F-150" />
                  </Field>
                  <Field label="Original principal ($)">
                    <Input type="number" step="0.01" min="0" value={form.principal} onChange={set('principal')} required />
                  </Field>
                  <Field label="Loan start date">
                    <Input type="date" value={form.startDate} onChange={set('startDate')} required />
                  </Field>
                  <Field label="Annual interest rate (%)" hint="The nominal rate on the paperwork, e.g. 6.99">
                    <Input type="number" step="0.0001" min="0" value={form.annualRatePct} onChange={set('annualRatePct')} required />
                  </Field>
                  <Field label="Rate type">
                    <select className={selectClass} value={form.rateType} onChange={set('rateType')}>
                      <option value="fixed">Fixed</option>
                      <option value="variable">Variable</option>
                    </select>
                  </Field>
                  <Field
                    label="Compounding (per year)"
                    hint="Blank = matches payment frequency (the dealer-loan case). Use 2 for a Canadian mortgage."
                  >
                    <Input type="number" min="1" value={form.compoundingPerYear} onChange={set('compoundingPerYear')} placeholder="12" />
                  </Field>
                  <Field label="Payment frequency">
                    <select className={selectClass} value={form.paymentFrequency} onChange={set('paymentFrequency')}>
                      <option value="monthly">Monthly</option>
                      <option value="biweekly">Bi-weekly</option>
                      <option value="weekly">Weekly</option>
                    </select>
                  </Field>
                  <Field label="First payment date">
                    <Input type="date" value={form.firstPaymentDate} onChange={set('firstPaymentDate')} />
                  </Field>
                  <Field label="Balloon amount ($) — optional" hint="Still owing after the last scheduled payment">
                    <Input type="number" step="0.01" min="0" value={form.balloonAmount} onChange={set('balloonAmount')} />
                  </Field>
                </div>

                <div className="mt-5">
                  <span className="block text-sm font-medium text-[var(--text-strong)] mb-2">
                    What does the paperwork state?
                  </span>
                  <div className="flex gap-2 mb-3">
                    <Button type="button" variant={solveMode === 'payment' ? 'primary' : 'secondary'} size="sm" onClick={() => setSolveMode('payment')}>
                      The payment amount
                    </Button>
                    <Button type="button" variant={solveMode === 'term' ? 'primary' : 'secondary'} size="sm" onClick={() => setSolveMode('term')}>
                      The rate &amp; term
                    </Button>
                  </div>
                  {solveMode === 'payment' ? (
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Payment amount ($)" hint="The schedule solves how many payments it takes">
                        <Input type="number" step="0.01" min="0" value={form.paymentAmount} onChange={set('paymentAmount')} required />
                      </Field>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Number of payments" hint="The schedule solves the payment">
                        <Input type="number" min="1" value={form.numberOfPayments} onChange={set('numberOfPayments')} required />
                      </Field>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card className="mb-4">
              <CardHeader>
                <h3 className="font-semibold text-[var(--text-strong)]">Accounts</h3>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="Loan payable account"
                    hint="Leave on auto-create and the loan gets its own liability account (GIFI 3140) — payments are never booked to an expense account again."
                  >
                    <select className={selectClass} value={form.loanAccountCode} onChange={set('loanAccountCode')}>
                      {accountOptions(byType('liability'), 'Auto-create: Loan — lender')}
                    </select>
                  </Field>
                  <Field label="Interest expense account" hint="Auto-create uses Interest Expense (GIFI 8710)">
                    <select className={selectClass} value={form.interestAccountCode} onChange={set('interestAccountCode')}>
                      {accountOptions(byType('expense'), 'Auto-create: Interest Expense')}
                    </select>
                  </Field>
                  <Field label="Payments come from (bank account)">
                    <select className={selectClass} value={form.paymentAccountCode} onChange={set('paymentAccountCode')} required>
                      <option value="">Choose…</option>
                      {byType('asset').map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Asset account it funded — optional">
                    <select className={selectClass} value={form.assetAccountCode} onChange={set('assetAccountCode')}>
                      <option value="">None</option>
                      {byType('asset').map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </CardBody>
            </Card>
          </>
        ) : (
          <Card className="mb-4">
            <CardHeader>
              <h3 className="font-semibold text-[var(--text-strong)]">Shareholder loan</h3>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Interest rate on the loan (%)" hint="0 for an interest-free loan — the s.80.4 benefit is then estimated">
                  <Input type="number" step="0.0001" min="0" value={form.annualRatePct} onChange={set('annualRatePct')} />
                </Field>
                {kind === 'shareholder_advance' && (
                  <Field label="CRA prescribed rate (%)" hint="Changes quarterly — used only for the s.80.4 benefit estimate">
                    <Input type="number" step="0.0001" min="0" value={form.prescribedRatePct} onChange={set('prescribedRatePct')} placeholder="e.g. 5" />
                  </Field>
                )}
                <Field label="Account" hint="Auto-create uses the shareholder account from the chart">
                  <select className={selectClass} value={form.loanAccountCode} onChange={set('loanAccountCode')}>
                    {accountOptions(
                      kind === 'shareholder_advance' ? byType('asset') : byType('liability'),
                      kind === 'shareholder_advance' ? 'Auto: 1300 Due from Shareholder' : 'Auto: 2600 Due to Shareholder'
                    )}
                  </select>
                </Field>
                <Field label="First advance date">
                  <Input type="date" value={form.initialAdvanceDate} onChange={set('initialAdvanceDate')} />
                </Field>
                <Field label="First advance amount ($)" hint="More advances and repayments are recorded on the loan page — each advance carries its own s.15(2) deadline">
                  <Input type="number" step="0.01" min="0" value={form.initialAdvanceAmount} onChange={set('initialAdvanceAmount')} />
                </Field>
              </div>
              {kind === 'shareholder_advance' && (
                <p className="text-xs text-[var(--text-faint)] mt-3">
                  Each advance must be repaid within one year after the end of the taxation year it was
                  made in, or it becomes personal income to the shareholder under s.15(2). The tool
                  tracks every deadline and warns at 180, 90 and 30 days. Warnings only — it never
                  posts a clearing journal for you.
                </p>
              )}
            </CardBody>
          </Card>
        )}

        <Card className="mb-4">
          <CardBody>
            <Field label="Notes">
              <Input value={form.notes} onChange={set('notes')} placeholder="Agreement number, statement details…" />
            </Field>
            <div className="flex gap-2 mt-4">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : null} Create loan
              </Button>
              <Button type="button" variant="ghost" onClick={() => router.push('/loans')}>
                Cancel
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
    </AppShell>
  );
}
