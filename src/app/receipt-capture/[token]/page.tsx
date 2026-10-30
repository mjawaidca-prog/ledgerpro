'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, FolderOpen, Loader2, ReceiptText } from 'lucide-react';
import { readReceiptTextInBrowser } from '@/lib/receipts/client-ocr';

/**
 * "Add from phone" capture page — opened from the temporary link the
 * signed-in Receipts page shows as a QR code. No sign-in here: the
 * link itself is the credential (upload-only, one company, 30 min).
 * Photos are re-encoded to JPEG in the phone's browser before upload,
 * which is also what makes iPhone HEIC photos work.
 */

type Phase = 'checking' | 'dead' | 'ready' | 'uploading' | 'done';

interface LastReceipt {
  merchant: string | null;
  total: number | null;
  date: string | null;
}

async function normalizeImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolveImg, reject) => {
        const el = new Image();
        el.onload = () => resolveImg(el);
        el.onerror = reject;
        el.src = url;
      });
      const maxSide = 2600;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) return file;
      return new File([blob], 'receipt-photo.jpg', { type: 'image/jpeg' });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return file;
  }
}

export default function ReceiptCapturePage() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [companyName, setCompanyName] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<LastReceipt | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef('');

  useEffect(() => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    tokenRef.current = parts[parts.length - 1] ?? '';
    (async () => {
      try {
        const res = await fetch(`/api/receipts/phone-upload?token=${encodeURIComponent(tokenRef.current)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'This link is not valid.');
        setCompanyName(json.data.companyName);
        setExpiresAt(json.data.expiresAt);
        setPhase('ready');
      } catch (e: any) {
        setError(e.message);
        setPhase('dead');
      }
    })();
  }, []);

  async function handleFile(picked: File) {
    setPhase('uploading');
    setError('');
    try {
      const isPdf = picked.type === 'application/pdf';
      const file = isPdf ? picked : await normalizeImage(picked);
      const form = new FormData();
      form.set('token', tokenRef.current);
      form.set('file', file);
      if (!isPdf) {
        // Best-effort: read the photo here on the phone so the receipt
        // arrives with its fields filled in. Failure just means the
        // server/manual path handles it.
        const text = await readReceiptTextInBrowser(file).catch(() => '');
        if (text) form.set('extractedText', text);
      }
      const res = await fetch('/api/receipts/phone-upload', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed.');
      const r = json.data.receipt;
      setLast({ merchant: r.merchant ?? null, total: r.total ?? null, date: r.date ?? null });
      setCount((c) => c + 1);
      setPhase('done');
    } catch (e: any) {
      setError(e.message);
      setPhase('ready');
    }
  }

  const expiryText = expiresAt
    ? new Date(expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-5 p-6">
      <div className="flex items-center gap-2 text-[var(--text-strong)]">
        <ReceiptText size={26} />
        <h1 className="text-xl font-bold">Add a receipt</h1>
      </div>

      {phase === 'checking' && (
        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Checking your link…
        </p>
      )}

      {phase === 'dead' && (
        <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
          <p className="text-sm text-[var(--danger)]">{error}</p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Links last 30 minutes. On your computer, open LedgerPro → Receipts → “Add from phone” for a fresh one.
          </p>
        </div>
      )}

      {phase !== 'checking' && phase !== 'dead' && (
        <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="text-center text-sm text-[var(--text)]">
            Sending to <strong>{companyName}</strong>
          </p>
          <p className="mt-1 text-center text-xs text-[var(--text-muted)]">
            The receipt lands in the Receipts inbox. This link works until {expiryText}.
          </p>

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) handleFile(f);
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) handleFile(f);
            }}
          />

          <button
            type="button"
            disabled={phase === 'uploading'}
            onClick={() => cameraRef.current?.click()}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-4 text-base font-semibold text-white disabled:opacity-60"
          >
            {phase === 'uploading' ? <Loader2 size={20} className="animate-spin" /> : <Camera size={20} />}
            {phase === 'uploading' ? 'Sending…' : 'Take a photo'}
          </button>
          <button
            type="button"
            disabled={phase === 'uploading'}
            onClick={() => fileRef.current?.click()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--text)] disabled:opacity-60"
          >
            <FolderOpen size={16} /> Choose a photo or PDF instead
          </button>

          {error && <p className="mt-3 text-center text-sm text-[var(--danger)]">{error}</p>}

          {phase === 'done' && last && (
            <div className="mt-4 rounded-lg bg-[var(--surface-2)] p-3 text-center">
              <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-[var(--success)]">
                <CheckCircle2 size={16} /> Receipt added{count > 1 ? ` (${count} so far)` : ''}
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {last.merchant ?? 'Receipt'}
                {last.total !== null ? ` · $${last.total.toFixed(2)}` : ''}
                {last.date ? ` · ${last.date}` : ''} — find it in the Receipts inbox.
              </p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
