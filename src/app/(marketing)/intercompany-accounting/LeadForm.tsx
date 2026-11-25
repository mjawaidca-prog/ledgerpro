'use client';

import { useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';

const inputClass =
  'w-full border border-[var(--border)] rounded-lg px-3 py-2.5 bg-[var(--surface)] text-sm text-[var(--text)] focus:border-[var(--border-focus)] outline-none';
const labelClass =
  'block text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] mb-1.5';

export function LeadForm() {
  const [form, setForm] = useState({ email: '', role: '', question: '', website: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError('');
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, source: 'intercompany-accounting' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }

  if (status === 'sent') {
    return (
      <div className="text-center py-6">
        <CheckCircle2 size={40} className="mx-auto text-[var(--success)] mb-3" />
        <p className="font-semibold text-[var(--text-strong)] mb-1">Request received.</p>
        <p className="text-sm text-[var(--text-muted)]">
          We reply by the next business day to arrange your 15-minute workflow review.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      <div>
        <label className={labelClass} htmlFor="lead-email">Work email</label>
        <input
          id="lead-email"
          type="email"
          required
          maxLength={254}
          className={inputClass}
          placeholder="you@yourfirm.ca"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="lead-role">Your role</label>
        <input
          id="lead-role"
          type="text"
          required
          maxLength={120}
          className={inputClass}
          placeholder="Owner, partner, senior bookkeeper…"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="lead-question">
          The workflow question you&apos;d like covered <span className="normal-case font-normal">(optional)</span>
        </label>
        <textarea
          id="lead-question"
          rows={3}
          maxLength={2000}
          className={inputClass}
          placeholder="e.g. Two related companies, one pays the other's expenses every month…"
          value={form.question}
          onChange={(e) => setForm({ ...form, question: e.target.value })}
        />
      </div>
      {/* Honeypot — invisible to people, tempting to bots. */}
      <div className="hidden" aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
          />
        </label>
      </div>
      {status === 'error' && (
        <p className="text-sm text-[var(--danger,#b3261e)]">{error}</p>
      )}
      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-md px-7 py-3.5 transition-colors disabled:opacity-60"
      >
        {status === 'sending' ? <Loader2 size={16} className="animate-spin" /> : null}
        Request a 15-minute workflow review <ArrowRight size={16} />
      </button>
    </form>
  );
}
