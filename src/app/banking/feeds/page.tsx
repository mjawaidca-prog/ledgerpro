'use client';

// Direct bank feeds (BF-4). Five states in one screen:
//   1. Not connected — hero card, three steps, compliance facts
//   2. Plaid Link — the hosted consent modal (never rebuilt; §3.3 of the
//      handoff: ship Plaid's SDK)
//   3. Select accounts — mapping form with the server-side rules mirrored
//      client-side for immediate feedback
//   4. Connected — connection cards, tiles, sync log, settings, disconnect
//   5. Reconnect — Link re-opened in update mode for non-active statuses

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft, Landmark, RefreshCw, Settings2, Unplug, Loader2, CircleAlert, Check,
} from 'lucide-react';

const PLAID_LINK_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const LINK_SESSION_KEY = 'ledgerpro.bankLink';

interface ConnectionAccount {
  providerAccountId: string;
  name: string;
  mask: string | null;
  subtype: string;
  currency: string;
  currentBalance: string | number | null;
  availableBalance: string | number | null;
  financialAccountId: string | null;
  isFeeding: boolean;
}

interface Connection {
  id: string;
  institutionName: string;
  status: string;
  consentExpiresAt: string | null;
  lastSyncAt: string | null;
  cadence: string;
  autoCategorize: boolean;
  notifyOnFailure: boolean;
  createdAt: string;
  accounts: ConnectionAccount[];
  recentSyncs: {
    id: string;
    trigger: string;
    status: string;
    addedCount: number;
    dedupedCount: number;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }[];
}

interface GlAccount {
  id: string;
  name: string;
  kind: string;
  currency: string;
}

const statusMeta: Record<string, { pill: string; badge: 'paid' | 'pending' | 'overdue' | 'info' | 'neutral'; action: string }> = {
  active: { pill: 'Feed live', badge: 'paid', action: '' },
  login_required: { pill: 'Reconnect needed', badge: 'pending', action: 'Reconnect' },
  pending_expiration: { pill: 'Consent renews soon', badge: 'pending', action: 'Renew consent' },
  revoked: { pill: 'Feed stopped', badge: 'overdue', action: 'Reconnect' },
  error: { pill: 'Sync failed', badge: 'overdue', action: 'Retry' },
};

