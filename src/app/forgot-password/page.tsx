'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Loader2 } from 'lucide-react';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('Request failed. Try again.');
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)] px-4">
      <div className="w-full max-w-[440px]">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-[var(--dark)] text-white grid place-items-center font-bold text-xl">L</div>
            <span className="text-2xl font-bold text-[var(--text-strong)]">
              Ledger<span className="text-[var(--primary)]">Pro</span>
            </span>
          </div>
          <p className="text-sm text-[var(--text-muted)]">Reset your password</p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-lg)] p-8">
          {error && <Alert variant="danger" className="mb-6">{error}</Alert>}

          {sent ? (
            <div className="space-y-4">
              <Alert variant="success">
                If an account exists for <strong>{email}</strong>, a reset link is on its way.
              </Alert>
              <p className="text-sm text-[var(--text-muted)]">
                The link is valid for 30 minutes and works once. Check your spam folder if it doesn&apos;t arrive shortly.
              </p>
              <Button variant="secondary" className="w-full" onClick={() => router.push('/login')}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="field">
                <label>Email address</label>
                <input
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full mt-2" size="lg" disabled={busy}>
                {busy ? <Loader2 size={18} className="animate-spin" /> : 'Send reset link'}
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-4">
          <button onClick={() => router.push('/login')} className="text-[var(--text-faint)] hover:text-[var(--accent)]">
            Back to sign in
          </button>
        </p>
      </div>
    </div>
  );
}
