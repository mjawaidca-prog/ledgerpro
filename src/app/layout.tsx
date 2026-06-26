import type { Metadata } from 'next';
import '@/styles/globals.css';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { SessionProvider } from '@/components/shell/SessionProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Ledger Pro — NexVar Labs',
  description: 'Professional double-entry accounting for Canadian small businesses. Invoicing, expenses, bank reconciliation, and tax-ready reports.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
