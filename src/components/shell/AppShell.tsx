'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/cn';
import { Rail } from './Rail';
import { Topbar } from './Topbar';
import { NotificationsPanel } from './NotificationsPanel';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? match[1] : null;
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
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // SSR-safe company info — start with props (matches server render),
  // then hydrate from cookies/session in useEffect
  const [companyName, setCompanyName] = useState(propCompanyName || 'LedgerPro');
  const [companyId, setCompanyId] = useState<string | null>(propCompanyId || null);
  const [userName, setUserName] = useState(propUserName || 'User');
  const [userEmail, setUserEmail] = useState(propUserEmail || '');

  // Hydrate from session + cookies after mount (client-only, avoids hydration mismatch)
  useEffect(() => {
    const sessionUser = session?.user as any;

    const cookieCompanyName = getCookie('lp-active-company-name');
    const cookieCompanyId = getCookie('lp-active-company-id');

    // Best company name: cookie > session > prop (keep current)
    const resolvedName =
      cookieCompanyName ||
      sessionUser?.activeCompanyName || sessionUser?.companyName ||
      undefined;
    if (resolvedName) setCompanyName(resolvedName);

    // Best company ID
    const resolvedId =
      cookieCompanyId ||
      sessionUser?.activeCompanyId || sessionUser?.companyId ||
      null;
    if (resolvedId) setCompanyId(resolvedId);

    // User info from session
    if (sessionUser?.name) setUserName(sessionUser.name);
    if (sessionUser?.email) setUserEmail(sessionUser.email);

    // Seed client cookies from session if not already set
    if (!cookieCompanyId && sessionUser?.activeCompanyId) {
      document.cookie = `lp-active-company-id=${sessionUser.activeCompanyId};path=/;max-age=2592000;SameSite=Lax`;
    }
    if (!cookieCompanyName && (sessionUser?.activeCompanyName || sessionUser?.companyName)) {
      const name = sessionUser?.activeCompanyName || sessionUser?.companyName;
      document.cookie = `lp-active-company-name=${name};path=/;max-age=2592000;SameSite=Lax`;
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
          onNotificationsClick={() => setNotificationsOpen(true)}
          onMenuClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        />
        <div className="content">{children}</div>
      </div>

      <NotificationsPanel
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />
    </div>
  );
}
