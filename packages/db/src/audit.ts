import { prisma } from './client.js';

export type AuditAction =
  | 'user.login'
  | 'user.logout'
  | 'user.signup'
  | 'user.password_reset'
  | 'tenant.created'
  | 'tenant.updated'
  | 'tenant.suspended'
  | 'tenant.activated'
  | 'member.invited'
  | 'member.role_changed'
  | 'member.removed'
  | 'whatsapp.connected'
  | 'whatsapp.disconnected'
  | 'whatsapp.reconnect_requested'
  | 'whatsapp.logout'
  | 'group.monitoring_enabled'
  | 'group.monitoring_disabled'
  | 'automation.created'
  | 'automation.updated'
  | 'automation.activated'
  | 'automation.paused'
  | 'automation.deleted'
  | 'automation.duplicated'
  | 'automation.run_triggered'
  | 'record.edited'
  | 'record.deleted'
  | 'record.approved'
  | 'record.rejected'
  | 'record.reprocessed'
  | 'message.reprocessed'
  | 'output.created'
  | 'output.updated'
  | 'output.deleted'
  | 'output.synced'
  | 'output.paused'
  | 'output.resumed'
  | 'output.version_restored'
  | 'output.conflict_resolved'
  | 'integration.connected'
  | 'integration.disconnected'
  | 'export.generated'
  | 'settings.changed'
  | 'apikey.created'
  | 'apikey.revoked';

export interface AuditEntry {
  tenantId: string;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Write an audit entry. Deliberately swallows its own errors: an audit write
 * failing must never break the user action that triggered it, but it must be
 * loud in the logs.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: (entry.before ?? undefined) as never,
        after: (entry.after ?? undefined) as never,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'audit',
        msg: 'Failed to write audit log',
        action: entry.action,
        tenantId: entry.tenantId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
