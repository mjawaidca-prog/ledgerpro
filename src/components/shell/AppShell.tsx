'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Rail } from './Rail';
import { Topbar } from './Topbar';
import { NotificationsPanel } from './NotificationsPanel';
import { AlertTriangle } from 'lucide-react';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  // Cookie values get percent-encoded server-side (e.g. spaces in a company
  // name) — decode so the raw "Debug%20Co" form doesn't leak into the UI.
  return match ? decodeURIComponent(match[1]) : null;
}

interface AppShellProps {
  companyName?: string;
  companyPlan?: string;
  companyId?: string | null;
  userName?: string;
  userEmail?: string;
  children: React.ReactNode;
}

export function AppShell({
  companyName: propCompanyName,
  companyPlan: propCompanyPlan,
  companyId: propCompanyId,
  userName: propUserName,
  userEmail: propUserEmail,
  children,
}: AppShellProps) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [trialInfo, setTrialInfo] = useState<{ status: string; daysLeft: number | null } | null>(null);

  // SSR-safe company info — start with props (matches server render),
  // then hydrate from cookies/session in useEffect
  const [companyName, setCompanyName] = useState(propCompanyName || 'LedgerPro');
  const [companyId, setCompanyId] = useState<string | null>(propCompanyId || null);
  const [userName, setUserName] = useState(propUserName || 'User');
  const [userEmail, setUserEmail] = useState(propUserEmail || '');

  // Hydrate from session + cookies after mount (client-only, avoids hydration mismatch)
  useEffect(() => {
    const sessionUser = session?.user as any;
    if (!sessionUser) return;

    const cookieCompanyName = getCookie('lp-active-company-name');
    const cookieCompanyId = getCookie('lp-active-company-id');

    // The active-company cookie is the only way the "switch company" feature
    // persists across page loads (the JWT's activeCompanyId is fixed to the
    // user's first company at login and never updates). But that also means
    // a cookie left over from a *different* account on a shared browser would
    // otherwise silently point this session at a company it has nothing to
    // do with. availableCompanies is fresh per login and scoped to whoever
    // just authenticated, so use it to check the cookie is actually one of
    // this user's own companies before trusting it.
    const available: { id: string; name: string }[] = sessionUser.availableCompanies || [];
    const cookieBelongsToUser = !!cookieCompanyId && available.some((c) => c.id === cookieCompanyId);

    const resolvedId = cookieBelongsToUser
      ? cookieCompanyId
      : sessionUser?.activeCompanyId || sessionUser?.companyId || null;
    if (resolvedId) setCompanyId(resolvedId);

    const resolvedName = cookieBelongsToUser
      ? cookieCompanyName || available.find((c) => c.id === cookieCompanyId)?.name
      : sessionUser?.activeCompanyName || sessionUser?.companyName;
    if (resolvedName) setCompanyName(resolvedName);

    // User info from session
    if (sessionUser?.name) setUserName(sessionUser.name);
    if (sessionUser?.email) setUserEmail(sessionUser.email);

    // (Re)write the cookies whenever they don't match the resolved company —
    // either because they were empty, or because they belonged to someone
    // else and just got overridden above.
    if (resolvedId && cookieCompanyId !== resolvedId) {
      document.cookie = `lp-active-company-id=${encodeURIComponent(resolvedId)};path=/;max-age=2592000;SameSite=Lax`;
    }
    if (resolvedName && cookieCompanyName !== resolvedName) {
      document.cookie = `lp-active-company-name=${encodeURIComponent(resolvedName)};path=/;max-age=2592000;SameSite=Lax`;
    }
  }, [session]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('lp-theme') as 'light' | 'dark' | null;
    const savedDensity = localStorage.getItem('lp-density') as 'comfortable' | 'compact' | null;
    if (savedTheme) setThemeState(savedTheme);
    if (savedDensity) setDensity(savedDensity);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('lp-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
    localStorage.setItem('lp-density', density);
  }, [density]);

  // Check onboarding + trial status for the active company — show banners for
  // either. /api/companies returns a list (one per company this user belongs
  // to), so find the entry that matches the currently active company rather
  // than reading these fields off the array itself.
  useEffect(() => {
    async function checkCompanyStatus() {
      try {
        const res = await fetch('/api/companies');
        const json = await res.json();
        const list: any[] = Array.isArray(json.data) ? json.data : [];
        const active = list.find((c) => c.id === companyId) || list[0];
        setOnboardingComplete(active?.onboardingComplete ?? true);
        setTrialInfo(active ? { status: active.status, daysLeft: active.trialDaysLeft } : null);
      } catch {
        // If API fails, assume complete to avoid blocking
        setOnboardingComplete(true);
      }
    }
    // Only check when session is loaded and we know which company is active
    if (session && companyId) {
      checkCompanyStatus();
    }
  }, [session, companyId]);

  const toggleTheme = useCallback(() => {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const effectivePlan = propCompanyPlan || 'Business';

  return (
    <div className="app">
      {/* Mobile backdrop */}
      {mobileMenuOpen && <div className="mobile-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,0,0,0.4)' }} onClick={() => setMobileMenuOpen(false)} />}
      <Rail
        companyName={companyName}
        companyPlan={effectivePlan}
        companyId={companyId}
        userName={userName}
        userEmail={userEmail}
        className={mobileMenuOpen ? 'open' : ''}
      />
      <div className="main">
        <Topbar
          theme={theme}
          density={density}
          onToggleTheme={toggleTheme}
          onDensityChange={setDensity}
          userName={userName}
          userEmail={userEmail}
          onNotificationsClick={() => setNotificationsOpen(true)}
          onMenuClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        />
        {/* Onboarding incomplete banner — hidden on onboarding/settings pages */}
        {onboardingComplete === false &&
          pathname !== '/onboarding' &&
          !pathname.startsWith('/settings') && (
            <div className="flex items-center gap-3 mx-4 mt-4 px-4 py-3 rounded-xl border border-[var(--warning-soft-border)] bg-[var(--warning-soft)] text-sm">
              <AlertTriangle size={18} className="text-[var(--warning)] flex-none" />
              <span className="flex-1 text-[var(--text)]">
                <strong>Company setup is incomplete.</strong> You can view data but cannot create or edit transactions until you complete onboarding.
              </span>
              <a
                href="/onboarding"
                className="flex-none px-4 py-1.5 rounded-md bg-[var(--primary)] text-white text-sm font-semibold hover:brightness-[0.95] transition-colors no-underline"
              >
                Complete Setup
              </a>
            </div>
          )}
        {/* Trial status banner — based on this company's signup date */}
        {trialInfo?.status === 'trialing' && trialInfo.daysLeft !== null && !pathname.startsWith('/settings') && (
          <div className={cn(
            'flex items-center gap-3 mx-4 mt-4 px-4 py-3 rounded-xl border text-sm',
            trialInfo.daysLeft <= 3
              ? 'border-[var(--danger)] bg-[var(--danger-soft)]'
              : 'border-[var(--border)] bg-[var(--surface-2)]'
          )}>
            <AlertTriangle size={18} className={cn('flex-none', trialInfo.daysLeft <= 3 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]')} />
            <span className="flex-1 text-[var(--text)]">
              {trialInfo.daysLeft > 0 ? (
                <><strong>{trialInfo.daysLeft} day{trialInfo.daysLeft !== 1 ? 's' : ''} left</strong> in your free trial.</>
              ) : (
                <><strong>Your free trial has ended.</strong></>
              )}
            </span>
            <a
              href="/settings/billing"
              className="flex-none px-4 py-1.5 rounded-md bg-[var(--primary)] text-white text-sm font-semibold hover:brightness-[0.95] transition-colors no-underline"
            >
              Upgrade
            </a>
          </div>
        )}
        <div className="content">{children}</div>
      </div>

      <NotificationsPanel
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />
    </div>
  );
}
