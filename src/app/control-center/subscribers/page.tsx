import { requirePlatformAdminPage } from '@/lib/platform/auth';
import { ControlCenterShell } from '@/components/control-center/ControlCenterShell';
import { SubscribersClient } from '@/components/control-center/SubscribersClient';
export const dynamic = 'force-dynamic';
export default async function SubscribersPage() {
  await requirePlatformAdminPage();
  return <ControlCenterShell><SubscribersClient /></ControlCenterShell>;
}
