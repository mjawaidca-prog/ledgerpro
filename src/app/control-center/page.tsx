import { requirePlatformAdminPage, platformAudit } from '@/lib/platform/auth';
import { ControlCenterShell } from '@/components/control-center/ControlCenterShell';
import { OverviewClient } from '@/components/control-center/OverviewClient';
export const dynamic = 'force-dynamic';
export default async function ControlCenterPage() {
  const ctx = await requirePlatformAdminPage();
  await platformAudit({ adminUserId: ctx.userId, action: 'control_center.enter', targetType: 'platform' });
  return <ControlCenterShell><OverviewClient /></ControlCenterShell>;
}
