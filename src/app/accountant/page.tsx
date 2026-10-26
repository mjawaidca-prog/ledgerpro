'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Building2, ArrowRight, Loader2, Users, FileText,
  AlertTriangle, CheckCircle2, Clock, CreditCard, TrendingUp,
  Briefcase,
} from 'lucide-react';

interface ClientCompany {
  id: string;
  name: string;
  planName: string;
  subscriptionStatus: string;
  role: string;
  memberCount: number;
  overdueInvoices: number;
  unreconciledCount: number;
  lastActivity: string | null;
}

export default function AccountantPage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  const [companyCount, setCompanyCount] = useState<number | null>(null);

  // Phase 0 (P0-1): this page previously decided "you only have one
  // company" from session.user.availableCompanies captured on first render
  // — which is empty while the session is still loading — and then read a
  // nested `m.company` shape that GET /api/companies does not return (the
  // API returns FLAT company objects). Result on a real 5-company account:
  // "You currently only have one company." Load the list from the API on
  // mount and only conclude the count once it has actually loaded.
  useEffect(() => {
    fetchClientData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchClientData() {
    setLoading(true);
    try {
      const companies = await fetch('/api/companies').then(r => r.json());
      const data: any[] = companies.data || [];
      setCompanyCount(data.length);

      const enriched: ClientCompany[] = data.map((c: any) => ({
        id: c.id,
        name: c.name,
        planName: typeof c.plan === 'string' ? c.plan : c.plan?.name || 'Free Trial',
        subscriptionStatus: c.status || 'trialing',
        role: c.role || 'owner',
        memberCount: 1,
        // The old code fetched /api/dashboard inside this loop, but that
        // endpoint only ever describes the ACTIVE company — every client
        // card would have shown the same overdue count. A per-company
        // summary endpoint is the real fix (Phase 1); show 0 until then
        // rather than another company's numbers.
        overdueInvoices: 0,
        unreconciledCount: 0,
        lastActivity: c.updatedAt || null,
      }));
      setClients(enriched);
    } catch {} finally { setLoading(false); }
  }

  async function handleSwitch(companyId: string) {
    setSwitching(companyId);
    try {
      await fetch('/api/companies/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      router.push('/dashboard');
    } catch {} finally { setSwitching(null); }
  }

  if (!loading && companyCount !== null && companyCount <= 1) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--primary-soft)] grid place-items-center mx-auto mb-4">
            <Briefcase size={28} className="text-[var(--primary)]" />
          </div>
          <h2 className="text-xl font-bold text-[var(--text-strong)] mb-2">Accountant Dashboard</h2>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mb-4">
            The accountant dashboard lets you manage multiple client companies from one place.
            You currently only have one company, so this view isn't needed yet.
          </p>
          <p className="text-xs text-[var(--text-faint)]">
            Add another company from the company switcher to unlock this feature.
          </p>
        </div>
      </AppShell>
    );
  }

  const statusColors: Record<string, string> = {
    active: 'var(--success)', trialing: 'var(--primary)',
    past_due: 'var(--danger)', canceled: 'var(--text-muted)',
  };

  return (
    <AppShell>
      <div className="max-w-5xl">
        <div className="content-head">
          <div>
            <h1 className="greet">Accountant Dashboard</h1>
            <p className="sub">Manage all your client companies from one place.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-[var(--text-muted)]" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5">
            {clients.map((c) => (
              <Card key={c.id} className="hover:shadow-[var(--shadow-md)] transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-xl grid place-items-center text-white font-bold text-sm"
                        style={{ background: c.role === 'owner' ? 'linear-gradient(135deg, #1f6feb, #7c3aed)' : 'linear-gradient(135deg, #16a063, #54c389)' }}
                      >
                        {c.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-[var(--text-strong)]">{c.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-mono uppercase text-[var(--text-faint)]">{c.role}</span>
                          <Badge
                            variant={c.subscriptionStatus === 'active' ? 'paid' : c.subscriptionStatus === 'trialing' ? 'info' : 'draft'}
                          >
                            {c.subscriptionStatus}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-semibold" style={{ color: statusColors[c.subscriptionStatus] || 'var(--text-muted)' }}>
                      {c.planName}
                    </span>
                  </div>
                </CardHeader>
                <CardBody>
                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-3 mb-5">
                    {[
                      { label: 'Overdue', value: String(c.overdueInvoices), icon: AlertTriangle, color: c.overdueInvoices > 0 ? 'var(--danger)' : 'var(--text-muted)' },
                      { label: 'Members', value: String(c.memberCount), icon: Users, color: 'var(--text-muted)' },
                      { label: 'Last Active', value: c.lastActivity ? formatDistanceToNow(new Date(c.lastActivity), { addSuffix: true }) : '—', icon: Clock, color: 'var(--text-muted)', isText: true },
                    ].map((stat) => (
                      <div key={stat.label} className="bg-[var(--surface-2)] rounded-xl p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5 mb-1">
                          <stat.icon size={12} style={{ color: stat.color || 'var(--text-muted)' }} />
                          <span className="text-[10px] font-mono uppercase text-[var(--text-faint)]">{stat.label}</span>
                        </div>
                        <div className={cn('text-sm font-bold', stat.isText ? 'text-[var(--text-muted)]' : '')} style={stat.isText ? undefined : { color: stat.color }}>
                          {stat.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      disabled={switching === c.id}
                      onClick={() => handleSwitch(c.id)}
                    >
                      {switching === c.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <><ArrowRight size={14} /> Switch to Client</>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        handleSwitch(c.id);
                      }}
                    >
                      <FileText size={14} />
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
