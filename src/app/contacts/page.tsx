'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import {
  Plus,
  Search,
  Upload,
  Download,
  MoreHorizontal,
  Phone,
  Mail,
  X,
} from 'lucide-react';
import type { Column } from '@/components/ui/DataTable';

// ─── Types ───

interface Contact {
  id: string;
  name: string;
  companyName: string | null;
  type: 'customer' | 'supplier';
  email: string | null;
  phone: string | null;
  outstandingBalance: number;
  status: 'active' | 'inactive';
  notes: string | null;
}

// ─── Contact form data ───

interface ContactFormData {
  name: string;
  companyName: string;
  type: 'customer' | 'supplier';
  email: string;
  phone: string;
  status: 'active' | 'inactive';
  notes: string;
}

const emptyForm: ContactFormData = {
  name: '',
  companyName: '',
  type: 'customer',
  email: '',
  phone: '',
  status: 'active',
  notes: '',
};

// ─── Avatar color helper ───

function avatarColor(name: string, type: 'customer' | 'supplier'): string {
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const blues = ['#1f6feb', '#3074ef', '#1857c4', '#5b8bf8'];
  const purples = ['#7c3aed', '#8b5cf6', '#6d28d9', '#a78bfa'];
  const colors = type === 'customer' ? blues : purples;
  return colors[hash % colors.length];
}

