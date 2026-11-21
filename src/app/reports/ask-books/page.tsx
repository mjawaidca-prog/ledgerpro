'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Loader2, MessageCircleQuestion, ArrowRight, ShieldCheck } from 'lucide-react';
import { fetchWithTenantHeaders } from '@/lib/tenant-client';
import { N } from '@/lib/fx-format';

interface LibraryIntent {
  id: string;
  title: string;
  examples: string[];
  sourceReport: { label: string; href: string };
}

interface AnswerFigure { label: string; amount: number }
interface AnswerRow { label: string; detail?: string | null; amount: number }

type AskResponse =
  | {
      status: 'answered';
      source: 'matcher' | 'llm';
      answer: {
        intentId: string;
        title: string;
        headline: string;
        figures: AnswerFigure[];
        rows: AnswerRow[];
        workings: string;
        sourceReport: { label: string; href: string };
      };
    }
  | {
      status: 'unavailable';
      intentId: string;
      title: string;
      message: string;
      sourceReport: { label: string; href: string };
    }
  | {
      status: 'refused';
      message: string;
      library: { id: string; title: string; examples: string[] }[];
    };

interface Exchange {
  question: string;
  response: AskResponse;
}

export default function AskBooksPage() {
  const [library, setLibrary] = useState<LibraryIntent[] | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Exchange[]>([]);

  const loadLibrary = useCallback(() => {
    fetchWithTenantHeaders('/api/reports/ask-books')
      .then((r) => r.json())
      .then((json) => setLibrary(json.data?.library ?? []))
      .catch(() => setLibrary([]));
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const ask = async (raw?: string) => {
    const q = (raw ?? question).trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithTenantHeaders('/api/reports/ask-books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to answer');
      setHistory((prev) => [{ question: q, response: json.data as AskResponse }, ...prev]);
      setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to answer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-2">
        <MessageCircleQuestion size={26} className="text-[var(--accent)]" />
        <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)]">Ask Your Books</h1>
      </div>
      <p className="text-sm text-[var(--text-muted)] max-w-[680px] mb-6 flex items-start gap-2">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--success)]" />
        <span>
          Ask a plain-language question and get an answer computed from your own reports — never estimated,
          never invented. Every answer shows its workings and links to the report it came from. If a question
          can&apos;t be computed exactly, this page will say so instead of guessing.
        </span>
      </p>

      <Card className="mb-6">
        <CardBody>
          <div className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()}
              placeholder="e.g. How much did we spend on fuel this quarter?"
              className="flex-1 border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
              maxLength={500}
            />
            <Button onClick={() => ask()} disabled={busy || question.trim().length < 3}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'Ask'}
            </Button>
          </div>

          {library === null ? (
            <div className="flex items-center gap-2 mt-4 text-sm text-[var(--text-muted)]">
              <Loader2 size={14} className="animate-spin" /> Loading example questions…
            </div>
          ) : library.length > 0 && (
            <div className="mt-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-[var(--text-muted)] mb-2">
                Questions I can answer — tap one to try it
              </div>
              <div className="flex flex-wrap gap-1.5">
                {library.flatMap((intent) =>
                  intent.examples.map((example) => (
                    <button
                      key={`${intent.id}-${example}`}
                      onClick={() => ask(example)}
                      disabled={busy}
                      className="text-xs border border-[var(--border)] rounded-full px-2.5 py-1 text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50"
                    >
                      {example}
                    </button>
                  )),
                )}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      <div className="space-y-4">
        {history.map((exchange, i) => (
          <ExchangeCard key={`${exchange.question}-${i}`} exchange={exchange} onAsk={ask} />
        ))}
      </div>

      {history.length === 0 && !busy && (
        <p className="text-sm text-[var(--text-faint)] text-center py-8">
          Answers appear here, each with the figures, the workings, and the source report.
        </p>
      )}
    </AppShell>
  );
}

function ExchangeCard({ exchange, onAsk }: { exchange: Exchange; onAsk: (q: string) => void }) {
  const { question, response } = exchange;
  return (
    <Card>
      <CardHeader>
        <span className="text-sm font-medium text-[var(--text-strong)]">{question}</span>
      </CardHeader>
      <CardBody>
        {response.status === 'answered' && (
          <div>
            <p className="text-[15px] font-semibold text-[var(--text-strong)]">{response.answer.headline}</p>
            {response.answer.figures.length > 0 && (
              <div className="flex flex-wrap gap-x-8 gap-y-2 mt-3">
                {response.answer.figures.map((f) => (
                  <div key={f.label}>
                    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{f.label}</div>
                    <div className="font-mono tabular-nums text-lg font-bold text-[var(--text-strong)]">{N(f.amount)}</div>
                  </div>
                ))}
              </div>
            )}
            {response.answer.rows.length > 0 && (
              <div className="border border-[var(--border)] rounded-[var(--r-lg)] overflow-hidden mt-3">
                {response.answer.rows.map((row) => (
                  <div key={row.label} className="flex items-baseline gap-3 px-3 py-2 border-b border-[var(--surface-3)] last:border-b-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-[var(--text)] truncate">{row.label}</div>
                      {row.detail && <div className="text-[11px] text-[var(--text-faint)]">{row.detail}</div>}
                    </div>
                    <div className="font-mono tabular-nums text-[13px] text-[var(--text-strong)]">{N(row.amount)}</div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-[var(--text-muted)] mt-3">{response.answer.workings}</p>
            <Link
              href={response.answer.sourceReport.href}
              className="text-xs font-medium text-[var(--accent)] inline-flex items-center gap-1 mt-2"
            >
              Source: {response.answer.sourceReport.label} <ArrowRight size={12} />
            </Link>
          </div>
        )}

        {response.status === 'unavailable' && (
          <div>
            <p className="text-sm text-[var(--text)]">{response.message}</p>
            <Link
              href={response.sourceReport.href}
              className="text-xs font-medium text-[var(--accent)] inline-flex items-center gap-1 mt-2"
            >
              Open the {response.sourceReport.label} <ArrowRight size={12} />
            </Link>
          </div>
        )}

        {response.status === 'refused' && (
          <div>
            <p className="text-sm text-[var(--text)]">{response.message}</p>
            <ul className="mt-3 space-y-2">
              {response.library.map((intent) => (
                <li key={intent.id} className="text-sm">
                  <span className="font-medium text-[var(--text-strong)]">{intent.title}: </span>
                  {intent.examples.map((example, j) => (
                    <span key={example}>
                      {j > 0 && <span className="text-[var(--text-faint)]"> · </span>}
                      <button onClick={() => onAsk(example)} className="text-[var(--accent)] hover:underline">
                        “{example}”
                      </button>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
