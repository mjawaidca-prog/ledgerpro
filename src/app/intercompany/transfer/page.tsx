'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Check, Info, ArrowRight } from 'lucide-react';

interface Company {
  id: string;
  name: string;
  bankAccount?: { code: string; label: string };
}

interface AccountOption {
  code: string;
  label: string;
}

interface PreviewLine {
  code: string;
  name: string;
  dr: string;
  cr: string;
}

interface PreviewSide {
  company: string;
  role: string;
  lines: PreviewLine[];
  total: string;
}

function money(n: number): string {
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortName(name: string): string {
  return name.replace(/ (Inc\.|Ltd\.|Corp\.)$/, '');
}

export default function TransferPage() {
  const { data: session } = useSession();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Form state
  const [type, setType] = useState('transfer');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [offsetCode, setOffsetCode] = useState('');
  const [targetCode, setTargetCode] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  useEffect(() => {
    async function load() {
      try {
        // Load companies + their linked GL accounts
        const [companiesRes, linksRes] = await Promise.all([
          fetch('/api/companies'),
          fetch('/api/related-parties'),
        ]);
        const companiesJson = await companiesRes.json();
        const linksJson = await linksRes.json();

        const list: Company[] = (companiesJson.data || []).map((c: any) => ({
          id: c.id,
          name: c.name,
        }));

        // Augment with bank info from COA if available
        setCompanies(list);
        if (list.length >= 2) {
          setFromId(list[0].id);
          setToId(list[1].id);
        }
      } catch (e) {
        console.error('Failed to load companies', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Load account options from COA
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  useEffect(() => {
    async function loadAccounts() {
      try {
        const res = await fetch('/api/accounts?limit=200');
        const json = await res.json();
        const list: AccountOption[] = (json.data || []).map((a: any) => ({
          code: a.code,
          label: `${a.code} · ${a.name}`,
        }));
        setAccounts(list);
      } catch {
        // Fallback: empty accounts list (form still works with manual codes)
      }
    }
    loadAccounts();
  }, []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);

  const getOffsetOptions = useCallback((): AccountOption[] => {
    if (!accounts.length) return [];
    if (type === 'recharge') {
      return accounts.filter(a =>
        a.code.startsWith('43') || a.code.startsWith('42')
      );
    }
    return accounts.filter(a =>
      a.code.startsWith('10') || a.code.startsWith('11') || a.code.startsWith('12')
    );
  }, [type, accounts]);

  const getTargetOptions = useCallback((): AccountOption[] => {
    if (!accounts.length) return [];
    if (type === 'onbehalf') {
      return accounts.filter(a =>
        a.code.startsWith('6') || a.code.startsWith('5')
      );
    }
    if (type === 'recharge') {
      return accounts.filter(a =>
        a.code.startsWith('6') || a.code.startsWith('5')
      );
    }
    return accounts.filter(a =>
      a.code.startsWith('10') || a.code.startsWith('11') || a.code.startsWith('12')
    );
  }, [type, accounts]);

  // Set default offset/target when type or from/to changes
  useEffect(() => {
    const offsets = getOffsetOptions();
    const targets = getTargetOptions();
    if (offsets.length && !offsetCode) setOffsetCode(offsets[0].code);
    if (targets.length && !targetCode) setTargetCode(targets[0].code);
  }, [type, fromId, toId, accounts]);

  const fromCo = companies.find(c => c.id === fromId);
  const toCo = companies.find(c => c.id === toId);
  const offsetAcc = getOffsetOptions().find(a => a.code === offsetCode) || getOffsetOptions()[0];
  const targetAcc = getTargetOptions().find(a => a.code === targetCode) || getTargetOptions()[0];

  const amt = parseFloat(amount.replace(/,/g, '')) || 0;

  // Build preview
  const previewSides: PreviewSide[] = fromCo && toCo ? [
    {
      company: fromCo.name,
      role: 'Source · funds out',
      lines: [
        { code: '1310', name: `Due from ${shortName(toCo.name)}`, dr: money(amt), cr: '—' },
        { code: offsetAcc?.code || '—', name: offsetAcc?.label?.split(' · ')[1] || 'Offset', dr: '—', cr: money(amt) },
      ],
      total: money(amt),
    },
    {
      company: toCo.name,
      role: 'Mirror · contra entry',
      lines: [
        { code: targetAcc?.code || '—', name: targetAcc?.label?.split(' · ')[1] || 'Target', dr: money(amt), cr: '—' },
        { code: '2310', name: `Due to ${shortName(fromCo.name)}`, dr: '—', cr: money(amt) },
      ],
      total: money(amt),
    },
  ] : [];

  const handlePost = async () => {
    if (amt <= 0) { flash('Enter an amount above zero'); return; }
    if (!fromId || !toId) { flash('Select both companies'); return; }

    try {
      const res = await fetch('/api/intercompany/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceCompanyId: fromId,
          targetCompanyId: toId,
          kind: type === 'transfer' ? 'FUND_TRANSFER'
            : type === 'onbehalf' ? 'EXPENSE_ON_BEHALF'
            : type === 'recharge' ? 'RECHARGE'
            : 'JOURNAL',
          date,
          amount: String(amt),
          sourceOffsetAccountCode: offsetCode || offsetAcc?.code || '1010',
          targetOffsetAccountCode: targetCode || targetAcc?.code || '1010',
          memo,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to post');
      }
      const json = await res.json();
      flash(`Posted ${json.data.reference} in both companies`);
      // Reset form
      setAmount('');
      setMemo('');
    } catch (e: any) {
      flash(e.message || 'Post failed');
    }
  };

  if (loading) {
    return <div style={{ padding: 30, color: 'var(--text-muted)' }}>Loading companies…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)' }}>
          Inter-company · related party
        </div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--text-strong)', margin: 0, letterSpacing: 'var(--tracking-tight)' }}>
          One transaction. Both sets of books.
        </h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text)', maxWidth: '62ch', margin: 0, lineHeight: 1.6 }}>
          Post on one side and LedgerPro writes the matching contra entry in the other company — same date, same amount, mirrored accounts, permanently linked.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
        gap: 16,
        alignItems: 'start',
      }}>
        {/* Form */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-sm)',
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)' }}>
            Transaction
          </div>

          {/* Type */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Type</label>
            <select value={type} onChange={e => setType(e.target.value)}
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
                fontSize: 'var(--text-base)', padding: '10px 12px', width: '100%',
                outline: 'none', fontFamily: 'var(--font-sans)',
              }}>
              <option value="transfer">Fund transfer — bank to bank</option>
              <option value="onbehalf">Expense paid on behalf</option>
              <option value="recharge">Cost recharge / management fee</option>
              <option value="journal">General journal</option>
            </select>
          </div>

          {/* Companies */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Paying company</label>
              <select value={fromId} onChange={e => { setFromId(e.target.value); if (e.target.value === toId) setToId(companies.find(c => c.id !== e.target.value)?.id || ''); }}
                style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
                  fontSize: 'var(--text-base)', padding: '10px 12px', width: '100%',
                  outline: 'none', fontFamily: 'var(--font-sans)',
                }}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Related party</label>
              <select value={toId} onChange={e => setToId(e.target.value)}
                style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
                  fontSize: 'var(--text-base)', padding: '10px 12px', width: '100%',
                  outline: 'none', fontFamily: 'var(--font-sans)',
                }}>
                {companies.filter(c => c.id !== fromId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {/* Offset account */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              {type === 'recharge' ? `Income account credited in ${fromCo?.name || 'source'}` : `Account credited in ${fromCo?.name || 'source'}`}
            </label>
            <select value={offsetCode} onChange={e => setOffsetCode(e.target.value)}
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
                fontSize: 'var(--text-base)', padding: '10px 12px', width: '100%',
                outline: 'none', fontFamily: 'var(--font-sans)',
              }}>
              {getOffsetOptions().map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
            </select>
          </div>

          {/* Target account */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              Account debited in {toCo?.name || 'target'}
            </label>
            <select value={targetCode} onChange={e => setTargetCode(e.target.value)}
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
                fontSize: 'var(--text-base)', padding: '10px 12px', width: '100%',
                outline: 'none', fontFamily: 'var(--font-sans)',
              }}>
              {getTargetOptions().map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
            </select>
          </div>

          {/* Date & Amount */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                  padding: '10px 12px', width: '100%', outline: 'none',
                }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Amount (CAD)</label>
              <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
                style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)',
                  fontVariantNumeric: 'tabular-nums', padding: '10px 12px',
                  width: '100%', outline: 'none',
                }} />
            </div>
          </div>

          {/* Memo */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Memo</label>
            <input value={memo} onChange={e => setMemo(e.target.value)}
              placeholder="Working capital top-up"
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
                fontSize: 'var(--text-base)', padding: '10px 12px', width: '100%',
                outline: 'none', fontFamily: 'var(--font-sans)',
              }} />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 2 }}>
            <button onClick={handlePost}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--primary)', color: 'white',
                border: '0', borderRadius: 'var(--r-md)',
                padding: '11px 16px', fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer',
              }}>
              <Check size={15} /> Post both entries
            </button>
            <button onClick={() => { setAmount('0.00'); setMemo(''); }}
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                padding: '11px 16px', fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)', cursor: 'pointer',
              }}>
              Clear
            </button>
          </div>
        </div>

        {/* Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)' }}>
              Posting preview · double entry
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: 'var(--r-full)', background: 'var(--success)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                Both sides balanced
              </span>
            </div>
          </div>

          {previewSides.map((side, i) => (
            <div key={i} style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              boxShadow: 'var(--shadow-sm)',
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '13px 18px', borderBottom: '1px solid var(--border)',
                background: 'var(--surface-2)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 'var(--r-full)', background: 'var(--primary)' }} />
                  <span style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-strong)' }}>{side.company}</span>
                </div>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{side.role}</span>
              </div>
              <div style={{ padding: '6px 18px 14px' }}>
                {side.lines.map((line, j) => (
                  <div key={j} style={{
                    display: 'grid',
                    gridTemplateColumns: '52px minmax(0,1fr) minmax(56px,92px) minmax(56px,92px)',
                    gap: 8, alignItems: 'baseline', padding: '9px 0',
                    borderBottom: '1px solid var(--neutral-soft-border)',
                  }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{line.code}</span>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>{line.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', textAlign: 'right', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{line.dr}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', textAlign: 'right', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{line.cr}</span>
                  </div>
                ))}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '52px minmax(0,1fr) minmax(56px,92px) minmax(56px,92px)',
                  gap: 8, padding: '10px 0 0',
                }}>
                  <span />
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', textAlign: 'right', color: 'var(--primary)', fontWeight: 600 }}>{side.total}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', textAlign: 'right', color: 'var(--primary)', fontWeight: 600 }}>{side.total}</span>
                </div>
              </div>
            </div>
          ))}

          <div style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            background: 'var(--warning-soft)', border: '1px solid var(--warning)',
            borderRadius: 'var(--r-md)', padding: '12px 14px',
          }}>
            <Info size={15} style={{ color: 'var(--warning)', flex: 'none', marginTop: 2 }} />
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
              Both entries post the moment you save. Void one and LedgerPro voids the other — they share a link id and can never drift.
            </p>
          </div>
        </div>
      </div>

      {/* Toast */}
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
