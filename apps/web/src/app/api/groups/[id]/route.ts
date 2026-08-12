import { assertTenantOwned, prisma, recordAudit } from '@msgflow/db';
import { toggleGroupSchema } from '@msgflow/validation';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Enable or disable monitoring for a group. */
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('groups:manage');
  const { id } = await params;
  const { isMonitored } = toggleGroupSchema.parse(await readJson(request));

  const group = assertTenantOwned(
    await prisma.whatsAppGroup.findUnique({ where: { id } }),
    context.tenantId,
    'Group',
  );

  const updated = await prisma.whatsAppGroup.update({
    where: { id: group.id },
    data: { isMonitored, monitoredAt: isMonitored ? new Date() : null },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: isMonitored ? 'group.monitoring_enabled' : 'group.monitoring_disabled',
    entityType: 'WhatsAppGroup',
    entityId: group.id,
    before: { isMonitored: group.isMonitored },
    after: { isMonitored },
    ...(await requestMeta()),
  });

  return ok({ id: updated.id, isMonitored: updated.isMonitored });
});
