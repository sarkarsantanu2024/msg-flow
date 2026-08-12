import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  getMembership,
  getUserMemberships,
  prisma,
  roleHasPermission,
  type Permission,
  type Role,
  type TenantMembershipInfo,
} from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { auth } from '@/auth';

/**
 * Centralised authorization.
 *
 * Every protected page and API route funnels through these. The invariant they
 * exist to hold: no query ever runs against tenant data without a tenantId that
 * has been proven to belong to the signed-in user on *this* request. Membership
 * is re-read from the database rather than trusted from the JWT, so revoking a
 * member takes effect immediately instead of when their token expires.
 */

export const TENANT_COOKIE = 'mf_tenant';

export interface AuthContext {
  userId: string;
  email: string;
  name: string | null;
  isSuperAdmin: boolean;
}

export interface TenantContext extends AuthContext {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  timezone: string;
  role: Role;
  memberships: TenantMembershipInfo[];
}

/** Signed-in user, or null. */
export async function getAuth(): Promise<AuthContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    isSuperAdmin: session.user.isSuperAdmin,
  };
}

/** Signed-in user or redirect to login (for pages). */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuth();
  if (!context) redirect('/login');
  return context;
}

/** Signed-in user or throw 401 (for API routes). */
export async function requireAuthApi(): Promise<AuthContext> {
  const context = await getAuth();
  if (!context) throw new AppError('UNAUTHENTICATED', 'You must be signed in.');
  return context;
}

async function resolveTenant(userId: string): Promise<TenantContext | null> {
  const memberships = await getUserMemberships(userId);
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const requested = cookieStore.get(TENANT_COOKIE)?.value;

  // The cookie is a *preference*, never an authorization. It is only honoured
  // when the user genuinely holds a membership in that tenant.
  const selected =
    (requested ? memberships.find((m) => m.tenantId === requested) : undefined) ?? memberships[0];

  const membership = await getMembership(userId, selected.tenantId);
  if (!membership) return null;

  return {
    userId,
    email: '',
    name: null,
    isSuperAdmin: false,
    tenantId: membership.tenantId,
    tenantName: membership.tenantName,
    tenantSlug: membership.tenantSlug,
    tenantStatus: membership.tenantStatus,
    timezone: membership.timezone,
    role: membership.role,
    memberships,
  };
}

/** Tenant context for pages. Redirects when unauthenticated or tenant-less. */
export async function requireTenant(): Promise<TenantContext> {
  const authContext = await requireAuth();
  const tenant = await resolveTenant(authContext.userId);
  if (!tenant) redirect('/onboarding');

  if (tenant.tenantStatus === 'SUSPENDED') redirect('/suspended');

  return { ...tenant, ...authContext };
}

/** Tenant context for API routes. Throws instead of redirecting. */
export async function requireTenantApi(): Promise<TenantContext> {
  const authContext = await requireAuthApi();
  const tenant = await resolveTenant(authContext.userId);
  if (!tenant) throw new AppError('FORBIDDEN', 'You do not belong to any workspace.');
  if (tenant.tenantStatus === 'SUSPENDED') {
    throw new AppError('FORBIDDEN', 'This workspace is suspended. Contact support.');
  }
  return { ...tenant, ...authContext };
}

/** Require a minimum role within the active tenant. */
export async function requireRole(minimum: Role): Promise<TenantContext> {
  const context = await requireTenantApi();
  const rank: Record<Role, number> = { VIEWER: 1, OPERATOR: 2, ADMIN: 3, OWNER: 4 };
  if (rank[context.role] < rank[minimum]) {
    throw new AppError('FORBIDDEN', `This action requires the ${minimum.toLowerCase()} role or higher.`);
  }
  return context;
}

/** Require a specific permission within the active tenant. */
export async function requirePermission(permission: Permission): Promise<TenantContext> {
  const context = await requireTenantApi();
  if (!roleHasPermission(context.role, permission)) {
    throw new AppError('FORBIDDEN', 'You do not have permission to do that.');
  }
  return context;
}

/** Platform super-admin gate for /admin. */
export async function requireSuperAdmin(): Promise<AuthContext> {
  const context = await requireAuth();
  if (!context.isSuperAdmin) redirect('/dashboard');
  return context;
}

export async function requireSuperAdminApi(): Promise<AuthContext> {
  const context = await requireAuthApi();
  if (!context.isSuperAdmin) {
    throw new AppError('FORBIDDEN', 'Platform administrator access is required.');
  }
  return context;
}

/**
 * Authenticate a machine caller by API key.
 * Used by the public API surface; separate from the interactive session path.
 */
export async function authenticateApiKey(rawKey: string): Promise<{ tenantId: string; scopes: string[] } | null> {
  const { sha256 } = await import('@msgflow/db');
  const keyHash = sha256(rawKey);
  const key = await prisma.apiKey.findUnique({ where: { keyHash } });

  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) return null;

  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return { tenantId: key.tenantId, scopes: key.scopes };
}

/** Client IP and user agent, for audit entries. */
export async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  return {
    ipAddress: forwarded ? forwarded.split(',')[0].trim() : headerList.get('x-real-ip'),
    userAgent: headerList.get('user-agent'),
  };
}
