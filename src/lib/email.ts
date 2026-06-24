/**
 * LedgerPro — Email service.
 * Sends invoices, payment confirmations, and reminders.
 *
 * For production, use Resend, SendGrid, or AWS SES.
 * This implementation uses Resend (free tier: 100 emails/day).
 */

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

// ─── Provider-agnostic send function ───

async function sendWithProvider(options: EmailOptions): Promise<{ success: boolean; messageId?: string }> {
  const apiKey = process.env.RESEND_API_KEY;

  if (apiKey) {
    // Resend provider
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'LedgerPro <invoices@ledgerpro.app>',
        to: options.to,
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Email send failed');
    }

    const data = await res.json();
    return { success: true, messageId: data.id };
  }

  // Fallback: log to console for development
  console.log('─── EMAIL (dev mode) ───');
  console.log(`To: ${options.to}`);
  console.log(`Subject: ${options.subject}`);
  console.log(`Body: ${options.html.substring(0, 200)}...`);
  console.log('────────────────────────');

  return { success: true };
}

// ─── Invoice email templates ───

export async function sendInvoice(
  to: string,
  invoiceId: string,
  customerName: string,
  total: number,
  dueDate: string,
  companyName: string = 'Northwind Trading'
) {
  const formattedTotal = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(total);

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Inter, system-ui, sans-serif; color: #364150; max-width: 580px; margin: 0 auto; padding: 40px 20px;">
      <div style="margin-bottom: 32px;">
        <h1 style="font-size: 24px; font-weight: 700; color: #131a24; margin: 0 0 4px;">
          ${companyName}
        </h1>
        <p style="font-size: 14px; color: #697587; margin: 0;">Invoice ${invoiceId}</p>
      </div>

      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        Hi ${customerName},
      </p>

      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        Attached is invoice <strong>${invoiceId}</strong> for <strong>${formattedTotal}</strong>,
        due by <strong>${dueDate}</strong>.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 32px;">
        <tr>
          <td style="padding: 12px 16px; background: #f6f8fb; border-radius: 8px 0 0 8px; font-size: 14px; color: #697587;">Amount Due</td>
          <td style="padding: 12px 16px; background: #f6f8fb; border-radius: 0 8px 8px 0; text-align: right;">
            <span style="font-family: JetBrains Mono, monospace; font-size: 20px; font-weight: 700; color: #131a24;">
              ${formattedTotal}
            </span>
          </td>
        </tr>
      </table>

      <p style="font-size: 14px; color: #697587; margin: 0 0 8px;">
        Payment can be made via ACH or wire transfer:
      </p>
      <p style="font-family: JetBrains Mono, monospace; font-size: 13px; color: #364150; background: #f6f8fb; padding: 12px 16px; border-radius: 8px; margin: 0 0 24px; line-height: 1.7;">
        Chase Business Checking<br>
        Account: ••4021<br>
        Routing: 021000021
      </p>

      <div style="border-top: 1px solid #e3e8ef; padding-top: 20px;">
        <p style="font-size: 13px; color: #9aa6b8; margin: 0;">
          ${companyName} · Sent via LedgerPro
        </p>
      </div>
    </body>
    </html>
  `;

  return sendWithProvider({
    to,
    subject: `Invoice ${invoiceId} from ${companyName} — ${formattedTotal} due ${dueDate}`,
    html,
  });
}

export async function sendPaymentConfirmation(
  to: string,
  invoiceId: string,
  customerName: string,
  amount: number,
  companyName: string = 'Northwind Trading'
) {
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Inter, system-ui, sans-serif; color: #364150; max-width: 580px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 48px; height: 48px; border-radius: 50%; background: #e7f6ee; color: #0c7044; font-size: 24px; line-height: 48px;">✓</div>
      </div>
      <h2 style="text-align: center; font-size: 20px; color: #131a24; margin: 0 0 8px;">Payment Received</h2>
      <p style="text-align: center; font-size: 15px; color: #697587; margin: 0 0 24px;">
        ${formattedAmount} for invoice ${invoiceId}
      </p>
      <p style="text-align: center; font-size: 14px; color: #9aa6b8;">
        ${companyName} · Thank you for your payment
      </p>
    </body>
    </html>
  `;

  return sendWithProvider({
    to,
    subject: `Payment received — ${invoiceId} (${formattedAmount})`,
    html,
  });
}
