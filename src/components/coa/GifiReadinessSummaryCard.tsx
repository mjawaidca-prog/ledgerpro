'use client';

/**
 * GIFI readiness summary card for Tax Setup (Slice 3 of the
 * chart-of-accounts GIFI plan, §4.4): the counter and a link to the
 * worklist. The work itself lives on the Chart of Accounts page —
 * Tax Setup is about GST/HST, and account work should not be split
 * across two screens — so this card only reports and points.
 *
 * Uses the same counting rule as the readiness panel
 * (src/lib/gifi-readiness.ts). Renders nothing for sole proprietors
 * (quiet flow) or while loading.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { computeGifiReadiness, gifiFlowMode } from '@/lib/gifi-readiness';
import { activeCompanyFromCompaniesResponse } from '@/lib/active-company';

export function GifiReadinessSummaryCard() {
  const router = useRouter();
  const [state, setState] = useState<{ total: number; coded: number; needs: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [coaRes, companiesRes] = await Promise.all([
          fetch('/api/coa').then((r) => r.json()),
          fetch('/api/companies').then((r) => r.json()),
        ]);
        if (cancelled) return;
        const active = activeCompanyFromCompaniesResponse(companiesRes) as { businessType?: string | null } | null;
        if (gifiFlowMode(active?.businessType) === 'quiet') return;
        const accounts = Array.isArray(coaRes?.data) ? coaRes.data : [];
        const readiness = computeGifiReadiness(accounts);
        if (readiness.total === 0) return;
        setState({ total: readiness.total, coded: readiness.coded, needs: readiness.needsCode.length });
      } catch {
        // Summary card is advisory — stay silent on failure.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!state) return null;

  return (
    <Card>
      <CardHeader><h2 className="text-sm font-semibold">GIFI readiness (T2 export)</h2></CardHeader>
      <CardBody>
        <p className="text-sm text-[var(--text)]">
          <span className="font-mono tabular-nums font-bold">{state.coded} of {state.total} accounts coded</span>
          {state.needs > 0
            ? <> — {state.needs} account{state.needs === 1 ? '' : 's'} still need{state.needs === 1 ? 's' : ''} a GIFI code for the Nexvar Tax export.</>
            : <> — every countable account has a GIFI code.</>}
        </p>
        <Button variant="secondary" className="mt-3" onClick={() => router.push('/chart-of-accounts')}>
          {state.needs > 0 ? 'Assign GIFI codes' : 'Review GIFI codes'}
        </Button>
      </CardBody>
    </Card>
  );
}
