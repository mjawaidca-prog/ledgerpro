import { AppShell } from '@/components/shell/AppShell';
import { IntercompanySidebar } from '@/components/shell/IntercompanySidebar';
import { ErrorBoundary } from '@/components/shell/ErrorFallback';

export default function IntercompanyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <ErrorBoundary>
          <IntercompanySidebar />
        </ErrorBoundary>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, padding: 30 }}>
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
