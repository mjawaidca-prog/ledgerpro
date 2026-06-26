'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Bell, Check, CheckCheck, ExternalLink, Loader2,
  AlertTriangle, Clock, Users, CreditCard, Upload, ArrowRightLeft,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

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

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const fetchNotifications = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter === 'unread') params.set('unread', 'true');
      const res = await fetch(`/api/notifications?${params.toString()}`);
      const json = await res.json();
      setNotifications(json.data || []);
      setUnreadCount(json.unreadCount || 0);
    } catch {} finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  async function markAsRead(id: string) {
    try {
      await fetch(`/api/notifications/${id}`, { method: 'PUT' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  }

  async function markAllRead() {
    for (const n of notifications.filter((n) => !n.read)) {
      await fetch(`/api/notifications/${n.id}`, { method: 'PUT' });
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }

  if (loading) {
    return (
      <AppShell companyName="Notifications" companyPlan="">
        <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">
          <Loader2 size={24} className="animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell companyName="Notifications" companyPlan="">
      {/* Header */}
      <div className="content-head">
        <div>
          <h1 className="greet">Notifications</h1>
          <p className="sub">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
              : 'All caught up!'}
          </p>
        </div>
        <div className="spacer" />
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" onClick={markAllRead}>
            <CheckCheck size={14} /> Mark All Read
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        {(['all', 'unread'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              filter === f
                ? 'bg-[var(--primary)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:bg-[var(--surface-3)]'
            )}
          >
            {f === 'all' ? 'All' : 'Unread'}
          </button>
        ))}
      </div>

      {/* Notification list */}
      {notifications.length === 0 ? (
        <Card>
          <CardBody>
            <div className="py-12 text-center">
              <Bell size={40} className="mx-auto text-[var(--text-faint)] mb-3" />
              <p className="text-sm text-[var(--text-muted)]">No notifications yet.</p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-1">
          {notifications.map((n) => {
            const Icon = typeIcons[n.type] || Bell;
            const iconColor = typeColors[n.type] || 'text-[var(--text-muted)]';

            return (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.read) markAsRead(n.id);
                  if (n.actionUrl) router.push(n.actionUrl);
                }}
                className={cn(
                  'w-full text-left bg-[var(--surface)] border rounded-xl p-4 transition-all hover:shadow-[var(--shadow-sm)]',
                  n.read
                    ? 'border-[var(--border)] opacity-60'
                    : 'border-[var(--border-strong)] shadow-[var(--shadow-xs)]'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn('mt-0.5 flex-none', iconColor)}>
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-sm font-semibold', !n.read && 'text-[var(--text-strong)]')}>
                        {n.title}
                      </span>
                      {!n.read && (
                        <span className="w-[7px] h-[7px] rounded-full bg-[var(--primary)] flex-none" />
                      )}
                    </div>
                    <p className="text-sm text-[var(--text-muted)] mt-0.5">{n.body}</p>
                    <p className="text-xs text-[var(--text-faint)] mt-1.5">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  {n.actionUrl && (
                    <ExternalLink size={14} className="flex-none text-[var(--text-faint)] mt-0.5" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
