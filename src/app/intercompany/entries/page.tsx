'use client';

import { useState, useEffect } from 'react';
import { ArrowRight, Zap } from 'lucide-react';

interface Entry {
  id: string;
  reference: string;
  date: string;
  kind: string;
  memo: string;
  amount: string;
  status: 'POSTED' | 'VOIDED' | 'UNMATCHED';
  sourceCompanyName: string;
  targetCompanyName: string;
  sourceLine: string;
  targetLine: string;
}

function money(n: string): string {
  const v = parseFloat(n);
  if (isNaN(v)) return '0.00';
  return v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function kindLabel(k: string): string {
  return { FUND_TRANSFER: 'Fund transfer', EXPENSE_ON_BEHALF: 'Paid on behalf', RECHARGE: 'Recharge', JOURNAL: 'Journal' }[k] || k;
}

export default function EntriesPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadEntries();
  }, []);

  async function loadEntries() {
    try {
      const res = await fetch('/api/intercompany/transactions?limit=50');
      const json = await res.json();
      const list = (json.data || []).map((t: any) => ({
        id: t.id,
        reference: t.reference,
        date: t.date?.slice(0, 10),
        kind: t.kind,
        memo: t.memo || '',
        amount: t.amount,
        status: t.status,
        sourceCompanyName: t.link?.companyA?.id === t.sourceCompanyId ? t.link?.companyA?.name : t.link?.companyB?.name,
        targetCompanyName: t.link?.companyA?.id === t.targetCompanyId ? t.link?.companyA?.name : t.link?.companyB?.name,
        sourceLine: t.sourceEntry?.lines
          ? `Dr ${t.sourceEntry.lines[0]?.glAccountCode}  ·  Cr ${t.sourceEntry.lines[1]?.glAccountCode}`
          : '',
        targetLine: t.mirrorEntry?.lines
          ? `Dr ${t.mirrorEntry.lines[0]?.glAccountCode}  ·  Cr ${t.mirrorEntry.lines[1]?.glAccountCode}`
          : t.status === 'UNMATCHED' ? 'No entry posted — reconciliation break' : '',
      }));
      setEntries(list);
    } catch (e) {
      console.error('Failed to load entries', e);
    } finally {
      setLoading(false);
    }
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }

  if (loading) {
    return <div style={{ color: 'var(--text-muted)' }}>Loading entries…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)' }}>
            Linked entries
          </div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>
            Every pair, traceable both ways.
          </h1>
        </div>
      </div>

      {entries.length === 0 ? (
        <div style={{
          background: 'var(--surface)', border: '1px dashed var(--border)',
          borderRadius: 'var(--r-lg)', padding: 40, textAlign: 'center',
          color: 'var(--text-muted)', fontSize: 'var(--text-base)',
        }}>
          No inter-company transactions yet. Post your first one from the New Transfer screen.
        </div>
      ) : (
        entries.map((t) => {
          const isLinked = t.status === 'POSTED';
          const dotColor = isLinked ? 'var(--success)' : 'var(--danger)';
          return (
            <div key={t.id} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)',
              padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 'var(--r-full)', flex: 'none', background: dotColor }} />
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>{t.date}</span>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', fontWeight: 500 }}>{t.memo}</span>
                  <span style={{
                    border: '1px solid var(--border)', borderRadius: 'var(--r-full)',
                    padding: '3px 9px', fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                  }}>{kindLabel(t.kind)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-strong)', fontSize: 'var(--text-md)', fontVariantNumeric: 'tabular-nums' }}>
                    {money(t.amount)}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: dotColor, fontWeight: 500 }}>
                    {isLinked ? `Linked · ${t.reference}` : 'Unmatched'}
                  </span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 30px minmax(0,1fr)', gap: 8, alignItems: 'center' }}>
                <div style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)', padding: '11px 13px',
                  display: 'flex', flexDirection: 'column', gap: 5,
                }}>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)' }}>{t.sourceCompanyName}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text)' }}>{t.sourceLine}</span>
                </div>
                <div style={{ display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>
                  <ArrowRight size={16} />
                </div>
                <div style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)', padding: '11px 13px',
                  display: 'flex', flexDirection: 'column', gap: 5,
                }}>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)' }}>{t.targetCompanyName}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text)' }}>{t.targetLine}</span>
                </div>
              </div>
            </div>
          );
        })
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface-2)', border: '1px solid var(--warning)',
          borderRadius: 'var(--r-full)', padding: '11px 20px',
          boxShadow: 'var(--shadow-md)', display: 'flex', alignItems: 'center',
          gap: 10, zIndex: 60,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 'var(--r-full)', background: 'var(--success)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text)' }}>{toast}</span>
        </div>
      )}
    </div>
  );
}
