'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Check, Plus, Building2, Settings, LogOut } from 'lucide-react';

interface CompanyInfo {
  id: string;
  name: string;
  role: string;
  plan: string;
  status: string;
}

export function CompanySwitcher({
  activeCompanyId,
  activeCompanyName,
  onSwitch,
}: {
  activeCompanyId: string | null;
  activeCompanyName: string | null;
  onSwitch?: (companyId: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (open && !fetched) {
      setLoading(true);
      fetch('/api/companies')
        .then((r) => r.json())
        .then((json) => setCompanies(json.data || []))
        .catch(() => {})
        .finally(() => { setLoading(false); setFetched(true); });
    }
  }, [open, fetched]);

  async function handleSwitch(companyId: string) {
    setLoading(true);
    try {
      await fetch('/api/companies/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      // Force a full page reload to refresh the JWT with new active company
      window.location.href = '/';
    } catch {
      setLoading(false);
    }
  }

  const initials = (activeCompanyName || '?').slice(0, 2).toUpperCase();

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="org-switch"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        style={{ cursor: 'pointer', border: 'none', background: 'rgba(255,255,255,0.04)', width: '100%', textAlign: 'left' }}
      >
        <span className="org-tile">{initials}</span>
        <span className="org-meta">
          <span className="org-name">{activeCompanyName || 'Select Company'}</span>
          <span className="org-plan">
            {loading ? 'Loading...' : companies.find(c => c.id === activeCompanyId)?.plan || activeCompanyId ? 'Current' : 'Select company'}
          </span>
        </span>
        <span className="chev" style={{ marginLeft: 'auto' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m7 10 5 5 5-5"/></svg>
        </span>
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0,
            minWidth: 260, zIndex: 50,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)',
            padding: 6, overflow: 'hidden',
          }}>
            <div style={{ padding: '6px 10px 4px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.10em', color: 'var(--text-muted)' }}>
              Switch Company
            </div>
            {companies.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSwitch(c.id)}
                disabled={loading}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 10px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer', border: 'none', background: c.id === activeCompanyId ? 'var(--primary-soft)' : 'transparent',
                  borderRadius: 'var(--r-md)', fontSize: 13,
                  color: c.id === activeCompanyId ? 'var(--primary)' : 'var(--text)',
                  transition: 'background 0.12s',
                }}
              >
                <span style={{
                  width: 26, height: 26, borderRadius: 'var(--r-sm)',
                  background: 'linear-gradient(135deg, var(--blue-500), var(--blue-700))',
                  color: '#fff', display: 'grid', placeItems: 'center',
                  fontWeight: 700, fontSize: 10, flexShrink: 0,
                }}>
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {c.plan} · {c.role}
                  </div>
                </div>
                {c.id === activeCompanyId && <Check size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />}
              </button>
            ))}
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <button
              onClick={() => { setOpen(false); router.push('/register'); }}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 10px',
                display: 'flex', alignItems: 'center', gap: 10,
                cursor: 'pointer', border: 'none', background: 'transparent',
                borderRadius: 'var(--r-md)', fontSize: 13, color: 'var(--text-muted)',
              }}
            >
              <Plus size={16} /> New Company
            </button>
            <button
              onClick={() => { setOpen(false); router.push('/settings'); }}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 10px',
                display: 'flex', alignItems: 'center', gap: 10,
                cursor: 'pointer', border: 'none', background: 'transparent',
                borderRadius: 'var(--r-md)', fontSize: 13, color: 'var(--text-muted)',
              }}
            >
              <Settings size={16} /> Manage Companies
            </button>
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 10px',
                display: 'flex', alignItems: 'center', gap: 10,
                cursor: 'pointer', border: 'none', background: 'transparent',
                borderRadius: 'var(--r-md)', fontSize: 13,
                color: 'var(--danger)',
              }}
            >
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
