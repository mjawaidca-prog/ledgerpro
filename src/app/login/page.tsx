'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError('Invalid email or password. Please try again.');
      return;
    }

    router.push('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)] px-4">
      <div className="w-full max-w-[440px]">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#1f6feb] to-[#7c3aed] text-white grid place-items-center font-bold text-xl shadow-lg shadow-[#1f6feb]/25">
              L
            </div>
            <span className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">
              Ledger<span className="text-[var(--primary)]">Pro</span>
            </span>
            <div className="text-[10px] text-[var(--text-faint)] font-mono mt-1">by NexVar Labs</div>
          </div>
          <p className="text-sm text-[var(--text-muted)]">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-lg)] p-8">
          {error && (
            <Alert variant="danger" className="mb-6">
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="field">
              <label>Email address</label>
              <input
                type="email"
                className="input"
                placeholder="rosa@northwindtrading.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="field">
              <label>Password</label>
              <input
                type="password"
                className="input"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full mt-2" size="lg" disabled={loading}>
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-4">
          <a href="#" className="text-[var(--text-faint)] hover:text-[var(--accent)]">
            Forgot password?
          </a>
          <span className="mx-2 text-[var(--border)]">|</span>
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-[var(--accent)] hover:text-[var(--primary)] font-medium">
            Create free account
          </Link>
        </p>
        <p className="text-center text-xs text-[var(--text-faint)] mt-6">
          Ledger Pro by NexVar Labs
        </p>
      </div>
    </div>
  );
}
