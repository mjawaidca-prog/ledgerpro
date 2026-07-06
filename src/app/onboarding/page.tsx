'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import { fiscalYearDates, BUSINESS_TYPES, PROVINCE_OPTIONS } from '@/lib/taxes';
import {
  Building2, BookOpen, Link2, Check, ArrowRight, ArrowLeft,
  CreditCard, Upload, FileText, Loader2, Calendar,
} from 'lucide-react';

const STEPS = [
  {
    key: 'company',
    title: 'Company Details',
    description: 'Set up your business profile.',
    icon: Building2,
  },
  {
    key: 'coa',
    title: 'Chart of Accounts',
    description: 'Choose a starter COA template.',
    icon: BookOpen,
  },
  {
    key: 'bank',
    title: 'Connect Bank',
    description: 'Link your business accounts.',
    icon: Link2,
  },
  {
    key: 'invoices',
    title: 'Invoice Template',
    description: 'Customize your first invoice.',
    icon: FileText,
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [businessType, setBusinessType] = useState('corporation');
  const [businessNumber, setBusinessNumber] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [province, setProvince] = useState('AB');
  const [fyStartMonth, setFyStartMonth] = useState('1');
  const [fyStartDay, setFyStartDay] = useState('1');
  const [fyStartYear, setFyStartYear] = useState(String(new Date().getFullYear()));
  const [fyEndDate, setFyEndDate] = useState('');
  const [industry, setIndustry] = useState('');
  const [currency, setCurrency] = useState('CAD');

  const currentStep = STEPS[step];
  const StepIcon = currentStep.icon;

  // Auto-calculate fiscal year end when start changes
  function updateFiscalDates(startY: string, startM: string, startD: string) {
    const y = parseInt(startY); const m = parseInt(startM); const d = parseInt(startD);
    if (y && m && d) {
      const { start, end } = fiscalYearDates(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      setFyEndDate(end.toISOString().slice(0, 10));
    }
  }

  async function handleComplete() {
    setLoading(true);
    setError(null);
    try {
      const fyStart = `${fyStartYear}-${fyStartMonth.padStart(2, '0')}-${fyStartDay.padStart(2, '0')}`;
      await fetch('/api/companies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: companyName || undefined,
          legalName: legalName || null,
          businessType: businessType,
          businessNumber: businessNumber || null,
          gstNumber: gstNumber || null,
          province: province,
          fiscalYearStart: fyStart,
          fiscalYearEnd: fyEndDate || undefined,
          locale: 'en-CA',
          currency: 'CAD',
          onboardingComplete: true,
        }),
      });
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Failed to complete setup. You can skip and finish later from Settings.');
    } finally {
      setLoading(false);
    }
  }

  function handleSkip() {
    router.push('/dashboard');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)]">
      <div className="w-full max-w-[540px]">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--primary)] text-white grid place-items-center font-bold text-lg">
              L
            </div>
            <span className="text-xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">
              Ledger<span className="text-[var(--primary)]">Pro</span>
            </span>
          </div>
          <p className="text-sm text-[var(--text-muted)]">Let&apos;s get your account set up</p>
        </div>

        {/* Step progress */}
        <div className="flex items-center justify-center gap-1 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <button
                onClick={() => i < step && setStep(i)}
                className={cn(
                  'w-[32px] h-[32px] rounded-full grid place-items-center text-xs font-bold transition-all',
                  i < step
                    ? 'bg-[var(--success)] text-white cursor-pointer'
                    : i === step
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-[var(--surface-3)] text-[var(--text-faint)]'
                )}
              >
                {i < step ? <Check size={14} /> : i + 1}
              </button>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'w-6 h-[2px] mx-1 rounded-full',
                    i < step ? 'bg-[var(--success)]' : 'bg-[var(--border)]'
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step card */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-md)] p-6">
          {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

          <div className="flex items-center gap-3 mb-6">
            <div className="w-[42px] h-[42px] rounded-xl bg-[var(--primary-soft)] text-[var(--primary)] grid place-items-center">
              <StepIcon size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--text-strong)]">{currentStep.title}</h2>
              <p className="text-sm text-[var(--text-muted)]">{currentStep.description}</p>
            </div>
          </div>

          {/* Step 0: Company Details */}
          {step === 0 && (
            <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
              <div className="field">
                <label>Company Name *</label>
                <input type="text" className="input" placeholder="Northwind Trading" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <div className="field">
                <label>Legal Name</label>
                <input type="text" className="input" placeholder="Northwind Trading LLC" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
              </div>

              {/* Business Type + Province */}
              <div className="grid grid-cols-2 gap-4">
                <div className="field">
                  <label>Business Type *</label>
                  <select className="input" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
                    {BUSINESS_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                  </select>
                </div>
                <div className="field">
                  <label>Province *</label>
                  <select className="input" value={province} onChange={(e) => setProvince(e.target.value)}>
                    {PROVINCE_OPTIONS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
                  </select>
                </div>
              </div>

              {/* BN + GST */}
              <div className="grid grid-cols-2 gap-4">
                <div className="field">
                  <label>Business Number (BN)</label>
                  <input type="text" className="input" placeholder="123456789" value={businessNumber} onChange={(e) => setBusinessNumber(e.target.value)} maxLength={9} />
                </div>
                <div className="field">
                  <label>GST/HST Number</label>
                  <input type="text" className="input" placeholder="123456789RT0001" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} />
                </div>
              </div>

              {/* Fiscal Year */}
              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-[var(--primary)]" />
                  <span className="text-sm font-semibold text-[var(--text-strong)]">Fiscal Year</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="field">
                    <label className="text-xs">Start Month</label>
                    <select className="input" value={fyStartMonth} onChange={(e) => { setFyStartMonth(e.target.value); updateFiscalDates(fyStartYear, e.target.value, fyStartDay); }}>
                      {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (<option key={m} value={String(i+1)}>{m}</option>))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="text-xs">Start Day</label>
                    <input type="number" className="input" min="1" max="31" value={fyStartDay} onChange={(e) => { setFyStartDay(e.target.value); updateFiscalDates(fyStartYear, fyStartMonth, e.target.value); }} />
                  </div>
                  <div className="field">
                    <label className="text-xs">Start Year</label>
                    <input type="number" className="input" value={fyStartYear} onChange={(e) => { setFyStartYear(e.target.value); updateFiscalDates(e.target.value, fyStartMonth, fyStartDay); }} />
                  </div>
                </div>
                <div className="field">
                  <label className="text-xs">Fiscal Year End (auto-calculated, editable)</label>
                  <input type="date" className="input" value={fyEndDate} onChange={(e) => setFyEndDate(e.target.value)}
                    placeholder="2026-12-31" />
                </div>
                <p className="text-[10px] text-[var(--text-faint)]">
                  The fiscal year end is automatically set to 1 year minus 1 day from the start. Edit if your first fiscal year is shorter (e.g., incorporation year).
                </p>
              </div>

              {/* Currency */}
              <div className="field">
                <label>Currency</label>
                <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="CAD">CAD — Canadian Dollar</option>
                  <option value="USD">USD — US Dollar</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="GBP">GBP — British Pound</option>
                </select>
              </div>

              <div className="field">
                <label>Industry</label>
                <select className="input" value={industry} onChange={(e) => setIndustry(e.target.value)}>
                  <option value="">Select industry...</option>
                  <option value="technology">Technology / SaaS</option>
                  <option value="professional">Professional Services</option>
                  <option value="retail">Retail / E-commerce</option>
                  <option value="construction">Construction</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="realestate">Real Estate</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 1: Chart of Accounts */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--text-muted)]">
                Your account already has a standard chart of accounts set up. You can customize it later from Settings.
              </p>
              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4">
                <h4 className="text-sm font-semibold text-[var(--text-strong)] mb-2">Included accounts:</h4>
                <ul className="space-y-1 text-sm text-[var(--text-muted)]">
                  <li>• Bank Accounts (Checking, Savings)</li>
                  <li>• Accounts Receivable &amp; Payable</li>
                  <li>• Credit Cards</li>
                  <li>• Sales Tax Payable</li>
                  <li>• Owner&apos;s Capital &amp; Retained Earnings</li>
                  <li>• Product Sales &amp; Service Revenue</li>
                  <li>• 7 Expense categories</li>
                </ul>
              </div>
              <p className="text-xs text-[var(--text-faint)]">
                Need a different setup? Go to <strong>Settings → Chart of Accounts</strong> after onboarding.
              </p>
            </div>
          )}

          {/* Step 2: Connect Bank */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-muted)]">
                Connect your bank accounts to automatically import transactions. You can also skip this and import statements manually later.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => router.push('/banking')}
                  className="flex flex-col items-center gap-2 p-5 bg-[var(--surface-2)] border-2 border-dashed border-[var(--border-strong)] rounded-xl hover:border-[var(--border-focus)] transition-colors text-center"
                >
                  <Link2 size={24} className="text-[var(--primary)]" />
                  <span className="text-sm font-semibold text-[var(--text-strong)]">Connect via Plaid</span>
                  <span className="text-xs text-[var(--text-muted)]">Coming soon</span>
                </button>
                <button
                  onClick={() => router.push('/banking')}
                  className="flex flex-col items-center gap-2 p-5 bg-[var(--surface-2)] border-2 border-dashed border-[var(--border-strong)] rounded-xl hover:border-[var(--border-focus)] transition-colors text-center"
                >
                  <Upload size={24} className="text-[var(--primary)]" />
                  <span className="text-sm font-semibold text-[var(--text-strong)]">Import Statement</span>
                  <span className="text-xs text-[var(--text-muted)]">CSV, OFX, PDF</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Invoice Template */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-muted)]">
                Your invoice template is ready to go with your company branding. You can customize it further when creating invoices.
              </p>
              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4">
                <h4 className="text-sm font-semibold text-[var(--text-strong)] mb-2">Default template includes:</h4>
                <ul className="space-y-1 text-sm text-[var(--text-muted)]">
                  <li>• Your company name and logo</li>
                  <li>• Professional invoice layout</li>
                  <li>• Payment terms and instructions</li>
                  <li>• Itemized line items with tax</li>
                  <li>• Email delivery option</li>
                </ul>
              </div>
              <Button variant="secondary" size="sm" onClick={() => router.push('/invoices/new')}>
                <FileText size={14} /> Preview Template
              </Button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              <ArrowLeft size={16} /> Back
            </Button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={handleSkip}>
              Skip for now
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)}>
                Next <ArrowRight size={16} />
              </Button>
            ) : (
              <Button onClick={handleComplete} disabled={loading}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Complete Setup
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
