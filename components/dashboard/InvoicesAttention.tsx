import { Send } from 'lucide-react'

interface AttentionInvoice {
  id: string
  clientName: string
  clientInitials: string
  clientColor: string
  invoiceId: string
  dueLabel: string
  amount: string
  badgeClass: 'badge-overdue' | 'badge-pending'
  badgeText: string
}

interface InvoicesAttentionProps {
  invoices: AttentionInvoice[]
}

export function InvoicesAttention({ invoices }: InvoicesAttentionProps) {
  return (
    <div className="card" style={{ alignSelf: 'start' }}>
      <div className="panel-head">
        <h3 className="t-h3">Invoices needing attention</h3>
        <div className="spacer" />
        <span
          className="badge badge-overdue"
          style={{ textTransform: 'none', letterSpacing: 0 }}
        >
          {invoices.length}
        </span>
      </div>
      <div className="inv-list">
        {invoices.map((inv) => (
          <div key={inv.id} className="inv-item">
            <span className="av" style={{ background: inv.clientColor }}>
              {inv.clientInitials}
            </span>
            <div className="inv-meta">
              <div className="inv-client">{inv.clientName}</div>
              <div className="inv-sub">{inv.invoiceId} · {inv.dueLabel}</div>
            </div>
            <div className="inv-right">
              <span className="inv-amt">{inv.amount}</span>
              <span className={`badge ${inv.badgeClass}`}>
                <span className="dot" />
                {inv.badgeText}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: '13px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: '10px' }}>
        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }}>
          <Send />Send reminders
        </button>
        <button className="btn btn-ghost btn-sm">All invoices</button>
      </div>
    </div>
  )
}
