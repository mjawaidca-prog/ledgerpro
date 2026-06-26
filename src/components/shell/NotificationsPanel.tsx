'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { formatDistanceToNow } from 'date-fns';
import {
  X, Bell, Check, ExternalLink, Loader2,
  AlertTriangle, Clock, Users, CreditCard, Upload, ArrowRightLeft,
} from 'lucide-react';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  read: boolean;
  createdAt: string;
}

const typeIcons: Record<string, React.ElementType> = {
  invoice_overdue: AlertTriangle,
  bill_due: Clock,
  reconciliation_needed: ArrowRightLeft,
  import_complete: Upload,
  transfer_detected: ArrowRightLeft,
  period_close_reminder: Clock,
  subscription_expiring: CreditCard,
  member_joined: Users,
  system: Bell,
};

const typeColors: Record<string, string> = {
  invoice_overdue: 'text-[var(--danger)]',
  bill_due: 'text-[var(--warning)]',
  reconciliation_needed: 'text-[var(--primary)]',
  import_complete: 'text-[var(--success)]',
  transfer_detected: 'text-[var(--primary)]',
  period_close_reminder: 'text-[var(--warning)]',
  subscription_expiring: 'text-[var(--danger)]',
  member_joined: 'text-[var(--success)]',
  system: 'text-[var(--text-muted)]',
};

export function NotificationsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications?limit=10&unread=true');
      const json = await res.json();
      setNotifications(json.data || []);
      setUnreadCount(json.unreadCount || 0);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  async function markAsRead(id: string) {
    try {
      await fetch(`/api/notifications/${id}`, { method: 'PUT' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  }

  async function handleClick(n: Notification) {
    if (!n.read) markAsRead(n.id);
    onClose();
    if (n.actionUrl) router.push(n.actionUrl);
    else router.push('/notifications');
  }

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[400px] bg-[var(--surface)] border-l border-[var(--border)] shadow-[var(--shadow-lg)] z-50 flex flex-col animate-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Bell size={18} className="text-[var(--text-strong)]" />
            <h3 className="font-semibold text-[var(--text-strong)]">Notifications</h3>
            {unreadCount > 0 && (
              <span className="bg-[var(--primary)] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-[32px] h-[32px] grid place-items-center rounded-md text-[var(--text-faint)] hover:text-[var(--text-strong)] hover:bg-[var(--surface-3)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="py-12 text-center">
              <Bell size={32} className="mx-auto text-[var(--text-faint)] mb-2" />
              <p className="text-sm text-[var(--text-muted)]">All caught up!</p>
              <p className="text-xs text-[var(--text-faint)] mt-1">No new notifications.</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {notifications.map((n) => {
                const Icon = typeIcons[n.type] || Bell;
                const iconColor = typeColors[n.type] || 'text-[var(--text-muted)]';
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={cn(
                      'w-full text-left px-5 py-3.5 hover:bg-[var(--surface-2)] transition-colors flex items-start gap-3',
                      !n.read && 'bg-[var(--primary-soft)]'
                    )}
                  >
                    <div className={cn('mt-0.5 flex-none', iconColor)}>
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-sm font-semibold truncate', !n.read && 'text-[var(--text-strong)]')}>
                          {n.title}
                        </span>
                        {!n.read && (
                          <span className="w-[6px] h-[6px] rounded-full bg-[var(--primary)] flex-none" />
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-[10px] text-[var(--text-faint)] mt-1">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <ExternalLink size={12} className="flex-none text-[var(--text-faint)] mt-0.5" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <button
          onClick={() => { onClose(); router.push('/notifications'); }}
          className="px-5 py-3 border-t border-[var(--border)] text-sm text-[var(--accent)] hover:text-[var(--primary)] font-medium text-center transition-colors"
        >
          View all notifications
        </button>
      </div>
    </>
  );
}
