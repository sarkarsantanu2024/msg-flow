import { getConnector } from '@msgflow/connectors';
import { assertTenantOwned, prisma, recordAudit } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { resolveConflictSchema } from '@msgflow/validation';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Resolve a sync conflict.
 *
 * - USE_LATEST_FILE: accept the file as it now stands. We adopt its checksum
 *   and force a full re-match, because rows may have moved.
 * - KEEP_AUTOMATION_VERSION: our data wins; the next sync overwrites.
 * - IGNORED: dismiss without changing anything.
 *
 * There is deliberately no "merge automatically" option: silently reconciling
 * two versions of a customer's spreadsheet is exactly the kind of guess that
 * loses data invisibly.
 */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('outputs:manage');
  const { id } = await params;
  const { resolution } = resolveConflictSchema.parse(await readJson(request));

  const output = assertTenantOwned(
    await prisma.output.findUnique({ where: { id } }),
    context.tenantId,
    'Output',
  );

  const conflict = await prisma.outputConflict.findFirst({
    where: { outputId: output.id, resolution: 'PENDING' },
    orderBy: { detectedAt: 'desc' },
  });
  if (!conflict) throw new AppError('NOT_FOUND', 'There is no unresolved conflict for this output.');

  if (resolution === 'USE_LATEST_FILE') {
    const connector = getConnector(output.type);
    const fingerprint = connector.fingerprint
      ? await connector.fingerprint({
          tenantId: context.tenantId,
          outputId: output.id,
          operation: 'UPSERT',
          mappings: [],
          config: (output.config ?? {}) as Record<string, unknown>,
        })
      : { checksum: conflict.actualChecksum, modifiedAt: new Date() };

    await prisma.$transaction([
      prisma.output.update({
        where: { id: output.id },
        data: {
          lastKnownChecksum: fingerprint.checksum ?? conflict.actualChecksum,
          lastKnownModifiedAt: fingerprint.modifiedAt ?? new Date(),
          status: 'ACTIVE',
          lastError: null,
        },
      }),
      prisma.outputSyncRecord.updateMany({
        where: { outputId: output.id },
        data: { syncStatus: 'STALE', syncVersion: 0, externalRowId: null },
      }),
    ]);
  } else if (resolution === 'KEEP_AUTOMATION_VERSION') {
    await prisma.$transaction([
      prisma.output.update({
        where: { id: output.id },
        data: {
          // Clearing the known checksum disarms the guard for exactly one sync,
          // which is what "my data wins" means.
          lastKnownChecksum: null,
          status: 'ACTIVE',
          lastError: null,
        },
      }),
      prisma.outputSyncRecord.updateMany({
        where: { outputId: output.id },
        data: { syncStatus: 'STALE', syncVersion: 0 },
      }),
    ]);
  } else {
    await prisma.output.update({ where: { id: output.id }, data: { status: 'PAUSED' } });
  }

  await prisma.outputConflict.update({
    where: { id: conflict.id },
    data: { resolution, resolvedAt: new Date(), resolvedBy: context.userId },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'output.conflict_resolved',
    entityType: 'Output',
    entityId: output.id,
    after: { resolution },
    ...(await requestMeta()),
  });

  return ok({ resolution });
});
