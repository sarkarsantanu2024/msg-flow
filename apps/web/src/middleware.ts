import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware: a cheap gate, not the security boundary.
 *
 * It only checks whether a session cookie is present, because the Edge runtime
 * cannot run bcrypt or Prisma. Real enforcement — session validity, tenant
 * membership, role — happens in `requireAuth()` / `requireTenant()` on every
 * protected page and API route. Treating this file as the authorization layer
 * would be a mistake; its job is to avoid rendering a dashboard shell for
 * someone who obviously is not signed in.
 */

const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

const PUBLIC_PATHS = ['/', '/login', '/signup', '/forgot-password', '/reset-password'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const isProtected = pathname.startsWith('/dashboard') || pathname.startsWith('/admin');

  if (isProtected && !hasSession) {
    const url = new URL('/login', request.url);
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  void isPublic;
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, static assets and the auth API — the
     * auth routes must stay reachable while signed out.
     */
    '/((?!api/auth|api/worker|api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