// ─── Page ───

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('active');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ContactFormData>(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'danger' } | null>(null);

  // ─── Fetch contacts ───

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/contacts?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch contacts');

      const json = await res.json();
      setContacts(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, statusFilter]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // ─── Modal handlers ───

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormErrors({});
    setModalOpen(true);
  }

  function openEdit(contact: Contact) {
    setEditingId(contact.id);
    setForm({
      name: contact.name,
      companyName: contact.companyName ?? '',
      type: contact.type,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      status: contact.status,
      notes: contact.notes ?? '',
    });
    setFormErrors({});
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
  }

  // ─── Form validation ───

  function validateForm(): boolean {
    const errors: Record<string, string> = {};

    if (!form.name.trim()) errors.name = 'Contact name is required';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'Invalid email address';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  // ─── Submit ───

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      companyName: form.companyName.trim() || null,
      type: form.type,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
    };

    try {
      const url = editingId ? `/api/contacts/${editingId}` : '/api/contacts';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Save failed');
      }

      setToast({
        message: editingId ? 'Contact updated.' : 'Contact created.',
        type: 'success',
      });
      closeModal();
      fetchContacts();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Something went wrong',
        type: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }

  // ─── Delete ───

  async function handleDelete(id: string) {
    if (!confirm('Delete this contact? If they have transactions, they will be marked inactive instead.')) return;

    try {
      const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
      const json = await res.json();

      setToast({
        message: json.note ?? 'Contact deleted.',
        type: 'success',
      });
      fetchContacts();
    } catch {
      setToast({ message: 'Delete failed.', type: 'danger' });
    }
  }

  // ─── Columns ───

  const columns: Column<Contact>[] = [
    {
      key: 'name',
      header: 'Name / Company',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-[10px]">
          <div
            className="w-[26px] h-[26px] rounded-full grid place-items-center text-[11px] font-bold text-white flex-none"
            style={{ background: avatarColor(row.name, row.type) }}
          >
            {row.name.charAt(0)}
          </div>
          <div>
            <div className="text-sm text-[var(--text-strong)] font-medium leading-[1.3]">
              {row.name}
            </div>
            {row.companyName && (
              <div className="text-xs text-[var(--text-muted)]">{row.companyName}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      render: (row) => (
        <Badge variant={row.type === 'customer' ? 'info' : 'neutral'}>
          {row.type}
        </Badge>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      sortable: true,
      render: (row) => (
        row.email ? (
          <a
            href={`mailto:${row.email}`}
            className="text-[var(--accent)] hover:underline text-sm"
          >
            {row.email}
          </a>
        ) : (
          <span className="text-[var(--text-faint)]">—</span>
        )
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      sortable: true,
      render: (row) => (
        row.phone ? (
          <span className="text-sm">{row.phone}</span>
        ) : (
          <span className="text-[var(--text-faint)]">—</span>
        )
      ),
    },
    {
      key: 'outstandingBalance',
      header: 'Balance',
      type: 'num',
      sortable: true,
      align: 'right',
      render: (row) => (
        <span className={cn(
          'font-mono tabular-nums text-sm font-medium',
          row.outstandingBalance > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]'
        )}>
          {money(row.outstandingBalance)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row) => (
        <Badge variant={row.status === 'active' ? 'paid' : 'draft'}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[80px]',
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDelete(row.id)}
            className="text-[var(--danger)] hover:text-[var(--danger)]"
          >
            <X size={14} />
          </Button>
        </div>
      ),
    },
  ];

  // ─── Render ───

  return (
    <AppShell companyName="Northwind Trading" companyPlan="Business">
      {/* Header */}
      <div className="content-head">
        <div>
          <h1 className="greet">Contacts</h1>
          <p className="sub">Manage your customers and suppliers.</p>
        </div>
        <div className="spacer" />
        <Button variant="secondary" size="md">
          <Upload size={16} />
          Import
        </Button>
        <Button variant="secondary" size="md">
          <Download size={16} />
          Export
        </Button>
        <Button onClick={openCreate}>
          <Plus size={16} />
          New Contact
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-[360px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] grid pointer-events-none">
            <Search size={16} />
          </span>
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-[38px] pl-[34px] pr-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)]"
          />
        </div>

        <Segmented
          options={[
            { value: 'all', label: 'All' },
            { value: 'customer', label: 'Customers' },
            { value: 'supplier', label: 'Suppliers' },
          ]}
          value={typeFilter}
          onChange={setTypeFilter}
        />

        <Segmented
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />

        <div className="flex-1" />
        <span className="text-sm text-[var(--text-muted)]">
          {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Table */}
      <DataTable
        columns={columns}
        data={contacts}
        rowKey={(row) => row.id}
        emptyMessage={loading ? 'Loading...' : 'No contacts found.'}
      />

      {/* ─── Create / Edit Modal ─── */}
      {modalOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-90 bg-black/40 backdrop-blur-sm"
            onClick={closeModal}
          />

          {/* Modal */}
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-100 w-full max-w-[520px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-lg)]">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
              <h2 className="t-h3 flex-1">
                {editingId ? 'Edit Contact' : 'New Contact'}
              </h2>
              <button
                onClick={closeModal}
                className="w-8 h-8 grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Type toggle */}
              <div className="flex gap-3">
                <button
                  type="button"
                  className={cn(
                    'flex-1 py-3 rounded-lg border text-sm font-semibold transition-all',
                    form.type === 'customer'
                      ? 'border-[var(--border-focus)] bg-[var(--primary-soft)] text-[var(--primary)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]'
                  )}
                  onClick={() => setForm({ ...form, type: 'customer' })}
                >
                  Customer
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex-1 py-3 rounded-lg border text-sm font-semibold transition-all',
                    form.type === 'supplier'
                      ? 'border-[var(--border-focus)] bg-[var(--primary-soft)] text-[var(--primary)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]'
                  )}
                  onClick={() => setForm({ ...form, type: 'supplier' })}
                >
                  Supplier / Vendor
                </button>
              </div>

              {/* Name */}
              <div className="field">
                <label>Contact Name</label>
                <input
                  type="text"
                  className={cn('input', formErrors.name && 'is-error')}
                  placeholder="Rosa Alvarez"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                {formErrors.name && (
                  <span className="err">{formErrors.name}</span>
                )}
              </div>

              {/* Company */}
              <div className="field">
                <label>Company Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder={form.type === 'customer' ? 'Acme Corp' : 'AWS'}
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                />
              </div>

              {/* Email + Phone */}
              <div className="grid grid-cols-2 gap-4">
                <div className="field">
                  <label>Email</label>
                  <div className="input-group">
                    <span className="lead-icon">
                      <Mail size={16} />
                    </span>
                    <input
                      type="email"
                      className={cn('input', formErrors.email && 'is-error')}
                      placeholder="rosa@acmecorp.com"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  {formErrors.email && (
                    <span className="err">{formErrors.email}</span>
                  )}
                </div>
                <div className="field">
                  <label>Phone</label>
                  <div className="input-group">
                    <span className="lead-icon">
                      <Phone size={16} />
                    </span>
                    <input
                      type="text"
                      className="input"
                      placeholder="+1 (555) 123-4567"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Status */}
              <div className="field">
                <label>Status</label>
                <Segmented
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                  ]}
                  value={form.status}
                  onChange={(v) => setForm({ ...form, status: v as 'active' | 'inactive' })}
                />
              </div>

              {/* Notes */}
              <div className="field">
                <label>Notes</label>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="Internal notes..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </form>

            {/* Footer */}
            <div className="flex items-center gap-3 px-5 py-4 border-t border-[var(--border)]">
              <Button variant="secondary" onClick={closeModal}>
                Cancel
              </Button>
              <div className="flex-1" />
              <Button onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Contact'}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ─── Toast ─── */}
      {toast && (
        <div className="toast-stack">
          <div className={cn('toast', toast.type === 'danger' && 'danger')}>
            <span className="t-ico">
              {toast.type === 'success' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="10" />
                </svg>
              )}
            </span>
            <div className="t-body">
              <div>{toast.message}</div>
            </div>
            <button className="t-close" onClick={() => setToast(null)}>
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
