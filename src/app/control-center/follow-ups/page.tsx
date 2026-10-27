import { requirePlatformAdminPage } from '@/lib/platform/auth';
import { ControlCenterShell } from '@/components/control-center/ControlCenterShell';
import { FollowUpsClient } from '@/components/control-center/FollowUpsClient';
export const dynamic = 'force-dynamic';
export default async function FollowUpsPage() {
  await requirePlatformAdminPage();
  return <ControlCenterShell><FollowUpsClient /></ControlCenterShell>;
}
