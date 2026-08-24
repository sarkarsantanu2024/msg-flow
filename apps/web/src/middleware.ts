import { NextResponse, type NextRequest } from 'next/server';
import { decode } from 'next-auth/jwt';

/**
 * Edge middleware: a cheap gate, not the security boundary.
 *
 * It only checks whether the session cookie decrypts, because the Edge runtime
 * cannot run bcrypt or Prisma. Real enforcement — session validity, tenant
 * membership, role — happens in `requireAuth()` / `requireTenant()` on every
 * protected page and API route. Treating this file as the authorization layer
 * would be a mistake; its job is to avoid rendering a dashboard shell for
 * someone who obviously is not signed in.
 *
 * Presence alone is not enough to go on. A cookie left behind by a previous
 * AUTH_SECRET still *exists*, so a presence check would bounce that browser
 * from /login to /dashboard, where the real check sends it back to /login —
 * a redirect loop no amount of retrying escapes. So the token is decoded here
 * and an undecryptable one is deleted, which lets the browser heal itself.
 */

const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

const PUBLIC_PATHS = ['/', '/login', '/signup', '/forgot-password', '/reset-password'];

/** Drop every session cookie variant so a dead session stops being resent. */
function clearSession(response: NextResponse): NextResponse {
  for (const name of SESSION_COOKIES) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const secret = process.env.AUTH_SECRET;
  const present = SESSION_COOKIES.filter((name) => request.cookies.has(name));

  // The salt is the cookie name the token was written under, so each candidate
  // is tried against its own name.
  let hasSession = false;
  for (const name of present) {
    if (!secret) break;
    try {
      const token = await decode({
        token: request.cookies.get(name)?.value,
        salt: name,
        secret,
      });
      if (token) {
        hasSession = true;
        break;
      }
    } catch {
      // Undecryptable — leave hasSession false and let the cleanup below run.
    }
  }

  const staleSession = present.length > 0 && !hasSession;
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const isProtected = pathname.startsWith('/dashboard') || pathname.startsWith('/admin');

  if (isProtected && !hasSession) {
    const url = new URL('/login', request.url);
    url.searchParams.set('callbackUrl', pathname);
    return clearSession(NextResponse.redirect(url));
  }

  if (hasSession && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  void isPublic;

  const response = NextResponse.next();
  return staleSession ? clearSession(response) : response;
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
