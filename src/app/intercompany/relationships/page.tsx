'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';

interface RelatedPartyLink {
  id: string;
  companyA: { id: string; name: string };
  companyB: { id: string; name: string };
  aDueFromAccountId: string;
  aDueToAccountId: string;
  bDueFromAccountId: string;
  bDueToAccountId: string;
}

interface Company {
  id: string;
  name: string;
}

export default function RelationshipsPage() {
  const [links, setLinks] = useState<RelatedPartyLink[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [linkX, setLinkX] = useState('');
  const [ownX, setOwnX] = useState(100); // Company A holds % of B
  const [ownY, setOwnY] = useState(0); // Company B holds % of A
  const [linkY, setLinkY] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [linksRes, companiesRes] = await Promise.all([
        fetch('/api/related-parties'),
        fetch('/api/companies'),
      ]);
      const linksJson = await linksRes.json();
      const companiesJson = await companiesRes.json();

      setLinks(linksJson.data || []);
      const list: Company[] = (companiesJson.data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
      }));
      setCompanies(list);
      if (list.length >= 2) {
        setLinkX(list[0].id);
        setLinkY(list[1].id);
      }
    } catch (e) {
      console.error('Failed to load relationships', e);
    } finally {
      setLoading(false);
    }
  }

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);

  async function handleCreate() {
    if (!linkX || !linkY) { flash('Select both companies'); return; }
    if (linkX === linkY) { flash('Cannot link a company to itself'); return; }

    try {
      const res = await fetch('/api/related-parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyX: linkX,
          companyY: linkY,
          ownership: { xOwnsY: ownX, yOwnsX: ownY },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create link');
      }
      await loadData();
      setShowForm(false);
      flash('Related-party link created');
    } catch (e: any) {
      flash(e.message || 'Creation failed');
    }
  }

  if (loading) {
    return <div style={{ color: 'var(--text-muted)' }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)' }}>
            Relationships
          </div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>
            Declare the pair. The accounts follow.
          </h1>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--text)', maxWidth: '62ch', margin: 0, lineHeight: 1.6 }}>
            Linking two companies auto-creates a reciprocal control account in each chart of accounts. Only users with access to both books can post across them.
          </p>
        </div>
        {companies.length >= 2 && !showForm && (
          <button onClick={() => setShowForm(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--primary)', color: 'white',
              border: '0', borderRadius: 'var(--r-md)',
              padding: '10px 16px', fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer',
              flex: 'none',
            }}>
            <Plus size={16} /> New link
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--warning)',
          borderRadius: 'var(--r-lg)', padding: 20, display: 'flex',
          flexDirection: 'column', gap: 16,
        }}>
          <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-strong)' }}>
            New related-party link
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Company A</label>
              <select value={linkX} onChange={e => { setLinkX(e.target.value); if (e.target.value === linkY) setLinkY(companies.find(c => c.id !== e.target.value)?.id || ''); }}
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
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Company B</label>
              <select value={linkY} onChange={e => setLinkY(e.target.value)}
                style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
                  fontSize: 'var(--text-base)', padding: '10px 12px', width: '100%',
                  outline: 'none', fontFamily: 'var(--font-sans)',
                }}>
                {companies.filter(c => c.id !== linkX).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                Company A holds % of Company B
              </label>
              <input type="number" min={0} max={100} step={1} value={ownX}
                onChange={e => setOwnX(parseFloat(e.target.value) || 0)}
                style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)',
                  padding: '10px 12px', width: '100%', outline: 'none',
                }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                Company B holds % of Company A
              </label>
              <input type="number" min={0} max={100} step={1} value={ownY}
                onChange={e => setOwnY(parseFloat(e.target.value) || 0)}
                style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)', color: 'var(--text-strong)',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)',
                  padding: '10px 12px', width: '100%', outline: 'none',
                }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleCreate}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--primary)', color: 'white',
                border: '0', borderRadius: 'var(--r-md)',
                padding: '10px 16px', fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer',
              }}>
              Create link
            </button>
            <button onClick={() => setShowForm(false)}
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                padding: '10px 16px', fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)', cursor: 'pointer',
              }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Existing links */}
      {links.length === 0 ? (
        <div style={{
          background: 'var(--surface)', border: '1px dashed var(--border)',
          borderRadius: 'var(--r-lg)', padding: 40, textAlign: 'center',
          color: 'var(--text-muted)', fontSize: 'var(--text-base)',
        }}>
          No related-party links yet. Create one to start posting inter-company transactions.
        </div>
      ) : (
        links.map((link) => (
          <div key={link.id} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)',
            padding: 18, display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 40px minmax(0,1fr)',
            gap: 12, alignItems: 'center',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-strong)' }}>{link.companyA.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--primary)' }}>
                1310 · Due from {link.companyB.name}
              </span>
            </div>
            <div style={{ display: 'grid', placeItems: 'center', color: 'var(--primary)' }}>
              <ArrowLeftRight size={17} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-strong)' }}>{link.companyB.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--primary)' }}>
                2310 · Due to {link.companyA.name}
              </span>
            </div>
          </div>
        ))
      )}

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        background: 'var(--surface)', border: '1px dashed var(--border)',
        borderRadius: 'var(--r-lg)', padding: 18, marginTop: 8,
      }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)' }}>
          Who can post across
        </div>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', maxWidth: '70ch', margin: 0, lineHeight: 1.6 }}>
          A user must hold a membership in <strong>both</strong> companies to create a linked pair. Without it, the transaction saves in the source company only and lands on the reconciliation report as an unmatched balance.
        </p>
      </div>

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
