'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import {
  ArrowLeft, CreditCard, Check, Loader2, ExternalLink,
  Building2, Users, Download, FileText, ArrowRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Plan {
  id: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  maxUsers: number;
  maxCompanies: number;
  maxTransactions: number;
  maxBankAccounts: number;
  csvExport: boolean;
  pdfReports: boolean;
  bankFeeds: boolean;
  customReports: boolean;
  prioritySupport: boolean;
  whiteLabel: boolean;
}

interface SubscriptionData {
  id: string;
  planId: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  plan: Plan;
}

export default function BillingPage() {
  const router = useRouter();
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [subRes, plansRes] = await Promise.all([
          fetch('/api/subscriptions').then((r) => r.json()),
          fetch('/api/subscriptions/plans').then((r) => r.json()),
        ]);
        setSubscription(subRes.data);
        setPlans(plansRes.data || []);
      } catch {} finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSwitchPlan(planId: string) {
    setSwitching(planId);
    setMessage(null);
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to switch plan');
      setSubscription(json.data);
      setMessage({ type: 'success', text: `Switched to ${json.data.plan.name}.` });
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setSwitching(null);
    }
  }

  if (loading) {
    return (
      <AppShell companyName="Billing" companyPlan="">
        <div className="flex items-center justify-center h-64">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      </AppShell>
    );
  }

  const currentPlan = subscription?.plan;
  const isTrialing = subscription?.status === 'trialing';
  const isActive = subscription?.status === 'active';
  const trialEnd = subscription?.trialEndsAt ? format(new Date(subscription.trialEndsAt), 'MMM d, yyyy') : null;

  return (
    <AppShell companyName="Billing" companyPlan={currentPlan?.name || ''}>
      <div className="max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.push('/settings')} className="p-2 rounded-lg hover:bg-[var(--surface-3)]">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-strong)]">Billing & Plans</h1>
            <p className="text-sm text-[var(--text-muted)]">Manage your subscription and plan.</p>
          </div>
        </div>

        {message && <Alert variant={message.type} className="mb-4">{message.text}</Alert>}

        {/* Current plan */}
        {currentPlan && (
          <Card className="mb-6">
            <CardHeader>
              <h3 className="font-semibold text-[var(--text-strong)]">
                <CreditCard size={16} className="inline mr-2" />
                Current Plan
              </h3>
            </CardHeader>
            <CardBody>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg font-bold text-[var(--text-strong)]">{currentPlan.name}</span>
                    {isTrialing && <Badge variant="pending">Trial</Badge>}
                    {isActive && <Badge variant="paid">Active</Badge>}
                    {subscription?.status === 'past_due' && <Badge variant="overdue">Past Due</Badge>}
                    {subscription?.status === 'canceled' && <Badge variant="draft">Canceled</Badge>}
                  </div>
                  <p className="text-sm text-[var(--text-muted)]">
                    ${currentPlan.monthlyPrice}/month or ${currentPlan.annualPrice}/year
                  </p>
                  {isTrialing && trialEnd && (
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Trial ends {trialEnd}. You won&apos;t be charged until then.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                  <span className="flex items-center gap-1"><Users size={13} /> {currentPlan.maxUsers} user{currentPlan.maxUsers !== 1 ? 's' : ''}</span>
                  <span className="flex items-center gap-1"><Building2 size={13} /> {currentPlan.maxBankAccounts} accounts</span>
                  <span className="flex items-center gap-1"><FileText size={13} /> {currentPlan.maxTransactions.toLocaleString()} txs</span>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Plan comparison */}
        <h3 className="text-lg font-bold text-[var(--text-strong)] mb-4">Available Plans</h3>
        <div className="grid grid-cols-4 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.id === currentPlan?.id;
            return (
              <Card
                key={plan.id}
                className={cn(
                  'transition-all',
                  isCurrent && 'ring-2 ring-[var(--border-focus)] border-[var(--border-focus)]'
                )}
              >
                <CardHeader>
                  <h4 className="font-bold text-[var(--text-strong)]">{plan.name}</h4>
                  <div className="mt-2">
                    <span className="text-2xl font-bold text-[var(--text-strong)]">${plan.monthlyPrice}</span>
                    <span className="text-sm text-[var(--text-muted)]">/mo</span>
                  </div>
                </CardHeader>
                <CardBody className="space-y-3">
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2 text-[var(--text-muted)]">
                      <Check size={13} className="text-[var(--success)] flex-none" />
                      {plan.maxUsers} user{plan.maxUsers !== 1 ? 's' : ''}
                    </li>
                    <li className="flex items-center gap-2 text-[var(--text-muted)]">
                      <Check size={13} className="text-[var(--success)] flex-none" />
                      {plan.maxBankAccounts} bank accounts
                    </li>
                    <li className="flex items-center gap-2 text-[var(--text-muted)]">
                      <Check size={13} className="text-[var(--success)] flex-none" />
                      {plan.maxTransactions.toLocaleString()} transactions
                    </li>
                    {plan.csvExport && (
                      <li className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Check size={13} className="text-[var(--success)] flex-none" />
                        CSV Export
                      </li>
                    )}
                    {plan.pdfReports && (
                      <li className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Check size={13} className="text-[var(--success)] flex-none" />
                        PDF Reports
                      </li>
                    )}
                    {plan.bankFeeds && (
                      <li className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Check size={13} className="text-[var(--success)] flex-none" />
                        Bank Feeds
                      </li>
                    )}
                    {plan.customReports && (
                      <li className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Check size={13} className="text-[var(--success)] flex-none" />
                        Custom Reports
                      </li>
                    )}
                    {plan.prioritySupport && (
                      <li className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Check size={13} className="text-[var(--success)] flex-none" />
                        Priority Support
                      </li>
                    )}
                  </ul>
                  {isCurrent ? (
                    <Button variant="secondary" disabled className="w-full">Current Plan</Button>
                  ) : (
                    <Button
                      variant={plan.monthlyPrice > (currentPlan?.monthlyPrice || 0) ? 'primary' : 'secondary'}
                      className="w-full"
                      onClick={() => handleSwitchPlan(plan.id)}
                      disabled={switching === plan.id}
                    >
                      {switching === plan.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : plan.monthlyPrice > (currentPlan?.monthlyPrice || 0) ? (
                        <ArrowRight size={14} />
                      ) : (
                        <ArrowRight size={14} />
                      )}
                      {plan.monthlyPrice > (currentPlan?.monthlyPrice || 0) ? 'Upgrade' : 'Switch'}
                    </Button>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>

        {/* Stripe note */}
        <p className="text-xs text-[var(--text-faint)] mt-6 text-center">
          Payments are processed securely via Stripe. You can cancel anytime.
          {' '}<a href="#" className="text-[var(--accent)] hover:underline">View billing history</a>.
        </p>
      </div>
    </AppShell>
  );
}
