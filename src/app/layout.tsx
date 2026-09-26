import type { Metadata } from 'next';
import '@/styles/globals.css';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { SessionProvider } from '@/components/shell/SessionProvider';
import { LEDGERPRO_URL } from '@/lib/seo';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(LEDGERPRO_URL),
  title: {
    default: 'LedgerPro — Canadian Accounting Software for Small Business',
    template: '%s | LedgerPro',
  },
  description: 'Double-entry accounting for Canadian small businesses with invoicing, expenses, bank reconciliation, GST/HST/PST, and tax-ready reports.',
  applicationName: 'LedgerPro',
  authors: [{ name: 'Nexvar Lab Inc.', url: 'https://www.nexvarlab.online' }],
  creator: 'Nexvar Lab Inc.',
  publisher: 'Nexvar Lab Inc.',
  keywords: [
    'Canadian accounting software',
    'small business accounting software Canada',
    'double-entry bookkeeping software',
    'bank reconciliation software',
    'GST HST accounting software',
    'financial reporting software',
    'LedgerPro',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_CA',
    siteName: 'LedgerPro',
    title: 'LedgerPro — Canadian Accounting Software for Small Business',
    description: 'Invoicing, bank reconciliation, Canadian sales tax, and financial reporting in one double-entry accounting platform.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LedgerPro — Canadian Accounting Software for Small Business',
    description: 'Invoicing, bank reconciliation, Canadian sales tax, and financial reporting in one double-entry accounting platform.',
  },
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
