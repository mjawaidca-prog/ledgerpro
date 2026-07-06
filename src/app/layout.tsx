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
  title: 'LedgerPro - Accounting Software for Canadian Small Businesses',
  description: 'Double-entry accounting for Canadian small businesses with invoicing, expenses, bank reconciliation, GST/HST/PST, and tax-ready reports.',
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
