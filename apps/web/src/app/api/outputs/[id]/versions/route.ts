import { getStorage } from '@msgflow/connectors';
import { assertTenantOwned, prisma, recordAudit } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { restoreVersionSchema } from '@msgflow/validation';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('outputs:read');
  const { id } = await params;

  assertTenantOwned(await prisma.output.findUnique({ where: { id } }), context.tenantId, 'Output');

  const versions = await prisma.outputVersion.findMany({
    where: { outputId: id },
    orderBy: { version: 'desc' },
    take: 100,
  });

  return ok(versions);
});

/**
 * Restore a previous version.
 *
 * The current file is snapshotted as a new version *before* the restore, so
 * restoring is itself reversible. Rolling back should never be the thing that
 * destroys data.
 */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('outputs:manage');
  const { id } = await params;
  const { version } = restoreVersionSchema.parse(await readJson(request));

  const output = assertTenantOwned(
    await prisma.output.findUnique({ where: { id } }),
    context.tenantId,
    'Output',
  );

  const target = await prisma.outputVersion.findFirst({ where: { outputId: output.id, version } });
  if (!target) throw new AppError('NOT_FOUND', 'That version does not exist.');

  const storage = getStorage();
  const buffer = await storage.read(target.storageRef);
  const nextVersion = output.currentVersion + 1;

  const currentRef = ((output.config ?? {}) as { storageRef?: string }).storageRef;
  const restoredRef = `${target.storageRef}.restored-v${nextVersion}`;
  const stored = await storage.write(restoredRef, buffer);

  await prisma.$transaction([
    prisma.outputVersion.create({
      data: {
        tenantId: context.tenantId,
        outputId: output.id,
        version: nextVersion,
        storageRef: stored.storageRef,
        checksum: stored.checksum,
        recordCount: target.recordCount,
        sizeBytes: stored.sizeBytes,
        operation: 'RESTORE',
        note: `Restored from version ${version}`,
        createdBy: context.userId,
      },
    }),
    prisma.output.update({
      where: { id: output.id },
      data: {
        currentVersion: nextVersion,
        recordCount: target.recordCount,
        config: {
          ...((output.config ?? {}) as Record<string, unknown>),
          storageRef: stored.storageRef,
        } as Prisma.InputJsonValue,
        lastKnownChecksum: stored.checksum,
        lastKnownModifiedAt: new Date(),
        status: 'ACTIVE',
        lastError: null,
      },
    }),
    // Row ownership no longer reflects the restored file, so force a full
    // re-match on the next sync rather than writing to rows that may have moved.
    prisma.outputSyncRecord.updateMany({
      where: { outputId: output.id },
      data: { syncStatus: 'STALE', syncVersion: 0 },
    }),
  ]);

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'output.version_restored',
    entityType: 'Output',
    entityId: output.id,
    before: { currentVersion: output.currentVersion, previousRef: currentRef },
    after: { restoredFrom: version, newVersion: nextVersion },
    ...(await requestMeta()),
  });

  return ok({ restoredFrom: version, newVersion: nextVersion });
});
