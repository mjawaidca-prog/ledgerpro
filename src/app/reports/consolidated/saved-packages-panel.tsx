'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { X, Save, Trash2, Loader2 } from 'lucide-react';
import type { ConsolidatedSetup } from './state';
import { DEFAULT_SETUP, STATEMENTS } from './state';

interface Props {
  open: boolean;
  setup: ConsolidatedSetup;
  onClose: () => void;
  onLoad: (setup: ConsolidatedSetup) => void;
}

interface PackageRow {
  id: string;
  name: string;
  setup: ConsolidatedSetup;
  createdAt: string;
}

export default function SavedPackagesPanel({ open, setup, onClose, onLoad }: Props) {
  const [packages, setPackages] = useState<PackageRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setPackages(null);
    fetch('/api/reports/packages')
      .then((r) => r.json())
      .then((json) => setPackages(json.data ?? []))
      .catch(() => setPackages([]));
  }, []);

  useEffect(() => {
    if (open) {
      load();
      setName('');
      setSaved(false);
    }
  }, [open, load]);

  if (!open) return null;

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/reports/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), setup }),
      });
      if (res.ok) {
        setName('');
        setSaved(true);
        load();
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/reports/packages?id=${id}`, { method: 'DELETE' });
    load();
  };

  const apply = (pkg: PackageRow) => {
    onLoad({ ...DEFAULT_SETUP, ...pkg.setup });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-[480px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] shadow-[var(--shadow-lg)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[var(--text-strong)]">Saved packages</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-strong)] transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Save current setup */}
        <div className="flex gap-2 mb-5">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Package name — e.g. Group Q3 2025"
            className="flex-1 border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-focus)]"
          />
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 rounded-[var(--r-lg)] bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13px] font-medium px-4 py-2 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </button>
        </div>
        {saved && <div className="mb-4 text-xs text-[var(--success)]">Package saved.</div>}

        {/* List */}
        {!packages ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" />
          </div>
        ) : packages.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-muted)]">
            No saved packages yet. Set up a report and save it here for one-click regeneration.
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
            {packages.map((pkg) => {
              const stmt = STATEMENTS.find((s) => s.key === pkg.setup.statement)?.label ?? pkg.setup.statement;
              return (
                <div
                  key={pkg.id}
                  className="flex items-center gap-3 border border-[var(--border)] rounded-[var(--r-lg)] px-3.5 py-2.5 hover:border-[var(--border-strong)] transition-colors"
                >
                  <button onClick={() => apply(pkg)} className="flex-1 text-left">
                    <div className="text-[13px] font-medium text-[var(--text-strong)]">{pkg.name}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      {stmt} · {pkg.setup.companyIds.length} entities · {format(new Date(pkg.createdAt), 'MMM d, yyyy')}
                    </div>
                  </button>
                  <button
                    onClick={() => remove(pkg.id)}
                    className="text-[var(--text-faint)] hover:text-[var(--danger)] transition-colors"
                    aria-label={`Delete ${pkg.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
