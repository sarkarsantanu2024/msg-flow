import { operationSupported } from '@msgflow/connectors';
import { prisma, recordAudit } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { createOutputSchema } from '@msgflow/validation';
import { created, ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async () => {
  const context = await requirePermission('outputs:read');

  const outputs = await prisma.output.findMany({
    where: { tenantId: context.tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      targets: {
        include: {
          automation: { select: { id: true, name: true, status: true } },
          mappings: true,
        },
      },
      _count: { select: { versions: true, syncRecords: true, conflicts: true } },
    },
  });

  return ok(outputs);
});

export const POST = route(async (request: Request) => {
  const context = await requirePermission('outputs:manage');
  const input = createOutputSchema.parse(await readJson(request));

  const output = await prisma.output.create({
    data: {
      tenantId: context.tenantId,
      name: input.name,
      type: input.type,
      config: input.config as Prisma.InputJsonValue,
      integrationId: input.integrationId ?? null,
      allowDelete: input.allowDelete,
      status: 'ACTIVE',
      createdBy: context.userId,
    },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'output.created',
    entityType: 'Output',
    entityId: output.id,
    after: { name: output.name, type: output.type },
    ...(await requestMeta()),
  });

  return created({
    ...output,
    supportedOperations: [
      'CREATE_NEW',
      'APPEND',
      'UPDATE_EXISTING',
      'UPSERT',
      'REPLACE',
      'GENERATE_NEW_VERSION',
    ].filter((op) => operationSupported(output.type, op)),
  });
});
