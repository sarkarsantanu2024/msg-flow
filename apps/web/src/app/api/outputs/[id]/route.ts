import { assertTenantOwned, prisma, recordAudit } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { updateOutputSchema } from '@msgflow/validation';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('outputs:read');
  const { id } = await params;

  const output = assertTenantOwned(
    await prisma.output.findUnique({
      where: { id },
      include: {
        targets: { include: { automation: true, mappings: { orderBy: { order: 'asc' } } } },
        versions: { orderBy: { version: 'desc' }, take: 25 },
        conflicts: { where: { resolution: 'PENDING' } },
        integration: { select: { id: true, name: true, type: true, status: true } },
      },
    }),
    context.tenantId,
    'Output',
  );

  return ok(output);
});

export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('outputs:manage');
  const { id } = await params;
  const input = updateOutputSchema.parse(await readJson(request));

  const output = assertTenantOwned(
    await prisma.output.findUnique({ where: { id } }),
    context.tenantId,
    'Output',
  );

  const updated = await prisma.output.update({
    where: { id: output.id },
    data: {
      name: input.name,
      status: input.status,
      allowDelete: input.allowDelete,
      // Merge rather than replace: the connector writes storageRef and other
      // runtime state into config, and a partial edit must not erase it.
      config: input.config
        ? ({ ...((output.config ?? {}) as Record<string, unknown>), ...input.config } as Prisma.InputJsonValue)
        : undefined,
      integrationId: input.integrationId,
    },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: input.status === 'PAUSED' ? 'output.paused' : input.status === 'ACTIVE' ? 'output.resumed' : 'output.updated',
    entityType: 'Output',
    entityId: output.id,
    before: { name: output.name, status: output.status },
    after: { name: updated.name, status: updated.status },
    ...(await requestMeta()),
  });

  return ok(updated);
});

export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('outputs:manage');
  const { id } = await params;

  const output = assertTenantOwned(
    await prisma.output.findUnique({ where: { id } }),
    context.tenantId,
    'Output',
  );

  // Rows in the customer's actual file are untouched — deleting the output only
  // stops MsgFlow maintaining it. Stored versions go with it.
  await prisma.output.delete({ where: { id: output.id } });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'output.deleted',
    entityType: 'Output',
    entityId: output.id,
    before: { name: output.name, type: output.type },
    ...(await requestMeta()),
  });

  return ok({ deleted: true });
});
