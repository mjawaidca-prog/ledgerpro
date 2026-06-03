import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { TRPCProvider } from '@/components/providers/TRPCProvider'
import { ThemeProvider } from '@/components/providers/ThemeProvider'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'LedgerPro — Dashboard',
  description: 'Accounting SaaS for growing businesses',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      data-density="comfortable"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <TRPCProvider>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </TRPCProvider>
      </body>
    </html>
  )
}