export default function BankFeedsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null); // select-accounts state
  const [mapping, setMapping] = useState<Record<string, { feeding: boolean; glId: string }>>({});
  const [savingMapping, setSavingMapping] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<Connection | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({ cadence: 'daily', autoCategorize: true, notifyOnFailure: true });
  const [savingSettings, setSavingSettings] = useState(false);
  const [disconnectFor, setDisconnectFor] = useState<Connection | null>(null);
  const [removeUnreviewed, setRemoveUnreviewed] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const linkHandlerRef = useRef<any>(null);
  const resumedRef = useRef(false);

  const fetchConnections = useCallback(async () => {
    try {
      const [connRes, glRes] = await Promise.all([fetch('/api/plaid/connections'), fetch('/api/accounts')]);
      const connJson = await connRes.json();
      const glJson = await glRes.json();
      setConnections(connJson.data ?? []);
      const accounts = (glJson.data ?? []).map((a: any) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency ?? 'CAD' }));
      setGlAccounts(accounts);
    } catch {}
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  useEffect(() => {
    if (!session?.user || resumedRef.current || !new URLSearchParams(window.location.search).has('oauth_state_id')) return;
    resumedRef.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(LINK_SESSION_KEY) || 'null');
      if (!saved || saved.userId !== session.user.id || saved.companyId !== session.user.activeCompanyId || Date.now() > saved.expiresAt) {
        sessionStorage.removeItem(LINK_SESSION_KEY);
        throw new Error('The bank connection session expired or the company changed. Start Connect again.');
      }
      openPlaidLink(saved.linkToken, (token) => completeLink(token, saved.connectionId), saved.connectionId, window.location.href);
    } catch (error: any) { setMessage({ type: 'danger', text: error.message }); }
  }, [session]);

  function openPlaidLink(linkToken: string, onSuccess: (publicToken: string) => void, connectionId: string | null = null, receivedRedirectUri?: string) {
    if (!receivedRedirectUri) sessionStorage.setItem(LINK_SESSION_KEY, JSON.stringify({ linkToken, connectionId, userId: session?.user.id, companyId: session?.user.activeCompanyId, expiresAt: Date.now() + 30 * 60_000 }));
    if (!(window as any).Plaid) {
      const script = document.createElement('script');
      script.src = PLAID_LINK_SRC;
      script.onload = () => launchPlaid();
      script.onerror = () => setMessage({ type: 'danger', text: 'The bank connection window could not load. Please retry.' });
      document.body.appendChild(script);
    } else {
      launchPlaid();
    }
    function launchPlaid() {
      linkHandlerRef.current = (window as any).Plaid.create({
        token: linkToken,
        ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
        onSuccess: (publicToken: string) => {
          sessionStorage.removeItem(LINK_SESSION_KEY);
          if (receivedRedirectUri) window.history.replaceState({}, '', '/banking/feeds');
          onSuccess(publicToken);
          linkHandlerRef.current?.destroy();
        },
        onExit: () => {
          sessionStorage.removeItem(LINK_SESSION_KEY);
          linkHandlerRef.current?.destroy();
        },
        onEvent: () => {},
      });
      linkHandlerRef.current.open();
    }
  }

  async function handleConnect() {
    setMessage(null);
    try {
      const res = await fetch('/api/plaid/link-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not start the bank connection.');
      openPlaidLink(json.data.linkToken, (publicToken) => completeLink(publicToken, null));
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    }
  }

  async function completeLink(publicToken: string, connectionId: string | null) {
        try {
          if (connectionId) {
            await handleSyncNow(connectionId);
            return;
          }
          const exRes = await fetch('/api/plaid/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicToken }),
          });
          const exJson = await exRes.json();
          if (!exRes.ok) throw new Error(exJson.error || 'Could not connect the bank.');
          await fetchConnections();
          setPendingConnection({ ...exJson.data, id: exJson.data.connectionId, accounts: exJson.data.accounts.map((a: any) => ({ ...a, financialAccountId: null })), recentSyncs: [], cadence: 'daily', autoCategorize: true, notifyOnFailure: true, lastSyncAt: null, consentExpiresAt: exJson.data.consentExpiresAt, createdAt: new Date().toISOString() } as Connection);
          setMapping(Object.fromEntries(exJson.data.accounts.filter((a: any) => a.isFeeding).map((a: any) => [a.providerAccountId, { feeding: true, glId: bestGuessGlId(a) }])));
        } catch (err: any) {
          setMessage({ type: 'danger', text: err.message });
        }
  }

  function bestGuessGlId(account: ConnectionAccount): string {
    const isCredit = /credit/i.test(account.subtype);
    const matches = glAccounts.filter((g) => g.currency === account.currency && (isCredit ? g.kind === 'creditcard' : g.kind !== 'creditcard'));
    return matches[0]?.id ?? '';
  }

  async function handleSaveMapping() {
    if (!pendingConnection) return;
    const feedingEntries = Object.entries(mapping).filter(([, v]) => v.feeding);
    if (!feedingEntries.length) {
      setMessage({ type: 'danger', text: 'Choose at least one account to feed.' });
      return;
    }
    for (const [, v] of feedingEntries) {
      if (!v.glId) {
        setMessage({ type: 'danger', text: 'Link a ledger account before this account can feed.' });
        return;
      }
    }
    setSavingMapping(true);
    try {
      const res = await fetch(`/api/plaid/connections/${pendingConnection.id}/accounts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accounts: Object.entries(mapping).map(([providerAccountId, v]) => ({
            providerAccountId,
            is_feeding: v.feeding,
            financialAccountId: v.feeding ? v.glId : null,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const first = Object.values(json.fields ?? {})[0];
        throw new Error(first || json.error || 'Could not save the account mapping.');
      }
      // The mapping route does not auto-sync; run the first sync now.
      const syncResponse = await fetch(`/api/plaid/connections/${pendingConnection.id}/sync`, { method: 'POST' });
      if (!syncResponse.ok) throw new Error('Account mapping saved, but the first sync failed. Retry Sync now or contact support.');
      const syncResult = await syncResponse.json();
      if (syncResult.data?.skipped) throw new Error('Account mapping saved, but sync was not started. Check pilot access or an existing sync before retrying.');
      setPendingConnection(null);
      setMessage({ type: 'success', text: 'Account mapping saved and the first sync completed.' });
      await fetchConnections();
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setSavingMapping(false);
    }
  }

  async function handleSyncNow(id: string) {
    setSyncing(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/plaid/connections/${id}/sync`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed.');
      if (json.data?.skipped) throw new Error('Sync did not start. Check pilot access or retry after the current sync finishes.');
      setMessage({ type: 'success', text: `Sync complete — ${json.data.added} new, ${json.data.deduped} duplicates filtered.` });
      await fetchConnections();
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setSyncing(null);
    }
  }

  function handleReconnect(connection: Connection) {
    (async () => {
      try {
        const res = await fetch('/api/plaid/link-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: connection.id }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not reopen the bank connection.');
        openPlaidLink(json.data.linkToken, (token) => completeLink(token, connection.id), connection.id);
      } catch (err: any) {
        setMessage({ type: 'danger', text: err.message });
      }
    })();
  }

  function openSettings(connection: Connection) {
    setSettingsFor(connection);
    setSettingsDraft({ cadence: connection.cadence, autoCategorize: connection.autoCategorize, notifyOnFailure: connection.notifyOnFailure });
  }

  async function handleSaveSettings() {
    if (!settingsFor) return;
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/plaid/connections/${settingsFor.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsDraft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save settings.');
      setSettingsFor(null);
      setMessage({ type: 'success', text: 'Sync settings saved.' });
      await fetchConnections();
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleDisconnect() {
    if (!disconnectFor) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/plaid/connections/${disconnectFor.id}?removeUnreviewed=${removeUnreviewed ? '1' : '0'}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not disconnect.');
      setDisconnectFor(null);
      setRemoveUnreviewed(false);
      setMessage({
        type: 'success',
        text: `Feed disconnected${json.data.removedRows ? ` — ${json.data.removedRows} unreviewed rows removed` : ' — review rows kept'}.`,
      });
      await fetchConnections();
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setDisconnecting(false);
    }
  }

  const loading = connections === null;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => router.push('/banking')}>
            <ArrowLeft size={16} /> Banking
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Bank feeds</h1>
            <p className="text-sm text-muted-foreground">
              Transactions arrive on their own, land in Review &amp; match, and wait for your approval.
            </p>
          </div>
        </div>

        {message && <Alert variant={message.type === 'success' ? 'success' : 'danger'}>{message.text}</Alert>}

        {loading ? (
          <Card><CardBody><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading feeds…</div></CardBody></Card>
        ) : null}

        {/* ── State 1: not connected ── */}
        {!loading && connections!.length === 0 && !pendingConnection && (
          <Card>
            <CardBody>
              <div className="text-center py-8 space-y-4">
                <Landmark size={36} className="mx-auto text-[var(--primary)]" />
                <h2 className="text-xl font-bold">Let transactions arrive on their own</h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Connect a bank once. Transactions sync each morning, your rules apply, and everything waits in Review &amp; match — nothing hits the ledger unattended.
                </p>
                <div className="flex justify-center gap-3">
                  <Button variant="primary" onClick={handleConnect}>Connect a bank</Button>
                  <Button variant="secondary" onClick={() => router.push('/banking')}>Import a statement instead</Button>
                </div>
                <div className="grid grid-cols-3 gap-4 pt-4 border-t max-w-xl mx-auto text-left">
                  {[
                    ['01', 'Authorize once', 'Consent lasts as long as your bank allows, then asks to be renewed'],
                    ['02', 'Transactions arrive daily', 'Morning sync, rules applied, lands in Review & match'],
                    ['03', 'You still approve', 'Nothing posts to the ledger unattended'],
                  ].map(([n, t, b]) => (
                    <div key={n}>
                      <div className="text-xs font-bold text-[var(--primary)]">{n}</div>
                      <div className="text-sm font-semibold mt-1">{t}</div>
                      <div className="text-xs text-muted-foreground mt-1">{b}</div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  What you should know: billed per connection · read-only access · credentials go to your bank, never to LedgerPro · statement import still works.
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* ── State 3: select accounts ── */}
        {pendingConnection && (
          <Card>
            <CardHeader><h2 className="font-medium">Choose which accounts feed — {pendingConnection.institutionName}</h2></CardHeader>
            <CardBody>
              <div className="space-y-3">
                {pendingConnection.accounts.map((a) => {
                  const m = mapping[a.providerAccountId] ?? { feeding: a.isFeeding, glId: '' };
                  const isCredit = /credit/i.test(a.subtype);
                  return (
                    <div key={a.providerAccountId} className={`flex items-center gap-3 rounded border px-3 py-2 ${m.feeding ? '' : 'bg-[var(--surface-3)] opacity-70'}`}>
                      <input
                        type="checkbox"
                        checked={m.feeding}
                        onChange={(e) => setMapping({ ...mapping, [a.providerAccountId]: { ...m, feeding: e.target.checked } })}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{a.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {a.subtype.toUpperCase()} · ··{a.mask} · {a.currency}
                        </div>
                      </div>
                      <div className="text-sm font-mono">{typeof a.currentBalance === 'number' ? a.currentBalance.toFixed(2) : a.currentBalance}</div>
                      {m.feeding ? (
                        <select
                          className="w-56 rounded border px-2 py-1.5 text-sm"
                          value={m.glId}
                          onChange={(e) => setMapping({ ...mapping, [a.providerAccountId]: { ...m, glId: e.target.value } })}
                        >
                          <option value="">Link a ledger account…</option>
                          {glAccounts.filter((g) => g.currency === a.currency && (isCredit ? g.kind === 'creditcard' : g.kind !== 'creditcard')).map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not linked — will not feed</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="ghost" onClick={() => setPendingConnection(null)}>Cancel</Button>
                <Button variant="primary" onClick={handleSaveMapping} disabled={savingMapping}>
                  {savingMapping ? <Loader2 size={14} className="animate-spin" /> : null} Start the feed
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        {/* ── State 4: connected ── */}
        {!loading && connections!.map((c) => {
          const meta = statusMeta[c.status] ?? statusMeta.active;
          const arrivedToday = c.recentSyncs[0]?.addedCount ?? 0;
          return (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="font-medium">{c.institutionName}</h2>
                    <Badge variant={meta.badge}>{meta.pill}</Badge>
                  </div>
                  <div className="flex gap-2">
                    {meta.action && <Button variant="secondary" onClick={() => handleReconnect(c)}>{meta.action}</Button>}
                    <Button variant="secondary" onClick={() => handleSyncNow(c.id)} disabled={syncing === c.id}>
                      {syncing === c.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync now
                    </Button>
                    <Button variant="secondary" onClick={() => router.push('/banking')}>
                      {arrivedToday} to review
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground font-mono mt-1">
                  Connected {new Date(c.createdAt).toLocaleDateString()} · {c.cadence} · last sync {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleTimeString() : '—'}
                  {c.consentExpiresAt && <> · consent renews {new Date(c.consentExpiresAt).toLocaleDateString()}</>}
                </div>
              </CardHeader>
              <CardBody>
                <div className="space-y-1.5">
                  {c.accounts.map((a) => (
                    <div key={a.providerAccountId} className="flex items-center justify-between rounded border px-3 py-2">
                      <div>
                        <div className="text-sm">{a.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{a.subtype.toUpperCase()} · ··{a.mask} · {a.currency}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{a.isFeeding ? 'Feeding' : 'Not linked'}</span>
                        <span className="text-sm font-mono">{typeof a.currentBalance === 'number' ? a.currentBalance.toFixed(2) : a.currentBalance}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div className="rounded border px-3 py-2">
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">Arrived today</div>
                    <div className="text-xl font-mono">{arrivedToday}</div>
                  </div>
                  <div className="rounded border px-3 py-2">
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">Last sync</div>
                    <div className="text-xl font-mono">{c.recentSyncs[0] ? `${c.recentSyncs[0].addedCount} / ${c.recentSyncs[0].dedupedCount} dup` : '—'}</div>
                  </div>
                  <div className="rounded border px-3 py-2">
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">Status</div>
                    <div className="text-xl font-mono">{c.recentSyncs[0]?.status ?? '—'}</div>
                  </div>
                </div>
                {c.recentSyncs.some((s) => s.error) && (
                  <Alert variant="warning" className="mt-3">
                    <CircleAlert size={14} /> {c.recentSyncs.find((s) => s.error)?.error}
                  </Alert>
                )}
                <div className="flex justify-end gap-2 border-t mt-4 pt-3">
                  <Button variant="ghost" onClick={() => openSettings(c)}><Settings2 size={14} /> Sync settings</Button>
                  <Button variant="ghost" className="text-red-600" onClick={() => setDisconnectFor(c)}><Unplug size={14} /> Disconnect</Button>
                </div>
              </CardBody>
            </Card>
          );
        })}

        {/* ── Settings modal ── */}
        {settingsFor && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setSettingsFor(null)}>
            <div className="w-full max-w-md rounded-xl bg-[var(--surface)] border border-[var(--border)] p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold mb-4">Sync settings — {settingsFor.institutionName}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Cadence</label>
                  <select className="w-full rounded border px-3 py-2 text-sm" value={settingsDraft.cadence} onChange={(e) => setSettingsDraft({ ...settingsDraft, cadence: e.target.value })}>
                    <option value="daily">Daily, 6:00 AM MT</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">Hourly and twice-daily arrive in a later release.</p>
                </div>
                {(
                  [
                    ['autoCategorize', 'Auto-categorize with your bank rules'],
                    ['notifyOnFailure', 'Notify me when a sync fails'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 text-sm">
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={settingsDraft[key]}
                      onChange={(e) => setSettingsDraft({ ...settingsDraft, [key]: e.target.checked })}
                    />
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <Button variant="ghost" onClick={() => setSettingsFor(null)}>Cancel</Button>
                <Button variant="primary" onClick={handleSaveSettings} disabled={savingSettings}>
                  {savingSettings ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Disconnect modal ── */}
        {disconnectFor && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setDisconnectFor(null)}>
            <div className="w-full max-w-md rounded-xl bg-[var(--surface)] border border-[var(--border)] p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold mb-3">Disconnect {disconnectFor.institutionName}?</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Transactions stop arriving. Rows already posted to the ledger stay. Your consent at the bank is revoked and the stored token is deleted.
              </p>
              <label className="flex items-start gap-2 text-sm mb-6">
                <input type="checkbox" checked={removeUnreviewed} onChange={(e) => setRemoveUnreviewed(e.target.checked)} />
                <span>Also remove untouched feed rows still waiting in review (categorized or matched rows are kept).</span>
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setDisconnectFor(null)}>Keep the feed</Button>
                <Button variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
                  {disconnecting ? <Loader2 size={14} className="animate-spin" /> : null} Disconnect feed
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
