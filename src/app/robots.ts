import type { MetadataRoute } from 'next';
import { LEDGERPRO_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/dashboard',
        '/accountant',
        '/banking',
        '/budgets',
        '/chart-of-accounts',
        '/contacts',
        '/expenses',
        '/invoices',
        '/intercompany',
        '/journal',
        '/notifications',
        '/onboarding',
        '/pay/',
        '/recurring',
        '/reports',
        '/settings',
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
      ],
    },
    sitemap: `${LEDGERPRO_URL}/sitemap.xml`,
    host: LEDGERPRO_URL,
  };
}
