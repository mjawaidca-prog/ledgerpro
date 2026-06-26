'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import {
  ArrowLeft, UserPlus, Trash2, Crown, Shield, Users, Loader2, Check,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Member {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userImage: string | null;
  role: string;
  createdAt: string;
}

const roleBadge: Record<string, 'paid' | 'pending' | 'info' | 'neutral'> = {
  owner: 'paid',
  admin: 'info',
  bookkeeper: 'pending',
  viewer: 'neutral',
};

const roleLabel: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  bookkeeper: 'Bookkeeper',
  viewer: 'Viewer',
};

export default function TeamPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('bookkeeper');
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchMembers = async () => {
    try {
      const res = await fetch('/api/memberships');
      const json = await res.json();
      setMembers(json.data || []);
      // Try to figure out current user from session
      const sessionRes = await fetch('/api/auth/session');
      const sessionJson = await sessionRes.json();
      setCurrentUserId(sessionJson?.user?.id || null);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMembers(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/memberships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to invite');
      setMessage({ type: 'success', text: `${inviteEmail} added as ${roleLabel[inviteRole]}.` });
      setInviteEmail('');
      setShowInvite(false);
      fetchMembers();
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    try {
      const res = await fetch(`/api/memberships/${memberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const json = await res.json();
        setMessage({ type: 'danger', text: json.error || 'Failed to update role' });
        return;
      }
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
      );
    } catch {
      setMessage({ type: 'danger', text: 'Failed to update role' });
    }
  }

  async function handleRemove(memberId: string, name: string) {
    if (!confirm(`Remove ${name} from this company?`)) return;
    try {
      const res = await fetch(`/api/memberships/${memberId}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setMessage({ type: 'danger', text: json.error || 'Failed to remove member' });
        return;
      }
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      setMessage({ type: 'success', text: `${name} removed.` });
    } catch {
      setMessage({ type: 'danger', text: 'Failed to remove member' });
    }
  }

  if (loading) {
    return (
      <AppShell companyName="Team" companyPlan="">
        <div className="flex items-center justify-center h-64">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell companyName="Team Settings" companyPlan="">
      <div className="max-w-3xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.push('/settings')} className="p-2 rounded-lg hover:bg-[var(--surface-3)]">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--text-strong)]">Team</h1>
            <p className="text-sm text-[var(--text-muted)]">Manage who has access to your company.</p>
          </div>
          <Button onClick={() => setShowInvite(true)}>
            <UserPlus size={16} /> Invite Member
          </Button>
        </div>

        {message && <Alert variant={message.type} className="mb-4">{message.text}</Alert>}

        {/* Invite form */}
        {showInvite && (
          <Card className="mb-6">
            <CardHeader>
              <h3 className="font-semibold text-[var(--text-strong)]">Invite Team Member</h3>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleInvite} className="space-y-4">
                <div className="field">
                  <label>Email Address</label>
                  <input
                    type="email"
                    className="input"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>Role</label>
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(roleLabel).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setInviteRole(value)}
                        className={cn(
                          'py-2 px-3 text-xs font-semibold rounded-md border transition-all',
                          inviteRole === value
                            ? 'border-[var(--border-focus)] bg-[var(--primary-soft)] text-[var(--primary)]'
                            : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--text-faint)] mt-1.5">
                    {inviteRole === 'owner' && 'Full access including billing and team management.'}
                    {inviteRole === 'admin' && 'Can manage most settings, invite members, and access all financial data.'}
                    {inviteRole === 'bookkeeper' && 'Can record transactions, reconcile, and manage AP/AR.'}
                    {inviteRole === 'viewer' && 'Read-only access to reports and dashboards.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={inviting}>
                    {inviting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Send Invitation
                  </Button>
                  <Button variant="ghost" type="button" onClick={() => setShowInvite(false)}>Cancel</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        )}

        {/* Members list */}
        <Card>
          <CardHeader>
            <h3 className="font-semibold text-[var(--text-strong)]">
              <Users size={16} className="inline mr-2" />
              Members ({members.length})
            </h3>
          </CardHeader>
          <CardBody className="divide-y divide-[var(--border)]">
            {members.map((member) => (
              <div key={member.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                {/* Avatar */}
                <div className="w-[38px] h-[38px] rounded-full bg-[var(--primary)] text-white grid place-items-center font-bold text-sm flex-none">
                  {member.userName.charAt(0).toUpperCase()}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-strong)]">
                      {member.userName}
                    </span>
                    {member.userId === currentUserId && (
                      <span className="text-[10px] text-[var(--text-faint)]">(you)</span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">{member.userEmail}</p>
                </div>
                {/* Role selector */}
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.id, e.target.value)}
                  className="h-[32px] px-2 text-xs rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-strong)] focus:outline-none focus:border-[var(--border-focus)]"
                  disabled={member.userId === currentUserId && member.role === 'owner'}
                >
                  {Object.entries(roleLabel).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                {/* Remove */}
                <button
                  onClick={() => handleRemove(member.id, member.userName)}
                  disabled={member.userId === currentUserId && member.role === 'owner'}
                  className="p-2 rounded-md text-[var(--text-faint)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Remove member"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
