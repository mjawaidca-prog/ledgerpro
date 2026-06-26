'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { format, formatDistanceToNow } from 'date-fns';
import { Search, Download, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, FileText, Receipt, BookOpen, Users, Building2, ArrowRightLeft } from 'lucide-react';
import { downloadCSV } from '@/lib/export';

const entityIcons: Record<string, React.ElementType> = {
  invoice: FileText, bill: Receipt, journal_entry: BookOpen,
  contact: Users, transaction: Building2, transfer: ArrowRightLeft,
  period_close: FileText,
};

const ENTITY_TYPES = ['', 'invoice', 'bill', 'journal_entry', 'transaction', 'contact', 'transfer', 'period_close'];
const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (entityType) params.set('entityType', entityType);
      if (action) params.set('action', action);
      const res = await fetch(`/api/audit-log?${params}`);
      const json = await res.json();
      setLogs(json.data || []);
      setTotal(json.pagination?.total || 0);
    } catch {} finally { setLoading(false); }
  }, [page, entityType, action]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleExport() {
    const headers = ['Timestamp', 'User', 'Action', 'Entity Type', 'Entity ID', 'Changes'];
    const rows = logs.map((l: any) => [
      new Date(l.createdAt).toISOString(),
      l.user?.name || l.user?.email || 'System',
      l.action,
      l.entityType,
      l.entityId || '',
      l.changes ? JSON.stringify(l.changes) : '',
    ]);
    downloadCSV(`audit-log-export.csv`, headers, rows);
  }

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">Audit Log</h1>
          <p className="sub">Every change to your company's data, recorded for compliance.</p>
        </div>
        <div className="spacer" />
        <Button variant="secondary" onClick={handleExport}>
          <Download size={16} /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <select
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
          className="h-[38px] px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)]"
        >
          <option value="">All entities</option>
          {ENTITY_TYPES.filter(Boolean).map((et) => (
            <option key={et} value={et}>{et.replace('_', ' ')}</option>
          ))}
        </select>

        <div className="relative flex-1 max-w-[300px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] grid">
            <Search size={16} />
          </span>
          <input
            type="text"
            placeholder="Filter by action..."
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            className="w-full h-[38px] pl-[34px] pr-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)]"
          />
        </div>

        <span className="text-sm text-[var(--text-muted)]">{total} entries</span>
      </div>

      {/* Log Table */}
      <Card>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--text-muted)]">No audit log entries found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                    <th className="text-left p-3 font-medium text-xs uppercase tracking-[0.06em]">Timestamp</th>
                    <th className="text-left p-3 font-medium text-xs uppercase tracking-[0.06em]">User</th>
                    <th className="text-left p-3 font-medium text-xs uppercase tracking-[0.06em]">Action</th>
                    <th className="text-left p-3 font-medium text-xs uppercase tracking-[0.06em]">Entity</th>
                    <th className="text-right p-3 font-medium text-xs uppercase tracking-[0.06em] w-[40px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const Icon = entityIcons[log.entityType] || FileText;
                    return (
                      <>
                        <tr key={log.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer" onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                          <td className="p-3 text-[var(--text-faint)] text-xs font-mono whitespace-nowrap">
                            {format(new Date(log.createdAt), 'MMM d, yyyy HH:mm')}
                            <div className="text-[10px]">{formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}</div>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-[var(--primary)] text-white grid place-items-center text-[10px] font-bold">
                                {log.user?.name ? log.user.name.charAt(0) : 'S'}
                              </div>
                              <span className="text-[var(--text-strong)] text-xs">{log.user?.name || log.user?.email || 'System'}</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <span className="font-mono text-xs text-[var(--text)]">{log.action}</span>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <Icon size={13} className="text-[var(--text-muted)]" />
                              <span className="text-xs text-[var(--text-strong)] capitalize">{log.entityType.replace('_', ' ')}</span>
                              {log.entityId && <span className="text-[10px] font-mono text-[var(--text-faint)]">{log.entityId.slice(0, 20)}</span>}
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            {expandedId === log.id ? <ChevronUp size={14} className="text-[var(--text-muted)]" /> : <ChevronDown size={14} className="text-[var(--text-muted)]" />}
                          </td>
                        </tr>
                        {expandedId === log.id && log.changes && (
                          <tr key={`${log.id}-detail`} className="bg-[var(--surface-2)] border-b border-[var(--border)]">
                            <td colSpan={5} className="p-4">
                              <div className="font-mono text-xs bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)] max-h-[200px] overflow-y-auto whitespace-pre-wrap text-[var(--text-muted)]">
                                {JSON.stringify(log.changes, null, 2)}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
              <span className="text-xs text-[var(--text-muted)]">Page {page} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft size={14} /> Prev
                </Button>
                <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  Next <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </AppShell>
  );
}
