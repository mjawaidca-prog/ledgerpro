'use client';

import { useMemo, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  STATEMENTS,
  fmtNum,
  type CompanyOption,
  type ConsolidatedStatement,
  type ManualElimination,
} from './state';

interface Props {
  open: boolean;
  companies: CompanyOption[];
  onClose: () => void;
  onSave: (elim: ManualElimination) => void;
}

interface AccountRow {
  companyId: string;
  glAccountCode: string;
  debit: number;
  credit: number;
}

const APPLIES_OPTIONS: ConsolidatedStatement[] = ['balance-sheet', 'profit-loss', 'trial-balance'];

export default function ManualEliminationModal({ open, companies, onClose, onSave }: Props) {
  const [description, setDescription] = useState('');
  const [appliesTo, setAppliesTo] = useState<ConsolidatedStatement[]>(['profit-loss']);
  const [accounts, setAccounts] = useState<AccountRow[]>([
    { companyId: companies[0]?.id ?? '', glAccountCode: '', debit: 0, credit: 0 },
  ]);
  const [ref, setRef] = useState('');

  const debits = accounts.reduce((s, a) => s + (a.debit || 0), 0);
  const credits = accounts.reduce((s, a) => s + (a.credit || 0), 0);
  const balanced = Math.abs(debits - credits) < 0.005 && (debits > 0 || credits > 0);
  const valid = description.trim().length > 0 && balanced;

  const nextRef = useMemo(() => `ADJ-${String(accounts.length + 1).padStart(2, '0')}`, [accounts.length]);

  if (!open) return null;

  const toggleApplies = (key: ConsolidatedStatement) => {
    setAppliesTo((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const updateAccount = (i: number, patch: Partial<AccountRow>) => {
    setAccounts((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };

  const addAccount = () => {
    setAccounts((prev) => [...prev, { companyId: companies[0]?.id ?? '', glAccountCode: '', debit: 0, credit: 0 }]);
  };

  const removeAccount = (i: number) => {
    setAccounts((prev) => prev.filter((_, idx) => idx !== i));
  };

  const save = () => {
    if (!valid) return;
    onSave({
      ref: ref.trim() || nextRef,
      description: description.trim(),
      appliesTo,
      accounts: accounts.map((a) => ({
        companyId: a.companyId,
        glAccountCode: a.glAccountCode.trim(),
        debit: Number(a.debit) || 0,
        credit: Number(a.credit) || 0,
      })),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-[620px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] shadow-[var(--shadow-lg)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[var(--text-strong)]">Add manual elimination</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-strong)] transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-[100px_1fr] gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Ref</label>
              <input
                type="text"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder={nextRef}
                className="w-full border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 font-mono text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-focus)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Management fee recharge — NHL to NLI"
                className="w-full border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-focus)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Applies to</label>
            <div className="flex flex-wrap gap-2">
              {APPLIES_OPTIONS.map((key) => {
                const label = STATEMENTS.find((s) => s.key === key)?.label ?? key;
                const active = appliesTo.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleApplies(key)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs border transition-colors',
                      active
                        ? 'bg-[var(--primary-soft)] border-[var(--primary-soft-border)] text-[var(--primary)] font-semibold'
                        : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)]'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-[var(--text-muted)]">Journal lines</label>
              <button onClick={addAccount} className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors">
                <Plus size={12} /> Add line
              </button>
            </div>
            <div className="border border-[var(--border)] rounded-[var(--r-lg)] overflow-hidden">
              <div className="grid grid-cols-[1.2fr_1fr_100px_100px_32px] px-3 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                <div>Company</div>
                <div>GL account code</div>
                <div className="text-right">Debit</div>
                <div className="text-right">Credit</div>
                <div />
              </div>
              {accounts.map((a, i) => (
                <div key={i} className="grid grid-cols-[1.2fr_1fr_100px_100px_32px] gap-2 px-3 py-2 border-b border-[var(--surface-3)] last:border-b-0 items-center">
                  <select
                    value={a.companyId}
                    onChange={(e) => updateAccount(i, { companyId: e.target.value })}
                    className="border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1.5 text-[13px] text-[var(--text)] outline-none"
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={a.glAccountCode}
                    onChange={(e) => updateAccount(i, { glAccountCode: e.target.value })}
                    placeholder="4000"
                    className="border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1.5 font-mono text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-focus)]"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={a.debit || ''}
                    onChange={(e) => updateAccount(i, { debit: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1.5 font-mono text-[13px] text-right text-[var(--text)] outline-none focus:border-[var(--border-focus)]"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={a.credit || ''}
                    onChange={(e) => updateAccount(i, { credit: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1.5 font-mono text-[13px] text-right text-[var(--text)] outline-none focus:border-[var(--border-focus)]"
                  />
                  <button
                    onClick={() => removeAccount(i)}
                    disabled={accounts.length === 1}
                    className="text-[var(--text-faint)] hover:text-[var(--danger)] disabled:opacity-30 transition-colors"
                    aria-label="Remove line"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className={cn('mt-1.5 font-mono text-[11px]', balanced ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
              {balanced
                ? `Balanced — ${fmtNum(debits)} = ${fmtNum(credits)}`
                : debits === 0 && credits === 0
                  ? 'Enter debits and credits. Debits must equal credits.'
                  : `Not balanced — debits ${fmtNum(debits)} ≠ credits ${fmtNum(credits)}`}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] text-[13px] font-medium px-4 py-2 text-[var(--text-muted)] hover:border-[var(--border-strong)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!valid}
            className="rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13px] font-semibold px-5 py-2 transition-colors"
          >
            Add elimination
          </button>
        </div>
      </div>
    </div>
  );
}
