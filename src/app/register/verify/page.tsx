'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { CheckCircle2, Loader2, AlertTriangle, Mail } from 'lucide-react';

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMsg('No verification token provided. Please check your email link.');
      return;
    }

    async function verify() {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const json = await res.json();

        if (!res.ok) {
          setStatus('error');
          setErrorMsg(json.error || 'Verification failed');
          return;
        }

        setStatus('success');
        setTimeout(() => router.push('/login'), 3000);
      } catch {
        setStatus('error');
        setErrorMsg('Something went wrong. Please try again.');
      }
    }

    verify();
  }, [token, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)]">
      <div className="w-full max-w-[400px] text-center">
        <div className="inline-flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-[var(--primary)] text-white grid place-items-center font-bold text-lg">
            L
          </div>
          <span className="text-xl font-bold text-[var(--text-strong)]">
            Ledger<span className="text-[var(--primary)]">Pro</span>
          </span>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-md)] p-8">
          {status === 'loading' && (
            <div>
              <Loader2 size={40} className="mx-auto animate-spin text-[var(--primary)] mb-4" />
              <h1 className="text-lg font-bold text-[var(--text-strong)] mb-2">Verifying your email...</h1>
              <p className="text-sm text-[var(--text-muted)]">Please wait a moment.</p>
            </div>
          )}

          {status === 'success' && (
            <div>
              <CheckCircle2 size={40} className="mx-auto text-[var(--success)] mb-4" />
              <h1 className="text-lg font-bold text-[var(--text-strong)] mb-2">Email Verified!</h1>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                Your email has been verified. You&apos;ll be redirected to the sign in page shortly.
              </p>
              <Link href="/login">
                <Button>Sign In Now</Button>
              </Link>
            </div>
          )}

          {status === 'error' && (
            <div>
              <AlertTriangle size={40} className="mx-auto text-[var(--warning)] mb-4" />
              <h1 className="text-lg font-bold text-[var(--text-strong)] mb-2">Verification Failed</h1>
              <p className="text-sm text-[var(--text-muted)] mb-4">{errorMsg}</p>
              <div className="flex items-center justify-center gap-2">
                <Link href="/login">
                  <Button variant="secondary">Back to Sign In</Button>
                </Link>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-[var(--text-faint)] mt-6">
          <Mail size={12} className="inline mr-1" />
          Didn&apos;t receive an email? Check your spam folder or{' '}
          <Link href="/register" className="text-[var(--accent)] hover:underline">create a new account</Link>.
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)]">
        <Loader2 size={40} className="animate-spin text-[var(--primary)]" />
      </div>
    }>
      <VerifyContent />
    </Suspense>
  );
}
