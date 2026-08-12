import { prisma } from './client.js';
import type { Role } from '@prisma/client';

/**
 * Tenant isolation helpers.
 *
 * The rule this file exists to enforce: no query touches tenant data without a
 * tenantId. Route handlers call `requireTenant()` (apps/web/src/lib/auth) which
 * resolves the membership, and every repository call takes the resulting
 * tenantId explicitly. There is no implicit "current tenant" global, because a
 * global is exactly what leaks across requests under concurrency.
 */

export const ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  OPERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

export type Permission =
  | 'tenant:read'
  | 'tenant:manage'
  | 'members:manage'
  | 'messages:read'
  | 'messages:reprocess'
  | 'groups:manage'
  | 'automations:read'
  | 'automations:manage'
  | 'records:read'
  | 'records:edit'
  | 'records:delete'
  | 'records:review'
  | 'outputs:read'
  | 'outputs:manage'
  | 'outputs:sync'
  | 'integrations:manage'
  | 'whatsapp:read'
  | 'whatsapp:manage'
  | 'exports:create'
  | 'analytics:read'
  | 'audit:read'
  | 'billing:manage';

/** Minimum role required for each permission. */
const PERMISSION_MATRIX: Record<Permission, Role> = {
  'tenant:read': 'VIEWER',
  'tenant:manage': 'ADMIN',
  'members:manage': 'ADMIN',
  'messages:read': 'VIEWER',
  'messages:reprocess': 'OPERATOR',
  'groups:manage': 'OPERATOR',
  'automations:read': 'VIEWER',
  'automations:manage': 'OPERATOR',
  'records:read': 'VIEWER',
  'records:edit': 'OPERATOR',
  'records:delete': 'ADMIN',
  'records:review': 'OPERATOR',
  'outputs:read': 'VIEWER',
  'outputs:manage': 'OPERATOR',
  'outputs:sync': 'OPERATOR',
  'integrations:manage': 'ADMIN',
  'whatsapp:read': 'VIEWER',
  'whatsapp:manage': 'OPERATOR',
  'exports:create': 'VIEWER',
  'analytics:read': 'VIEWER',
  'audit:read': 'ADMIN',
  'billing:manage': 'OWNER',
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[PERMISSION_MATRIX[permission]];
}

export function permissionsForRole(role: Role): Permission[] {
  return (Object.keys(PERMISSION_MATRIX) as Permission[]).filter((p) => roleHasPermission(role, p));
}

export interface TenantMembershipInfo {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  timezone: string;
  role: Role;
}

/** All tenants a user belongs to, for the tenant switcher. */
export async function getUserMemberships(userId: string): Promise<TenantMembershipInfo[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { tenant: true },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map((m) => ({
    tenantId: m.tenantId,
    tenantName: m.tenant.name,
    tenantSlug: m.tenant.slug,
    tenantStatus: m.tenant.status,
    timezone: m.tenant.timezone,
    role: m.role,
  }));
}

/**
 * Resolve a user's membership in a specific tenant. Returns null when the user
 * is not a member — callers must treat that as 404/403, never as "no filter".
 */
export async function getMembership(userId: string, tenantId: string): Promise<TenantMembershipInfo | null> {
  const membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    include: { tenant: true },
  });
  if (!membership) return null;
  return {
    tenantId: membership.tenantId,
    tenantName: membership.tenant.name,
    tenantSlug: membership.tenant.slug,
    tenantStatus: membership.tenant.status,
    timezone: membership.tenant.timezone,
    role: membership.role,
  };
}

/**
 * Assert that a resource belongs to the given tenant.
 *
 * Used on every by-id lookup. Fetching by id alone and trusting the id to be
 * unguessable is not isolation — this makes the check explicit and cheap.
 */
export function assertTenantOwned<T extends { tenantId: string } | null>(
  entity: T,
  tenantId: string,
  label = 'Resource',
): NonNullable<T> {
  if (!entity || entity.tenantId !== tenantId) {
    const err = new Error(`${label} not found`) as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return entity as NonNullable<T>;
}
