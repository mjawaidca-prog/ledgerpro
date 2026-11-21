'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import {
  Loader2, HeartPulse, AlertTriangle, Eye, CheckCircle2, Ban, RotateCcw, ArrowRight,
} from 'lucide-react';
import type {
  DismissedHealthFlag, HealthCheck, HealthFlag, HealthReport,
} from '@/lib/health/engine';

interface HealthData extends HealthReport {
  companyName: string;
  dismissed: DismissedHealthFlag[];
}

function FlagCard({
  flag,
  onDismiss,
}: {
  flag: HealthFlag;
  onDismiss: (flag: HealthFlag, reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await onDismiss(flag, reason.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-[var(--border)] pb-4 last:border-0 last:pb-0">
      <div className="flex items-center gap-2">
        {flag.severity === 'attention'
          ? <Ban size={15} className="text-[var(--danger)]" />
          : <AlertTriangle size={15} className="text-[var(--warning)]" />}
        <span className="font-medium text-[var(--text-strong)]">{flag.title}</span>
        <span className="spacer" />
        <Badge variant={flag.severity === 'attention' ? 'overdue' : 'pending'}>
          {flag.severity === 'attention' ? 'Needs attention' : 'Worth a look'}
        </Badge>
      </div>
      <p className="text-sm text-[var(--text-muted)] mt-1">{flag.detail}</p>
      {flag.figures.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2">
          {flag.figures.map((f) => (
            <span key={f.label} className="text-xs text-[var(--text-muted)]">
              {f.label}: <span className="font-mono tabular-nums text-[var(--text)]">{f.value}</span>
            </span>
          ))}
        </div>
      )}
      {flag.items.length > 0 && (
        <ul className="list-disc pl-5 mt-2 space-y-0.5">
          {flag.items.map((item) => (
            <li key={item} className="text-xs text-[var(--text-muted)]">{item}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3 mt-2">
        {flag.href && (
          <Link href={flag.href} className="text-xs font-medium text-[var(--accent)] inline-flex items-center gap-1">
            Review <ArrowRight size={12} />
          </Link>
        )}
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Dismiss — checked, this is fine
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <textarea
            className="input w-full"
            rows={2}
            placeholder="Why is this fine? The reason stays on record with the dismissal."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button onClick={submit} disabled={saving || !reason.trim()}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : null} Dismiss this flag
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckGroup({
  title,
  icon,
  checks,
  onDismiss,
}: {
  title: string;
  icon: React.ReactNode;
  checks: HealthCheck[];
  onDismiss: (flag: HealthFlag, reason: string) => Promise<void>;
}) {
  if (checks.length === 0) return null;
  return (
    <Card className="mb-4">
      <CardHeader>
        <h3 className="t-h3 flex items-center gap-2">{icon} {title}</h3>
      </CardHeader>
      <CardBody>
        <div className="space-y-5">
          {checks.map((check) => (
            <div key={check.id}>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                {check.label}
              </p>
              <div className="space-y-4">
                {check.flags.map((flag) => (
                  <FlagCard key={flag.fingerprint} flag={flag} onDismiss={onDismiss} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

export default function BooksHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/books-health').then((r) => r.json());
      if (res.error) {
        setError(res.error);
        return;
      }
      setData(res.data);
    } catch {
      setError('Failed to run the books health check.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dismiss = useCallback(
    async (flag: HealthFlag, reason: string) => {
      await fetch('/api/reports/books-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: flag.fingerprint, reason }),
      });
      await load();
    },
    [load]
  );

  const restore = useCallback(
    async (fingerprint: string) => {
      await fetch(`/api/reports/books-health?fingerprint=${encodeURIComponent(fingerprint)}`, {
        method: 'DELETE',
      });
      await load();
    },
    [load]
  );

  if (loading && !data) {
    return (
      <AppShell>
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      </AppShell>
    );
  }

  const summary = data?.summary;
  const attentionChecks = data?.checks.filter((c) => c.status === 'attention') ?? [];
  const lookChecks = data?.checks.filter((c) => c.status === 'look') ?? [];
  const healthyChecks = data?.checks.filter((c) => c.flags.length === 0) ?? [];

  return (
    <AppShell>
      <div className="max-w-4xl">
        <div className="content-head">
          <div>
            <h1 className="greet">Books Health</h1>
            <p className="sub">
              The anomaly &amp; duplicate radar: deterministic checks over the last 12 months of these
              books. Every flag names its evidence — amounts, dates, accounts. Dismiss a flag with a
              reason and it stays dismissed for exactly that item.
            </p>
          </div>
          <div className="spacer" />
          {summary && (
            <div className="flex gap-2">
              <Badge variant="overdue">{summary.attention} needs attention</Badge>
              <Badge variant="pending">{summary.look} worth a look</Badge>
              <Badge variant="paid">{summary.healthyChecks} healthy</Badge>
            </div>
          )}
        </div>

        {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

        {summary && summary.overall === 'healthy' && (
          <Alert variant="success" className="mb-4">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} /> Every check passes on these books as of {data?.asOf}.
              The radar re-runs on every visit — new activity is judged fresh.
            </span>
          </Alert>
        )}

        <CheckGroup
          title="Needs attention"
          icon={<Ban size={16} className="text-[var(--danger)]" />}
          checks={attentionChecks}
          onDismiss={dismiss}
        />
        <CheckGroup
          title="Worth a look"
          icon={<Eye size={16} className="text-[var(--warning)]" />}
          checks={lookChecks}
          onDismiss={dismiss}
        />

        {healthyChecks.length > 0 && (
          <Card className="mb-4">
            <CardHeader>
              <h3 className="t-h3 flex items-center gap-2">
                <HeartPulse size={16} className="text-[var(--success)]" /> Healthy
              </h3>
            </CardHeader>
            <CardBody>
              <div className="space-y-3">
                {healthyChecks.map((check) => (
                  <div key={check.id} className="flex items-start gap-2">
                    <CheckCircle2 size={15} className="text-[var(--success)] mt-0.5" />
                    <div>
                      <span className="font-medium text-[var(--text-strong)]">{check.label}</span>
                      <p className="text-sm text-[var(--text-muted)]">{check.healthyDetail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {data && data.dismissed.length > 0 && (
          <Card className="mb-4">
            <CardHeader>
              <h3 className="t-h3 flex items-center gap-2">
                <RotateCcw size={16} /> Dismissed ({data.dismissed.length})
              </h3>
            </CardHeader>
            <CardBody>
              <div className="space-y-4">
                {data.dismissed.map(({ flag, reason, dismissedAt }) => (
                  <div key={flag.fingerprint} className="border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--text-strong)]">{flag.title}</span>
                      <span className="spacer" />
                      <button
                        onClick={() => restore(flag.fingerprint)}
                        className="text-xs font-medium text-[var(--accent)]"
                      >
                        Restore
                      </button>
                    </div>
                    <p className="text-sm text-[var(--text-muted)] mt-1">
                      Dismissed {dismissedAt.slice(0, 10)} — “{reason}”
                    </p>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
