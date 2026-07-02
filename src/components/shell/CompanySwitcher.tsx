'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Check, Plus, Building2, Settings, LogOut, Loader2 } from 'lucide-react';
import { clearActiveCompanyCookies } from '@/lib/active-company-cookies';

interface CompanyInfo {
  id: string;
  name: string;
  role: string;
  plan: string;
  status: string;
  trialDaysLeft: number | null;
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
  const { update: updateSession } = useSession();
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const [addingOpen, setAddingOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  async function handleCreateCompany(e: React.FormEvent) {
    e.preventDefault();
    if (newCompanyName.trim().length < 2) {
      setCreateError('Company name must be at least 2 characters');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCompanyName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create company');

      await fetch('/api/companies/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: json.data.companyId }),
      });

      // Refresh the JWT's availableCompanies list to include the one we just
      // created — otherwise the next page load treats its own cookie as
      // belonging to a different account (see AppShell's cookie validation).
      await updateSession();

      window.location.href = '/onboarding';
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create company');
      setCreating(false);
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
                    {c.status === 'trialing' && c.trialDaysLeft !== null && (
                      <span style={{ color: c.trialDaysLeft <= 3 ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {' '}· {c.trialDaysLeft > 0 ? `${c.trialDaysLeft}d left in trial` : 'trial expired'}
                      </span>
                    )}
                  </div>
                </div>
                {c.id === activeCompanyId && <Check size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />}
              </button>
            ))}
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <button
              onClick={() => { setCreateError(null); setNewCompanyName(''); setAddingOpen(true); }}
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
              onClick={() => { clearActiveCompanyCookies(); signOut({ callbackUrl: '/login' }); }}
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

      {addingOpen && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.4)' }}
            onClick={() => !creating && setAddingOpen(false)}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 100, width: '100%', maxWidth: 380,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)', padding: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Building2 size={18} />
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>New Company</h2>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              This adds another company under your existing login — you'll be its owner, with a
              fresh Chart of Accounts and its own 30-day trial.
            </p>
            <form onSubmit={handleCreateCompany}>
              <div className="field">
                <label>Company name</label>
                <input
                  className="input"
                  autoFocus
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder="Acme Consulting Inc."
                  disabled={creating}
                />
              </div>
              {createError && (
                <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{createError}</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => setAddingOpen(false)}
                  disabled={creating}
                  className="nav-item"
                  style={{ padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'transparent' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  style={{
                    padding: '8px 14px', border: 'none', borderRadius: 'var(--r-md)',
                    background: 'var(--primary)', color: '#fff', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  }}
                >
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create Company
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
