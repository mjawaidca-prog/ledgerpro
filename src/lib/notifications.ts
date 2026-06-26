/**
 * Notification trigger helpers.
 * Call these from API routes after key events.
 */
import { db } from '@/lib/db';
import { NotificationType } from '@prisma/client';

interface CreateNotificationParams {
  companyId: string;
  userId?: string;
  type: NotificationType;
  title: string;
  body: string;
  actionUrl?: string;
}

/**
 * Create a notification. If userId is omitted, sends to all company members.
 */
export async function createNotification(params: CreateNotificationParams) {
  try {
    if (params.userId) {
      await db.notification.create({
        data: {
          userId: params.userId,
          companyId: params.companyId,
          type: params.type,
          title: params.title,
          body: params.body,
          actionUrl: params.actionUrl || null,
        },
      });
    } else {
      // Send to all members of the company
      const members = await db.membership.findMany({
        where: { companyId: params.companyId },
        select: { userId: true },
      });
      if (members.length > 0) {
        await db.notification.createMany({
          data: members.map((m) => ({
            userId: m.userId,
            companyId: params.companyId,
            type: params.type,
            title: params.title,
            body: params.body,
            actionUrl: params.actionUrl || null,
          })),
        });
      }
    }
  } catch (e) {
    console.error('[notifications] Failed to create:', params.type, e);
  }
}

// ─── Convenience triggers ───

export async function notifyInvoiceOverdue(companyId: string, invoiceId: string, customerName: string) {
  await createNotification({
    companyId,
    type: 'invoice_overdue',
    title: 'Invoice Overdue',
    body: `${invoiceId} from ${customerName} is overdue.`,
    actionUrl: `/invoices/${invoiceId}`,
  });
}

export async function notifyBillDue(companyId: string, billId: string, vendorName: string) {
  await createNotification({
    companyId,
    type: 'bill_due',
    title: 'Bill Due Soon',
    body: `${billId} to ${vendorName} is due.`,
    actionUrl: `/expenses/${billId}`,
  });
}

export async function notifyImportComplete(companyId: string, accountName: string, count: number, batchId: string) {
  await createNotification({
    companyId,
    type: 'import_complete',
    title: 'Import Complete',
    body: `${count} transactions imported into ${accountName}.`,
    actionUrl: `/banking`,
  });
}

export async function notifyTransferDetected(companyId: string, amount: number) {
  await createNotification({
    companyId,
    type: 'transfer_detected',
    title: 'Possible Transfer Detected',
    body: `A potential transfer of ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)} was detected.`,
    actionUrl: '/banking',
  });
}

export async function notifyMemberJoined(companyId: string, memberName: string, role: string) {
  await createNotification({
    companyId,
    type: 'member_joined',
    title: 'Team Member Added',
    body: `${memberName} joined as ${role}.`,
    actionUrl: '/settings/team',
  });
}

export async function notifyReconciliationNeeded(companyId: string, accountName: string) {
  await createNotification({
    companyId,
    type: 'reconciliation_needed',
    title: 'Reconciliation Needed',
    body: `${accountName} has unreconciled transactions.`,
    actionUrl: '/banking',
  });
}

export async function notifySubscriptionExpiring(companyId: string, planName: string, daysLeft: number) {
  await createNotification({
    companyId,
    type: 'subscription_expiring',
    title: 'Trial Ending Soon',
    body: `Your ${planName} trial ends in ${daysLeft} days.`,
    actionUrl: '/settings/billing',
  });
}
