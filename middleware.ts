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
      pathname.startsWith('/api/auth')
    ) {
      return NextResponse.next();
    }

    // API routes: inject companyId + userId headers for tenant isolation
    if (pathname.startsWith('/api/')) {
      const requestHeaders = new Headers(req.headers);
      // Support both old and new JWT formats
      const companyId = (token as any)?.activeCompanyId || (token as any)?.companyId;
      if (companyId) {
        requestHeaders.set('x-company-id', companyId as string);
      }
      if (token?.id || (token as any)?.sub) {
        requestHeaders.set('x-user-id', (token?.id || (token as any)?.sub) as string);
      }

      return NextResponse.next({
        request: { headers: requestHeaders },
      });
    }

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
