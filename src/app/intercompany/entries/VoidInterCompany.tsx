'use client';

import { useState } from 'react';
import {
  canVoid,
  postVoid,
  voidConfirmSummary,
  type VoidableTransaction,
} from './void-helpers';

/**
 * Void action + in-page confirmation for one inter-company transaction.
 *
 * The backend void (POST /api/intercompany/transactions/[id]/void) reverses
 * BOTH entries of the pair in one transaction. This component is the only
 * UI path to it — deliberately an in-page alertdialog panel, never
 * window.confirm (which dies silently in some browsers).
 */
export default function VoidInterCompany({
  transaction,
  onVoided,
}: {
  transaction: VoidableTransaction;
  onVoided: (reference: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canVoid(transaction.status)) return null;

  async function handleConfirm() {
    setVoiding(true);
    setError(null);
    try {
      await postVoid(transaction.id);
      setOpen(false);
      onVoided(transaction.reference);
    } catch (e: any) {
      // Panel stays open with the server's message visible.
      setError(e?.message || 'Failed to void inter-company transaction');
    } finally {
      setVoiding(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => { setError(null); setOpen(true); }}
          style={{
            background: 'transparent', color: 'var(--danger)',
            border: '1px solid var(--danger)', borderRadius: 'var(--r-md)',
            padding: '7px 14px', fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer',
          }}
        >
          Void
        </button>
      </div>

      {open && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-label={`Void ${transaction.reference}`}
          style={{
            background: 'var(--warning-soft)', border: '1px solid var(--warning)',
            borderRadius: 'var(--r-md)', padding: '14px 16px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
            Void {transaction.reference}?
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
            {voidConfirmSummary(transaction)}
          </p>
          {error && (
            <p role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', margin: 0, lineHeight: 1.5 }}>
              {error}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={voiding}
              style={{
                background: 'var(--danger)', color: 'white',
                border: '0', borderRadius: 'var(--r-md)',
                padding: '9px 15px', fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)', fontWeight: 600,
                cursor: voiding ? 'default' : 'pointer', opacity: voiding ? 0.6 : 1,
              }}
            >
              {voiding ? 'Voiding…' : 'Void both entries'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                padding: '9px 15px', fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
