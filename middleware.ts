import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Allow public routes
    if (
      pathname === '/login' ||
      pathname === '/register' ||
      pathname === '/onboarding' ||
      pathname.startsWith('/register/verify') ||
      pathname.startsWith('/api/auth')
    ) {
      return NextResponse.next();
    }

    // API routes: inject companyId + userId headers for tenant isolation
    if (pathname.startsWith('/api/')) {
      const requestHeaders = new Headers(req.headers);

      // Priority 1: cookie (set by company switch)
      const cookieCompanyId = req.cookies.get('lp-active-company-id')?.value;

      // Priority 2: JWT token
      const jwtCompanyId = (token as any)?.activeCompanyId || (token as any)?.companyId;

      const effectiveCompanyId = cookieCompanyId || jwtCompanyId;

      if (effectiveCompanyId) {
        requestHeaders.set('x-company-id', effectiveCompanyId as string);
      }
      if (token?.id || (token as any)?.sub) {
        requestHeaders.set('x-user-id', (token?.id || (token as any)?.sub) as string);
      }

      return NextResponse.next({
        request: { headers: requestHeaders },
      });
    }

    // For page routes: if there's a cookie with a different company, pass it through
    // but still let the page render (it will read from cookie/session client-side)
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;
        // Allow public paths without authentication
        if (
          pathname === '/login' ||
          pathname === '/register' ||
          pathname === '/onboarding' ||
          pathname.startsWith('/register/verify') ||
          pathname.startsWith('/api/auth')
        ) {
          return true;
        }
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
