'use client';

// Settings → Security (MFA-1): enable authenticator-app two-factor login,
// view backup codes exactly once, and disable (password + code required).

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ShieldCheck, Loader2, Copy, Check } from 'lucide-react';

export default function SecurityPage() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [enabledAt, setEnabledAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'status' | 'setup' | 'codes' | 'disable'>('status');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [manualSecret, setManualSecret] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/mfa');
      const json = await res.json();
      if (res.ok) {
        setEnabled(json.data.enabled);
        setEnabledAt(json.data.enabledAt);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  async function handleBeginSetup() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/mfa/setup', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not start setup.');
      setQrDataUrl(json.data.qrDataUrl);
      setManualSecret(json.data.secret);
      setStep('setup');
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifySetup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verifyCode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Verification failed.');
      setBackupCodes(json.data.backupCodes);
      setStep('codes');
      await fetchStatus();
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword, code: disableCode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not disable MFA.');
      setStep('status');
      setMessage({ type: 'success', text: 'Two-factor authentication disabled.' });
      await fetchStatus();
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyCodes() {
    await navigator.clipboard.writeText(backupCodes.join('\n'));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => router.push('/settings')}>
            <ArrowLeft size={16} /> Settings
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Security</h1>
            <p className="text-sm text-muted-foreground">Two-factor authentication for your account.</p>
          </div>
        </div>

        {message && <Alert variant={message.type === 'success' ? 'success' : 'danger'}>{message.text}</Alert>}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} />
                <h2 className="font-medium">Two-factor authentication</h2>
                {enabled && <Badge variant="paid">Enabled</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardBody>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            ) : step === 'status' && !enabled && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Add a second factor to your sign-in. After enabling, logging in requires your password <strong>and</strong> a 6-digit
                  code from an authenticator app (Google Authenticator, 1Password, Authy, …).
                </p>
                <Button variant="primary" onClick={handleBeginSetup} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : null} Enable two-factor authentication
                </Button>
              </div>
            )}

            {step === 'status' && enabled && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Enabled {enabledAt ? new Date(enabledAt).toLocaleDateString() : ''}. Your next sign-in will ask for an
                  authenticator-app code.
                </p>
                <Button variant="secondary" onClick={() => setStep('disable')}>Disable two-factor authentication</Button>
              </div>
            )}

            {step === 'setup' && (
              <form onSubmit={handleVerifySetup} className="space-y-4">
                <p className="text-sm text-muted-foreground">Scan this QR code with your authenticator app:</p>
                {qrDataUrl && <img src={qrDataUrl} alt="TOTP QR code" className="w-44 h-44 rounded border" />}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Or enter this key manually:</p>
                  <code className="block rounded border px-3 py-2 text-sm break-all font-mono">{manualSecret}</code>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Enter the 6-digit code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="w-full rounded border px-3 py-2 text-sm font-mono"
                    placeholder="000000"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    maxLength={6}
                    required
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setStep('status')}>Cancel</Button>
                  <Button type="submit" variant="primary" disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null} Verify and enable
                  </Button>
                </div>
              </form>
            )}

            {step === 'codes' && (
              <div className="space-y-4">
                <Alert variant="warning">
                  <div className="space-y-2">
                    <div className="font-medium">Save your backup codes now — they will not be shown again.</div>
                    <p className="text-xs">Each code works once. Store them somewhere safe, like a password manager.</p>
                    <div className="grid grid-cols-2 gap-2">
                      {backupCodes.map((c) => (
                        <code key={c} className="rounded border px-2 py-1 text-xs font-mono">{c}</code>
                      ))}
                    </div>
                    <Button variant="secondary" size="sm" onClick={handleCopyCodes}>
                      {copiedCodes ? <Check size={14} /> : <Copy size={14} />} {copiedCodes ? 'Copied' : 'Copy all'}
                    </Button>
                  </div>
                </Alert>
                <Button variant="primary" onClick={() => setStep('status')}>Done</Button>
              </div>
            )}

            {step === 'disable' && (
              <form onSubmit={handleDisable} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Disabling requires your password and a current code — a stolen session cannot silently remove your second factor.
                </p>
                <div>
                  <label className="block text-sm font-medium mb-1">Password</label>
                  <input
                    type="password"
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Authenticator or backup code</label>
                  <input
                    type="text"
                    className="w-full rounded border px-3 py-2 text-sm font-mono"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                    required
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setStep('status')}>Cancel</Button>
                  <Button type="submit" variant="destructive" disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null} Disable two-factor authentication
                  </Button>
                </div>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
