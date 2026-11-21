'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { ArrowLeft, Loader2, FileUp, Sparkles } from 'lucide-react';
import { LOAN_STATEMENT_ACCEPT } from '@/lib/loans/statement-validate';

function statusBadge(s: any) {
  if (s.appliedAt) return <Badge variant="info">Applied</Badge>;
  if (s.extractionStatus === 'extracted')
    return (
      <span className="flex items-center gap-1 rounded-full bg-[#eef4ff] px-2 py-0.5 text-[11px] font-semibold text-[#2f4b9b]">
        <Sparkles size={11} /> AI read
      </span>
    );
  if (s.extractionStatus === 'failed')
    return (
      <span className="rounded-full bg-[#fdf0ef] px-2 py-0.5 text-[11px] font-semibold text-[#8f1d17]">
        AI read failed
      </span>
    );
  if (s.extractionStatus === 'unavailable') return <Badge variant="draft">Manual entry</Badge>;
  return <Badge variant="pending">Reading…</Badge>;
}

export default function LoanStatementImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [statements, setStatements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/loans/statements')
      .then((r) => r.json())
      .then((json) => setStatements(Array.isArray(json.data) ? json.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/loans/statements', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      router.push(`/loans/import/${json.data.statement.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
    }
  }

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">Import from statement</h1>
          <p className="sub">
            Photograph or upload a lender statement — the read drafts a new loan or checks the
            statement against an existing loan&apos;s schedule. Nothing is saved to a loan until
            you review and apply it.
          </p>
        </div>
        <div className="spacer" />
        <Button variant="ghost" onClick={() => router.push('/loans')}>
          <ArrowLeft size={16} /> Back to Loans
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      )}

      <Card className="mb-4">
        <CardBody>
          <div className="py-8 text-center">
            <p className="text-sm text-[var(--text-muted)] mb-4">
              A PDF or a photo of the statement page that shows the balance, the payment amount and
              the next due date works best.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept={LOAN_STATEMENT_ACCEPT}
              className="hidden"
              onChange={handleUpload}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}{' '}
              {uploading ? 'Uploading…' : 'Upload a statement'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : statements.length > 0 ? (
        <Card>
          <CardHeader>
            <h3 className="font-semibold text-[var(--text-strong)]">Captured statements</h3>
          </CardHeader>
          <CardBody>
            <div className="divide-y divide-[var(--border)]">
              {statements.map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--text-strong)]">
                      {s.originalFileName}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {new Date(s.createdAt).toLocaleDateString()}
                      {s.fields?.lenderName?.value ? ` · ${s.fields.lenderName.value}` : ''}
                      {s.fields?.currentBalance?.value != null
                        ? ` · balance ${s.fields.currentBalance.value.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })}`
                        : ''}
                    </div>
                  </div>
                  {statusBadge(s)}
                  <Button variant="secondary" size="sm" onClick={() => router.push(`/loans/import/${s.id}`)}>
                    Review
                  </Button>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </AppShell>
  );
}
