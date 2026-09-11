'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, KeyRound, Plus, Trash2, Copy, Check, Loader2, ShieldAlert, CalendarClock,
} from 'lucide-react';

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  requestCount: number;
  revokedAt: string | null;
  createdAt: string;
}

function keyStatus(key: ApiKeyRow): { label: string; badge: 'paid' | 'pending' | 'info' | 'neutral' } {
  if (key.revokedAt) return { label: 'Revoked', badge: 'neutral' };
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return { label: 'Expired', badge: 'pending' };
  return { label: 'Active', badge: 'paid' };
}

export default function DeveloperPage() {
  const router = useRouter();
  const [apiAccessEnabled, setApiAccessEnabled] = useState(false);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/keys');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load API keys');
      setApiAccessEnabled(json.data.apiAccessEnabled);
      setKeys(json.data.keys || []);
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  async function handleToggleAccess() {
    setToggling(true);
    setMessage(null);
    try {
      const res = await fetch('/api/keys/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !apiAccessEnabled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update API access');
      setApiAccessEnabled(json.data.apiAccessEnabled);
      setMessage({
        type: 'success',
        text: json.data.apiAccessEnabled
          ? 'API access enabled. Keys can now authenticate.'
          : 'API access disabled. All keys for this company stop working immediately.',
      });
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setToggling(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: keyName.trim(),
          permissions: ['read'],
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create API key');
      setNewSecret(json.data.secret);
      setKeyName('');
      setExpiresAt('');
      setShowCreate(false);
      fetchKeys();
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(key: ApiKeyRow) {
    if (!window.confirm(`Revoke "${key.name}"? Any integration using this key stops working immediately.`)) return;
    setRevoking(key.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/keys/${key.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to revoke API key');
      setMessage({ type: 'success', text: `"${key.name}" revoked.` });
      fetchKeys();
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setRevoking(null);
    }
  }

  async function handleCopy() {
    if (!newSecret) return;
    await navigator.clipboard.writeText(newSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => router.push('/settings')}>
            <ArrowLeft size={16} /> Settings
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Developer / API Access</h1>
            <p className="text-sm text-muted-foreground">
              Issue keys for trusted integrations to use the LedgerPro API. Owner only.
            </p>
          </div>
        </div>

        {newSecret && (
          <Alert variant="warning">
            <div className="space-y-2">
              <div className="font-medium flex items-center gap-2">
                <ShieldAlert size={16} /> Copy your API key now — it will never be shown again.
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-background/50 px-3 py-2 text-sm break-all">{newSecret}</code>
                <Button variant="secondary" onClick={handleCopy}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs">
                Only a SHA-256 hash of this key is stored. If you lose it, create a new key.
              </p>
            </div>
          </Alert>
        )}

        {message && <Alert variant={message.type === 'success' ? 'success' : 'danger'}>{message.text}</Alert>}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium">API access for this company</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  This is the emergency switch. Turn it off and every key stops working immediately.
                </p>
              </div>
              <Button
                variant={apiAccessEnabled ? 'destructive' : 'primary'}
                onClick={handleToggleAccess}
                disabled={toggling || loading}
              >
                {toggling ? <Loader2 size={14} className="animate-spin" /> : null}
                {apiAccessEnabled ? 'Disable API access' : 'Enable API access'}
              </Button>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-medium">API keys</h2>
              <Button variant="primary" onClick={() => setShowCreate(!showCreate)}>
                <Plus size={14} /> New key
              </Button>
            </div>
          </CardHeader>
          <CardBody>
            {showCreate && (
              <form onSubmit={handleCreate} className="space-y-3 border rounded-lg p-4 mb-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Key name</label>
                  <input
                    type="text"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="e.g. AccountNext Reporting"
                    maxLength={80}
                    required
                    className="w-full rounded border px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Permissions</label>
                    <div className="rounded border px-3 py-2 text-sm flex items-center gap-2">
                      <Badge variant="info">read</Badge>
                      <span className="text-xs text-muted-foreground">Read-only (write scopes arrive with a later release)</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Expiry (optional)</label>
                    <input
                      type="date"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className="w-full rounded border px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
                  <Button type="submit" variant="primary" disabled={creating}>
                    {creating ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                    Create key
                  </Button>
                </div>
              </form>
            )}

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Loading keys…
              </div>
            ) : keys.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No API keys yet. Create one to give an integration read access to this company's books.
              </p>
            ) : (
              <div className="space-y-2">
                {keys.map((key) => {
                  const status = keyStatus(key);
                  return (
                    <div key={key.id} className="flex items-center justify-between rounded border px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{key.name}</span>
                          <Badge variant={status.badge}>{status.label}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                          <div><code>{key.keyPrefix}…</code></div>
                          <div>
                            {key.permissions.join(', ')}
                            {key.expiresAt && (
                              <span className="inline-flex items-center gap-1 ml-2">
                                <CalendarClock size={12} /> expires {new Date(key.expiresAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <div>
                            {key.requestCount} requests
                            {key.lastUsedAt && <> · last used {new Date(key.lastUsedAt).toLocaleString()}</>}
                            {' · '}created {new Date(key.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => handleRevoke(key)}
                        disabled={revoking === key.id || !!key.revokedAt}
                        className="text-red-600 shrink-0"
                      >
                        {revoking === key.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Revoke
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
