import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma, recordAudit } from '@msgflow/db';
import { loginSchema } from '@msgflow/validation';
import { createLogger } from '@msgflow/logger';

const log = createLogger('auth');

/**
 * Authentication — email and password only.
 *
 * No social or Google sign-in: accounts are created directly in MsgFlow with a
 * username (email) and password the user chooses. Google credentials elsewhere
 * in the configuration exist solely for the optional Google Sheets *data*
 * connector and are never involved in signing in.
 *
 * JWT sessions rather than database sessions so that a page render does not
 * cost a session lookup; membership and role are still verified against the
 * database on every protected request (see lib/auth.ts).
 */

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      isSuperAdmin: boolean;
    };
  }
  interface User {
    id?: string;
    isSuperAdmin?: boolean;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 7,
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  trustHost: true,
  providers: [
    Credentials({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });

        // Compare against a dummy hash when the user does not exist so that a
        // missing account and a wrong password take the same time. Otherwise
        // response timing enumerates which emails are registered.
        const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
        const valid = await bcrypt.compare(password, hash);

        if (!user || !valid) {
          log.warn('Failed login attempt', { email });
          return null;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        const membership = await prisma.membership.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'asc' },
        });
        if (membership) {
          await recordAudit({
            tenantId: membership.tenantId,
            userId: user.id,
            action: 'user.login',
            entityType: 'User',
            entityId: user.id,
          });
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.isSuperAdmin,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id ?? token.sub;
        token.isSuperAdmin = user.isSuperAdmin ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      // Spread rather than replace: NextAuth intersects Session["user"] with
      // AdapterUser, which carries fields (emailVerified) we neither set nor use.
      session.user = {
        ...session.user,
        id: (token.sub as string) ?? '',
        email: (token.email as string) ?? '',
        name: (token.name as string) ?? null,
        isSuperAdmin: Boolean(token.isSuperAdmin),
      };
      return session;
    },
  },
});
