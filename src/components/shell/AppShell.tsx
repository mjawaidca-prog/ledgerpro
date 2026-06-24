'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/cn';
import { Rail } from './Rail';
import { Topbar } from './Topbar';

interface AppShellProps {
  companyName: string;
  companyPlan?: string;
  userName?: string;
  userEmail?: string;
  children: React.ReactNode;
}

export function AppShell({
  companyName,
  companyPlan = 'Business',
  userName = 'Rosa Alvarez',
  userEmail = 'rosa@northwindtrading.com',
  children,
}: AppShellProps) {
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');

  useEffect(() => {
    // Hydrate from localStorage
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

  return (
    <div className="app">
      <Rail
        companyName={companyName}
        companyPlan={companyPlan}
        userName={userName}
        userEmail={userEmail}
      />
      <div className="main">
        <Topbar
          theme={theme}
          density={density}
          onToggleTheme={toggleTheme}
          onDensityChange={setDensity}
          userName={userName}
        />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
