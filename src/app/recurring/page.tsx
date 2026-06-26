'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { money } from '@/lib/money';
import { format, formatDistanceToNow } from 'date-fns';
import { Plus, Loader2, Repeat, Zap, Trash2, Pause, Play } from 'lucide-react';

const freqLabels: Record<string, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };

export default function RecurringPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/recurring');
      setTemplates((await res.json()).data || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleRunAll() {
    setProcessing(true);
    try {
      const res = await fetch('/api/recurring/run', { method: 'POST' });
      const json = await res.json();
      alert(json.data?.message || `Processed ${json.data?.processed || 0} templates`);
      fetchData();
    } catch {} finally { setProcessing(false); }
  }

  async function handleToggle(id: string, active: boolean) {
    await fetch(`/api/recurring/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    });
    fetchData();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this recurring template?')) return;
    await fetch(`/api/recurring/${id}`, { method: 'DELETE' });
    fetchData();
  }

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">Recurring Transactions</h1>
          <p className="sub">Automate repeat journal entries — rent, subscriptions, payroll, loan payments.</p>
        </div>
        <div className="spacer" />
        <Button variant="secondary" onClick={handleRunAll} disabled={processing}>
          {processing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          Run Due Now
        </Button>
        <Button onClick={() => router.push('/recurring/new')}><Plus size={14} /> New Template</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div>
      ) : templates.length === 0 ? (
        <Card><CardBody><div className="text-center py-12">
          <Repeat size={36} className="text-[var(--text-faint)] mx-auto mb-3" />
          <p className="text-sm text-[var(--text-muted)] mb-4">No recurring templates yet.</p>
          <Button onClick={() => router.push('/recurring/new')}><Plus size={14} /> Create your first recurring entry</Button>
        </div></CardBody></Card>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardBody>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl grid place-items-center ${t.active ? 'bg-[var(--success-soft)]' : 'bg-[var(--neutral-soft)]'}`}>
                      <Repeat size={18} className={t.active ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-[var(--text-strong)]">{t.name}</h3>
                        <Badge variant={t.active ? 'paid' : 'draft'}>{t.active ? 'Active' : 'Paused'}</Badge>
                        <Badge variant="info">{freqLabels[t.frequency] || t.frequency}</Badge>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Next: {format(new Date(t.nextPostDate), 'MMM d, yyyy')}
                        {t.lastPostedAt && ` · Last: ${formatDistanceToNow(new Date(t.lastPostedAt), { addSuffix: true })}`}
                        {t.timesPosted > 0 && ` · ${t.timesPosted} posted`}
                      </p>
                      {t.lines && (
                        <div className="flex gap-3 mt-1">
                          {t.lines.slice(0, 3).map((l: any, i: number) => (
                            <span key={i} className="text-[10px] font-mono text-[var(--text-faint)]">
                              {l.glAccountCode}: {Number(l.debit) > 0 ? `DR ${money(Number(l.debit))}` : `CR ${money(Number(l.credit))}`}
                            </span>
                          ))}
                          {t.lines.length > 3 && <span className="text-[10px] text-[var(--text-faint)]">+{t.lines.length - 3} more</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => router.push(`/recurring/${t.id}`)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleToggle(t.id, t.active)}>
                      {t.active ? <Pause size={14} /> : <Play size={14} />}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-[var(--danger)]" onClick={() => handleDelete(t.id)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
