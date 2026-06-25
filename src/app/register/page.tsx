'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', companyName: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error || 'Registration failed');

      setSuccess(true);

      // Auto sign in after registration
      const signInResult = await signIn('credentials', {
        email: form.email,
        password: form.password,
        redirect: false,
      });

      if (signInResult?.ok) {
        router.push('/');
        router.refresh();
      } else {
        router.push('/login');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)]">
        <div className="w-full max-w-[400px] text-center">
          <CheckCircle2 size={48} className="mx-auto text-[var(--success)] mb-4" />
          <h1 className="text-xl font-bold text-[var(--text-strong)] mb-2">Account created!</h1>
          <p className="text-sm text-[var(--text-muted)] mb-4">Signing you in...</p>
          <Loader2 size={20} className="animate-spin mx-auto text-[var(--text-muted)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)]">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--primary)] text-white grid place-items-center font-bold text-lg">L</div>
            <span className="text-xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">
              Ledger<span className="text-[var(--primary)]">Pro</span>
            </span>
          </div>
          <p className="text-sm text-[var(--text-muted)]">Create your free account</p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-md)] p-6">
          {error && (
            <Alert variant="danger" className="mb-4">
              <AlertTriangle size={16} /> {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] mb-1.5">Your Name</label>
              <input
                type="text" className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 bg-[var(--surface)] text-sm text-[var(--text)] focus:border-[var(--border-focus)] outline-none"
                placeholder="Rosa Alvarez" required
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] mb-1.5">Email</label>
              <input
                type="email" className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 bg-[var(--surface)] text-sm text-[var(--text)] focus:border-[var(--border-focus)] outline-none"
                placeholder="rosa@company.com" required
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] mb-1.5">Password</label>
              <input
                type="password" className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 bg-[var(--surface)] text-sm text-[var(--text)] focus:border-[var(--border-focus)] outline-none"
                placeholder="At least 8 characters" required minLength={8}
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] mb-1.5">Company Name</label>
              <input
                type="text" className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 bg-[var(--surface)] text-sm text-[var(--text)] focus:border-[var(--border-focus)] outline-none"
                placeholder="Your Business Inc." required
                value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              Create Free Account
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-[var(--text-faint)] mt-4">
          Already have an account? <Link href="/login" className="text-[var(--accent)] hover:text-[var(--primary)]">Sign in</Link>
        </p>
        <p className="text-center text-xs text-[var(--text-faint)] mt-2">
          30-day free trial. No credit card required.
        </p>
      </div>
    </div>
  );
}
