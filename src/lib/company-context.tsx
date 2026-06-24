'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface CompanyContextType {
  companyId: string;
  companyName: string;
  currency: string;
  locale: string;
}

const CompanyContext = createContext<CompanyContextType | null>(null);

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within CompanyProvider');
  return ctx;
}

export function CompanyProvider({
  children,
  company,
}: {
  children: ReactNode;
  company: CompanyContextType;
}) {
  return (
    <CompanyContext.Provider value={company}>
      {children}
    </CompanyContext.Provider>
  );
}
