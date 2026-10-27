// Pure platform-access decision (CC-1). Kept free of db/session imports so it
// is unit-testable; src/lib/platform/auth.ts feeds it real data.
//
// Platform access comes ONLY from a PlatformAdmin row. A company Membership
// role (owner/admin/...) is never consulted here — that separation is the
// whole point of the Control Center's security model.
export type PlatformAccessDecision =
  | { kind: 'allow'; role: string }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'mfa_required' };

export function evaluatePlatformAccess(input: {
  userId?: string | null;
  platformAdmin?: { role: string } | null;
  mfaEnabled?: boolean | null;
}): PlatformAccessDecision {
  if (!input.userId) return { kind: 'unauthenticated' };
  if (!input.platformAdmin) return { kind: 'forbidden' };
  if (input.mfaEnabled !== true) return { kind: 'mfa_required' };
  return { kind: 'allow', role: input.platformAdmin.role };
}

export function platformAccessHttpStatus(decision: PlatformAccessDecision): number {
  switch (decision.kind) {
    case 'allow': return 200;
    case 'unauthenticated': return 401;
    case 'mfa_required': return 403;
    case 'forbidden': return 403;
  }
}

export function platformAccessErrorMessage(decision: PlatformAccessDecision): string {
  switch (decision.kind) {
    case 'unauthenticated': return 'Unauthorized — please sign in.';
    case 'forbidden': return 'Platform administration access is required.';
    case 'mfa_required': return 'Two-factor authentication must be enabled before entering the Control Center. Enable it in Settings → Security, then return.';
    case 'allow': return '';
  }
}
