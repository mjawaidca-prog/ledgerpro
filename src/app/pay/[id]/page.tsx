import { db } from '@/lib/db';

// Public invoice view — no auth required
export default async function PayInvoicePage({ params }: { params: { id: string } }) {
  const invoiceId = params.id;

  let invoice: any = null;
  let company: any = null;

  try {
    invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (invoice) {
      company = await db.company.findUnique({
        where: { id: invoice.companyId },
        select: { name: true, legalName: true, gstNumber: true },
      });
    }
  } catch {}

  if (!invoice) {
    return (
      <html><body style={{ fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f6f8fb' }}>
        <div style={{ textAlign: 'center', padding: 40, background: '#fff', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', maxWidth: 400 }}>
          <h1 style={{ fontSize: 48, margin: '0 0 8px' }}>🔍</h1>
          <h2 style={{ margin: 0, color: '#131a24' }}>Invoice Not Found</h2>
          <p style={{ color: '#697587', fontSize: 14 }}>This invoice may have been removed or the link is incorrect.</p>
        </div>
      </body></html>
    );
  }

  const statusColors: Record<string, string> = { paid: '#16a063', sent: '#d6961f', overdue: '#e0484e', draft: '#697587', void: '#697587' };
  const statusLabel: Record<string, string> = { paid: 'Paid', sent: 'Open', overdue: 'Overdue', draft: 'Draft', void: 'Void' };

  return (
    <html>
      <head><title>Invoice {invoice.id} — {company?.name || ''}</title><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
      <body style={{ fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', background: '#f6f8fb', margin: 0, padding: '20px 16px 60px', minHeight: '100vh' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', background: '#fff', borderRadius: 16, padding: '32px 28px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, color: '#131a24', fontWeight: 700 }}>{company?.name || 'Company'}</h1>
              {company?.gstNumber && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#697587' }}>GST/HST: {company.gstNumber}</p>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#131a24', fontFamily: 'monospace' }}>{invoice.id}</div>
              <span style={{ display: 'inline-block', marginTop: 4, padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: (statusColors[invoice.status] || '#697587') + '18', color: statusColors[invoice.status] }}>
                {statusLabel[invoice.status] || invoice.status}
              </span>
            </div>
          </div>

          {/* Customer */}
          <div style={{ marginBottom: 24, padding: 16, background: '#f6f8fb', borderRadius: 10 }}>
            <p style={{ margin: 0, fontWeight: 600, color: '#131a24' }}>Bill To:</p>
            <p style={{ margin: '4px 0', color: '#364150' }}>{invoice.customer?.companyName || invoice.customer?.name}</p>
            {invoice.customer?.email && <p style={{ margin: 0, color: '#697587', fontSize: 13 }}>{invoice.customer.email}</p>}
          </div>

          {/* Dates */}
          <div style={{ display: 'flex', gap: 32, marginBottom: 24, fontSize: 13 }}>
            <div><span style={{ color: '#697587' }}>Issue Date:</span> <strong style={{ color: '#131a24' }}>{new Date(invoice.issueDate).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}</strong></div>
            <div><span style={{ color: '#697587' }}>Due Date:</span> <strong style={{ color: invoice.status === 'overdue' ? '#e0484e' : '#131a24' }}>{new Date(invoice.dueDate).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}</strong></div>
          </div>

          {/* Line Items */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead><tr style={{ background: '#f6f8fb' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: '#697587', fontWeight: 600, borderRadius: '8px 0 0 0' }}>Description</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, textTransform: 'uppercase', color: '#697587', fontWeight: 600 }}>Qty</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, textTransform: 'uppercase', color: '#697587', fontWeight: 600 }}>Rate</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, textTransform: 'uppercase', color: '#697587', fontWeight: 600, borderRadius: '0 8px 0 0' }}>Amount</th>
            </tr></thead>
            <tbody>
              {invoice.lineItems.map((li: any) => (
                <tr key={li.id} style={{ borderBottom: '1px solid #e3e8ef' }}>
                  <td style={{ padding: '10px 12px', color: '#131a24' }}>{li.description}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#697587', fontFamily: 'monospace' }}>{Number(li.quantity || 1)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#697587', fontFamily: 'monospace' }}>${Number(li.unitPrice || 0).toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#131a24', fontFamily: 'monospace', fontWeight: 500 }}>${Number(li.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#364150' }}>Subtotal</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#131a24' }}>${Number(invoice.subtotal || 0).toFixed(2)}</td>
              </tr>
              {Number(invoice.taxAmount || 0) > 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: '10px 12px', textAlign: 'right', color: '#697587' }}>Tax</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#131a24' }}>${Number(invoice.taxAmount).toFixed(2)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} style={{ padding: '14px 12px', textAlign: 'right', fontWeight: 700, fontSize: 18, color: '#131a24' }}>Total</td>
                <td style={{ padding: '14px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 18, color: '#1f6feb' }}>${Number(invoice.total).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          {invoice.notes && <p style={{ borderTop: '1px solid #e3e8ef', paddingTop: 16, color: '#697587', fontSize: 13, lineHeight: 1.6 }}>{invoice.notes}</p>}

          {/* Print button */}
          <div style={{ marginTop: 24, textAlign: 'center', paddingTop: 16, borderTop: '1px solid #e3e8ef' }}>
            <button id="printBtn" style={{ padding: '10px 28px', background: '#1f6feb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              🖨 Print Invoice
            </button>
          </div>
        </div>
        <script>{`document.getElementById('printBtn').addEventListener('click', function(){window.print()});`}</script>
      </body>
    </html>
  );
}
