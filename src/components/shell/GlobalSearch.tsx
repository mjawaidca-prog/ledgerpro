'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, FileText, Receipt, Users, Building2, BookOpen, Loader2 } from 'lucide-react';

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  amount?: number;
  status?: string;
  link: string;
}

interface SearchData {
  invoices: SearchResult[];
  bills: SearchResult[];
  contacts: SearchResult[];
  transactions: SearchResult[];
  accounts: SearchResult[];
}

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    // Register callback so Topbar can open this
    (window as any).__openGlobalSearch = () => {
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      delete (window as any).__openGlobalSearch;
    };
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) { setResults(null); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        setResults(json.data);
        setSelectedIndex(0);
      } catch {} finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Keyboard navigation
  const allResults = results ? [
    ...results.invoices.map(r => ({ ...r, type: 'Invoice', icon: <FileText size={14} /> })),
    ...results.bills.map(r => ({ ...r, type: 'Bill', icon: <Receipt size={14} /> })),
    ...results.contacts.map(r => ({ ...r, type: 'Contact', icon: <Users size={14} /> })),
    ...results.transactions.map(r => ({ ...r, type: 'Transaction', icon: <Building2 size={14} /> })),
    ...results.accounts.map(r => ({ ...r, type: 'GL Account', icon: <BookOpen size={14} /> })),
  ] : [];

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, allResults.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && allResults[selectedIndex]) {
      router.push(allResults[selectedIndex].link);
      setOpen(false); setQuery(''); setResults(null);
    }
  }, [allResults, selectedIndex, router]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.4)' }} onClick={() => setOpen(false)} />
      {/* Modal */}
      <div ref={containerRef} style={{
        position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)',
        width: 560, maxHeight: 400, zIndex: 101,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-lg)',
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <Search size={18} className="text-[var(--text-faint)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search invoices, contacts, transactions..."
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 15, color: 'var(--text)', outline: 'none' }}
            autoFocus
          />
          <kbd style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--surface-3)', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>ESC</kbd>
        </div>

        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center' }}><Loader2 size={20} className="animate-spin text-[var(--text-muted)]" /></div>
          )}
          {!loading && !results && query.length >= 2 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No results found.</div>
          )}
          {!loading && !results && query.length < 2 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Type to search across all your data.</div>
          )}
          {results && allResults.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No results for &ldquo;{query}&rdquo;.</div>
          )}
          {allResults.map((r, i) => (
            <div
              key={`${r.type}-${r.id}`}
              onClick={() => { router.push(r.link); setOpen(false); setQuery(''); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 16px', cursor: 'pointer',
                background: i === selectedIndex ? 'var(--primary-soft)' : 'transparent',
                borderLeft: i === selectedIndex ? '3px solid var(--primary)' : '3px solid transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{r.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.subtitle}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {r.amount !== undefined && (
                  <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.amount >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {r.amount >= 0 ? '+' : '−'}${Math.abs(r.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{r.type}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
