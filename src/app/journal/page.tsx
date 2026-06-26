'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { Plus, FileText, ChevronRight, Loader2 } from 'lucide-react';

interface JournalLine {
  glAccountCode: string;
  description: string | null;
  debit: number;
  credit: number;
}

interface JournalEntry {
  id: string;
  entryDate: string;
  description: string;
  sourceType: string;
  sourceId: string | null;
  lines: JournalLine[];
  createdAt: string;
}

export default function JournalListPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/journal?page=${page}&limit=25`);
        const json = await res.json();
        setEntries(Array.isArray(json.data) ? json.data : []);
        setTotalPages(json.pagination?.totalPages || 1);
      } catch { setEntries([]); } finally { setLoading(false); }
    }
    load();
  }, [page]);

  const sourceLabels: Record<string, string> = {
    invoice: 'Invoice', bill: 'Bill', payment: 'Payment',
    transfer: 'Transfer', manual: 'Manual',
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">Journal Entries</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Complete audit trail of all financial activity.
          </p>
        </div>
        <Button onClick={() => router.push('/journal/new')}>
          <Plus size={16} /> New Entry
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 className="animate-spin text-[var(--text-muted)]" size={24} /></div>
      ) : (
        <Card>
          <CardBody className="p-0">
            {entries.length === 0 ? (
              <div className="text-center py-12 text-[var(--text-muted)]">
                <FileText size={40} className="mx-auto mb-3 opacity-30" />
                <p>No journal entries yet.</p>
                <Button variant="ghost" onClick={() => router.push('/journal/new')} className="mt-2">
                  <Plus size={14} /> Create your first entry
                </Button>
              </div>
            ) : (
              <div>
                {entries.map((entry) => {
                  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
                  return (
                    <div key={entry.id} onClick={() => router.push(`/journal/${entry.id}`)} className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-3)] transition-colors cursor-pointer group">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className={cn(
                          'w-9 h-9 rounded-lg grid place-items-center flex-none',
                          entry.sourceType === 'manual' ? 'bg-[var(--warning-soft)] text-[var(--warning)]' :
                          entry.sourceType === 'invoice' ? 'bg-[var(--primary-soft)] text-[var(--accent)]' :
                          'bg-[var(--neutral-soft)] text-[var(--text-muted)]'
                        )}>
                          <FileText size={16} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--text-strong)] truncate group-hover:text-[var(--primary)] transition-colors">
                            {entry.description}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mt-0.5">
                            <span>{format(new Date(entry.entryDate), 'MMM d, yyyy h:mm a')}</span>
                            <span>·</span>
                            <Badge variant="neutral">{sourceLabels[entry.sourceType] || entry.sourceType}</Badge>
                            <span>·</span>
                            <span>{entry.lines.length} line{entry.lines.length !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-mono text-sm font-medium text-[var(--text)]">{money(totalDebit)}</span>
                        <ChevronRight size={16} className="text-[var(--text-faint)] group-hover:text-[var(--text)] transition-colors" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-[var(--text-muted)]">Page {page} of {totalPages}</span>
          <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </AppShell>
  );
}
