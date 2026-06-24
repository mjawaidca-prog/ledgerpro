import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;

    // Allow auth routes
    if (pathname.startsWith('/api/auth') || pathname === '/login') {
      return NextResponse.next();
    }

    // API routes: inject companyId header for tenant isolation
    if (pathname.startsWith('/api/')) {
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set('x-company-id', req.nextauth.token?.companyId as string);

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
        // Allow public paths
        if (pathname === '/login' || pathname.startsWith('/api/auth')) {
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
