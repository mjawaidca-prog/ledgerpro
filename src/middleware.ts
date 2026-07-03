import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

// Public marketing site — reachable without signing in.
const PUBLIC_MARKETING_PATHS = ['/home', '/features', '/pricing', '/faq', '/about', '/privacy', '/terms'];

function isPublicPath(pathname: string) {
  return (
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/onboarding' ||
    pathname.startsWith('/register/verify') ||
    pathname.startsWith('/api/auth') ||
    PUBLIC_MARKETING_PATHS.includes(pathname)
  );
}

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // The bare root is the signed-in dashboard, but a logged-out visitor
    // landing there should see the public marketing homepage, not a login
    // wall — that's the whole point of having one.
    if (pathname === '/' && !token) {
      return NextResponse.redirect(new URL('/home', req.url));
    }

    // Allow public routes
    if (isPublicPath(pathname)) {
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
        // '/' is handled inside the middleware function above (redirect to
        // /home when logged out, render the dashboard when logged in) —
        // authorize it unconditionally here so next-auth doesn't short
        // -circuit straight to /login before that logic runs.
        if (pathname === '/') return true;
        // Allow public paths without authentication
        if (isPublicPath(pathname)) {
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
