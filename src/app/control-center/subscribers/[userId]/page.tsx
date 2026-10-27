import { requirePlatformAdminPage } from '@/lib/platform/auth';
import { ControlCenterShell } from '@/components/control-center/ControlCenterShell';
import { SubscriberDetailClient } from '@/components/control-center/SubscriberDetailClient';
export const dynamic = 'force-dynamic';
export default async function SubscriberDetailPage({ params }: { params: { userId: string } }) {
  await requirePlatformAdminPage();
  return <ControlCenterShell><SubscriberDetailClient userId={params.userId} /></ControlCenterShell>;
}
