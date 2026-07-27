'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Wand2 } from 'lucide-react';

interface ReconRow {
  linkId: string;
  companyA: string;
  companyB: string;
  dueFrom: string;
  dueTo: string;
  difference: string;
  color: string;
  status: 'Matched' | 'Break';
  hasUnmatched: boolean;
}

export default function ReconciliationPage() {
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadReconciliation();
  }, []);

  async function loadReconciliation(date?: string) {
    setLoading(true);
    try {
      const d = date || asOf;
      const res = await fetch(`/api/intercompany/reconciliation?asOf=${d}`);
      const json = await res.json();
      setRows(json.data.rows || []);
    } catch (e) {
      console.error('Failed to load reconciliation', e);
    } finally {
      setLoading(false);
    }
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }

  const hasBreak = rows.some(r => r.status === 'Break');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)' }}>
          Inter-company reconciliation · as at {asOf}
        </div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>
          Where the two sides disagree.
        </h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text)', maxWidth: '62ch', margin: 0, lineHeight: 1.6 }}>
          Each row nets one company&apos;s <strong>Due from</strong> against the counterparty&apos;s <strong>Due to</strong>. In a consolidated group the difference must be zero.
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>As at:</label>
        <input type="date" value={asOf} onChange={e => { setAsOf(e.target.value); loadReconciliation(e.target.value); }}
          style={{
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
            padding: '8px 12px', outline: 'none',
          }} />
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{
          background: 'var(--surface)', border: '1px dashed var(--border)',
          borderRadius: 'var(--r-lg)', padding: 40, textAlign: 'center',
          color: 'var(--text-muted)', fontSize: 'var(--text-base)',
        }}>
          No related-party links exist yet. Create one from the Relationships screen.
        </div>
      ) : (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)', overflowX: 'auto',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(120px,1.4fr) minmax(120px,1.4fr) minmax(80px,110px) minmax(80px,110px) minmax(80px,110px) minmax(76px,100px)',
            gap: 12, minWidth: 760, padding: '12px 18px',
            borderBottom: '1px solid var(--border)', background: 'var(--surface-2)',
          }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)' }}>Company</span>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)' }}>Counterparty</span>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textAlign: 'right' }}>Due from</span>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textAlign: 'right' }}>Due to</span>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textAlign: 'right' }}>Difference</span>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textAlign: 'right' }}>Status</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px,1.4fr) minmax(120px,1.4fr) minmax(80px,110px) minmax(80px,110px) minmax(80px,110px) minmax(76px,100px)',
              gap: 12, minWidth: 760, padding: '14px 18px',
              borderBottom: '1px solid var(--neutral-soft-border)', alignItems: 'center',
            }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', fontWeight: 500 }}>{r.companyA}</span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>{r.companyB}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', textAlign: 'right', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{r.dueFrom}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', textAlign: 'right', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{r.dueTo}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', textAlign: 'right', color: r.color, fontVariantNumeric: 'tabular-nums' }}>{r.difference}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end' }}>
                <span style={{ width: 7, height: 7, borderRadius: 'var(--r-full)', background: r.color }} />
                <span style={{ fontSize: 'var(--text-xs)', color: r.color, fontWeight: 500 }}>{r.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasBreak && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--danger)',
          borderRadius: 'var(--r-lg)', padding: 18, display: 'flex', gap: 14,
          alignItems: 'flex-start',
        }}>
          <AlertTriangle size={18} style={{ color: 'var(--danger)', flex: 'none', marginTop: 2 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>
              One or more entries have no counterpart
            </h3>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', maxWidth: '70ch', margin: 0, lineHeight: 1.6 }}>
              These entries were posted before related-party linking existed, causing the group to be out of balance. Use the Relationships screen to link the companies, then run the detection on the Linked Entries screen to generate the missing contra entries.
            </p>
          </div>
        </div>
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
