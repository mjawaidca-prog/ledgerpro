'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, addMonths, startOfMonth } from 'date-fns';
import { Plus, Trash2, Loader2, Save, Download, BarChart3, BookOpen } from 'lucide-react';
import { exportReport } from '@/lib/export';
import { useRouter } from 'next/navigation';

export default function CustomReportBuilder() {
  const router = useRouter();
  const [coa, setCoa] = useState<any[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [reportType, setReportType] = useState('balance_summary');
  const [groupBy, setGroupBy] = useState('type');
  const [period, setPeriod] = useState('year');
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/coa').then(r => r.json()).then(j => setCoa(j.data || [])).catch(() => {});
    fetchSaved();
  }, []);

  async function fetchSaved() {
    try {
      const res = await fetch('/api/reports/custom');
      setSavedTemplates((await res.json()).data || []);
    } catch {}
  }

  async function handleGenerate() {
    if (selectedAccounts.length === 0) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: reportType, groupBy, period, accounts: selectedAccounts.join(',') });
      const res = await fetch(`/api/reports/custom?${params}`);
      setReportData((await res.json()).data);
    } catch {} finally { setLoading(false); }
  }

  async function handleSaveTemplate() {
    const name = prompt('Template name:');
    if (!name) return;
    await fetch('/api/reports/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, reportType, config: { selectedAccounts, groupBy, period } }),
    });
    fetchSaved();
  }

  function toggleAccount(code: string) {
    setSelectedAccounts(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  }

  function handleExport() {
    if (!reportData?.rows) return;
    exportReport(reportData.rows, `custom-report-${Date.now()}.csv`,
      ['Account', 'Type', 'Balance'],
      (r: any) => [r.code || r.name, r.type || '', String(r.balance || r.amount || '')]
    );
  }

  const groupedAccounts: Record<string, any[]> = {};
  for (const a of coa) {
    const group = a.type || 'other';
    if (!groupedAccounts[group]) groupedAccounts[group] = [];
    groupedAccounts[group].push(a);
  }

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">Custom Report Builder</h1>
          <p className="sub">Select accounts, choose grouping, and generate custom reports.</p>
        </div>
        <div className="spacer" />
        <Button variant="secondary" onClick={handleSaveTemplate} disabled={selectedAccounts.length === 0}><Save size={14} /> Save Template</Button>
        <Button onClick={handleGenerate} disabled={selectedAccounts.length === 0}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
          Generate
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Account Selection */}
        <div className="col-span-1">
          <Card>
            <CardHeader><h3 className="t-h3">Accounts ({selectedAccounts.length})</h3></CardHeader>
            <CardBody className="max-h-[50vh] overflow-y-auto">
              <div className="space-y-3">
                {Object.entries(groupedAccounts).map(([type, accounts]) => (
                  <div key={type}>
                    <h4 className="text-[10px] font-mono uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1.5 capitalize">{type}</h4>
                    {accounts.map(a => (
                      <label key={a.code} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-[var(--surface-3)] cursor-pointer text-xs">
                        <input type="checkbox" checked={selectedAccounts.includes(a.code)} onChange={() => toggleAccount(a.code)} />
                        <span className="font-mono text-[var(--text-faint)] w-[50px]">{a.code}</span>
                        <span className="text-[var(--text-strong)] truncate">{a.name}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Configuration + Results */}
        <div className="col-span-2 space-y-4">
          <Card>
            <CardHeader><h3 className="t-h3">Configuration</h3></CardHeader>
            <CardBody>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="field">
                  <label>Report Type</label>
                  <select className="input" value={reportType} onChange={e => setReportType(e.target.value)}>
                    <option value="balance_summary">Balance Summary</option>
                    <option value="transaction_detail">Transaction Detail</option>
                  </select>
                </div>
                <div className="field">
                  <label>Group By</label>
                  <select className="input" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                    <option value="type">Account Type</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div className="field">
                  <label>Period</label>
                  <select className="input" value={period} onChange={e => setPeriod(e.target.value)}>
                    <option value="month">This Month</option>
                    <option value="quarter">This Quarter</option>
                    <option value="year">This Year</option>
                  </select>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Results */}
          {reportData && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <h3 className="t-h3">Results</h3>
                  <Button variant="ghost" size="sm" onClick={handleExport}><Download size={14} /> Export</Button>
                </div>
              </CardHeader>
              <CardBody>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left p-2 font-medium text-xs uppercase">Account</th>
                        <th className="text-left p-2 font-medium text-xs uppercase">Type</th>
                        <th className="text-right p-2 font-medium text-xs uppercase">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.rows?.map((r: any, i: number) => (
                        <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--surface-3)]">
                          <td className="p-2 text-[var(--text-strong)]">{r.code ? `${r.code} — ${r.name}` : r.name}</td>
                          <td className="p-2"><Badge variant="info">{r.type}</Badge></td>
                          <td className="p-2 text-right font-mono tabular-nums font-semibold">{money(r.balance || r.amount || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[var(--border)]">
                        <td className="p-2 font-bold" colSpan={2}>Total</td>
                        <td className="p-2 text-right font-mono tabular-nums font-bold">{money(reportData.total || reportData.rows?.reduce((s: number, r: any) => s + (Number(r.balance) || Number(r.amount) || 0), 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Saved Templates */}
          {savedTemplates.length > 0 && (
            <Card>
              <CardHeader><h3 className="t-h3">Saved Templates</h3></CardHeader>
              <CardBody>
                <div className="space-y-2">
                  {savedTemplates.map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between p-2 rounded-lg border border-[var(--border)]">
                      <div className="flex items-center gap-2">
                        <BookOpen size={14} className="text-[var(--text-muted)]" />
                        <span className="text-sm font-medium text-[var(--text-strong)]">{t.name}</span>
                        <Badge variant="info">{t.reportType}</Badge>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => {
                        setReportType(t.reportType);
                        const cfg = t.config as any;
                        if (cfg?.selectedAccounts) setSelectedAccounts(cfg.selectedAccounts);
                        if (cfg?.groupBy) setGroupBy(cfg.groupBy);
                        if (cfg?.period) setPeriod(cfg.period);
                      }}>Load</Button>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
