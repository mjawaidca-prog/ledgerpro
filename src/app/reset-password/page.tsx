'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Loader2 } from 'lucide-react';

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Reset failed.');
      setDone(true);
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
          <p className="text-sm text-[var(--text-muted)]">Choose a new password</p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-lg)] p-8">
          {error && <Alert variant="danger" className="mb-6">{error}</Alert>}

          {done ? (
            <div className="space-y-4">
              <Alert variant="success">Your password has been reset.</Alert>
              <Button variant="primary" className="w-full" onClick={() => router.push('/login')}>
                Sign in
              </Button>
            </div>
          ) : token ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="field">
                <label>New password</label>
                <input
                  type="password"
                  className="input"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Confirm new password</label>
                <input
                  type="password"
                  className="input"
                  placeholder="Repeat it"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full mt-2" size="lg" disabled={busy}>
                {busy ? <Loader2 size={18} className="animate-spin" /> : 'Reset password'}
              </Button>
            </form>
          ) : (
            <Alert variant="danger">This reset link is missing its token. Use the link from the email.</Alert>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
