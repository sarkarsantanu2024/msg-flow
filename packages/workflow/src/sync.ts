import { getConnector, isFileOutput, mapRecordToTarget, buildRowKey, keyFieldsOf } from '@msgflow/connectors';
import { prisma, decryptJson } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { createLogger, describeError } from '@msgflow/logger';
import { AppError } from '@msgflow/types';
import type { MappingSpec, SyncContext, SyncOutcome, SyncRow } from '@msgflow/types';

const log = createLogger('workflow:sync');

/**
 * Output synchronization.
 *
 * This is where "maintain an existing business output" actually happens. Three
 * things make it work against a 15,000-row file that already exists:
 *
 *  1. OutputSyncRecord remembers which external row each record owns, so an
 *     update is a direct write rather than a full-sheet scan.
 *  2. syncVersion vs. record.version skips records that have not changed since
 *     the last successful write — most runs touch very few rows.
 *  3. A checksum comparison before writing refuses to clobber a file that a
 *     human edited since we last saw it.
 */

export interface SyncTargetOptions {
  tenantId: string;
  outputTargetId: string;
  runId?: string | null;
  /** Restrict to specific records (real-time path); otherwise all eligible. */
  recordIds?: string[];
  /** Restrict by record update time (scheduled path). */
  from?: Date | null;
  to?: Date | null;
  dryRun?: boolean;
  /** Ignore syncVersion and re-write everything. */
  force?: boolean;
  startedBy?: string | null;
}

export interface SyncTargetResult {
  outputId: string;
  outputName: string;
  status: SyncOutcome['status'];
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  warnings: string[];
  error?: string;
  versionCreated?: number;
}

export async function syncOutputTarget(options: SyncTargetOptions): Promise<SyncTargetResult> {
  const target = await prisma.outputTarget.findFirst({
    where: { id: options.outputTargetId, tenantId: options.tenantId },
    include: {
      output: { include: { integration: { include: { credentials: true } } } },
      mappings: { orderBy: { order: 'asc' } },
      automation: { include: { schema: { include: { fields: true } } } },
    },
  });

  if (!target) {
    throw new AppError('NOT_FOUND', 'Output target not found.');
  }

  const output = target.output;

  if (output.status === 'PAUSED') {
    return {
      outputId: output.id,
      outputName: output.name,
      status: 'SUCCESS',
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      warnings: ['This output is paused; nothing was synchronized.'],
    };
  }

  const mappings: MappingSpec[] = target.mappings.map((m) => ({
    sourceField: m.sourceField,
    targetField: m.targetField,
    targetColumn: m.targetColumn,
    updateStrategy: m.updateStrategy,
    transform: (m.transform ?? {}) as Record<string, unknown>,
    defaultValue: m.defaultValue,
    isKeyPart: m.isKeyPart,
    keyOrder: m.keyOrder,
  }));

  if (mappings.length === 0) {
    throw new AppError('VALIDATION_FAILED', `Output "${output.name}" has no field mapping configured.`);
  }

  // Select the records to synchronize.
  const where: Prisma.ExtractedRecordWhereInput = {
    tenantId: options.tenantId,
    schemaId: target.automation.schemaId,
    // Records awaiting human review must never reach a customer's file.
    status: { in: ['VALIDATED', 'APPROVED'] },
  };
  if (options.recordIds && options.recordIds.length > 0) {
    where.id = { in: options.recordIds };
  }
  if (options.from || options.to) {
    where.updatedAt = {
      ...(options.from ? { gte: options.from } : {}),
      ...(options.to ? { lt: options.to } : {}),
    };
  }

  const records = await prisma.extractedRecord.findMany({
    where,
    orderBy: { lastEventAt: 'asc' },
    take: 5_000,
    include: {
      syncRecords: { where: { outputId: output.id } },
    },
  });

  const keyMappings = keyFieldsOf(mappings);

  const rows: SyncRow[] = [];
  let preSkipped = 0;

  for (const record of records) {
    const sync = record.syncRecords[0];

    // Nothing changed since the last successful write to this output.
    if (!options.force && sync && sync.syncStatus === 'SYNCED' && sync.syncVersion >= record.version) {
      preSkipped++;
      continue;
    }

    const values = mapRecordToTarget(record.data as Record<string, unknown>, mappings);
    rows.push({
      recordId: record.id,
      keyValue: keyMappings.length > 0 ? buildRowKey(values, keyMappings) : record.naturalKey,
      values,
      externalRowId: sync?.externalRowId ?? null,
      version: record.version,
      updatedAt: record.updatedAt,
    });
  }

  if (rows.length === 0) {
    await prisma.output.update({
      where: { id: output.id },
      data: { lastSyncAt: new Date(), lastSyncStatus: 'SUCCESS', lastError: null },
    });
    return {
      outputId: output.id,
      outputName: output.name,
      status: 'SUCCESS',
      created: 0,
      updated: 0,
      skipped: preSkipped,
      failed: 0,
      warnings: preSkipped > 0 ? [`${preSkipped} record(s) were already up to date.`] : ['No records to synchronize.'],
    };
  }

  // Decrypt credentials only at the point of use.
  let credentials: Record<string, unknown> | undefined;
  const credentialRow = output.integration?.credentials?.[0];
  if (credentialRow) {
    try {
      credentials = decryptJson<Record<string, unknown>>(credentialRow.encryptedPayload);
      credentials.type = credentialRow.type;
    } catch (err) {
      log.error('Failed to decrypt integration credential', {
        integrationId: output.integrationId,
        ...describeError(err),
      });
      throw new AppError(
        'INTEGRATION_NOT_CONFIGURED',
        'The stored credential for this integration could not be decrypted. Reconnect the integration.',
      );
    }
  }

  const config = {
    ...((output.config ?? {}) as Record<string, unknown>),
    ...((target.config ?? {}) as Record<string, unknown>),
  };

  const context: SyncContext = {
    tenantId: options.tenantId,
    outputId: output.id,
    operation: target.operation,
    mappings,
    config,
    credentials,
    lastKnownChecksum: output.lastKnownChecksum,
    dryRun: options.dryRun,
  };

  const connector = getConnector(output.type);

  await prisma.output.update({ where: { id: output.id }, data: { status: 'SYNCING' } });

  let outcome: SyncOutcome;
  try {
    outcome = await connector.sync(rows, context);
  } catch (err) {
    const detail = describeError(err);
    log.error('Output sync failed', { outputId: output.id, ...detail });
    await prisma.output.update({
      where: { id: output.id },
      data: {
        status: 'FAILED',
        lastSyncAt: new Date(),
        lastSyncStatus: 'FAILED',
        lastError: detail.message.slice(0, 500),
      },
    });
    throw err;
  }

  if (outcome.status === 'CONFLICT') {
    await prisma.$transaction([
      prisma.outputConflict.create({
        data: {
          tenantId: options.tenantId,
          outputId: output.id,
          expectedChecksum: outcome.conflict?.expectedChecksum ?? null,
          actualChecksum: outcome.conflict?.actualChecksum ?? null,
          expectedVersion: output.currentVersion,
          detail: (outcome.conflict?.detail ?? {}) as Prisma.InputJsonValue,
        },
      }),
      prisma.output.update({
        where: { id: output.id },
        data: {
          status: 'CONFLICT',
          lastSyncAt: new Date(),
          lastSyncStatus: 'FAILED',
          lastError: outcome.error ?? 'Sync conflict',
        },
      }),
      prisma.notification.create({
        data: {
          tenantId: options.tenantId,
          severity: 'WARNING',
          code: 'SYNC_CONFLICT',
          title: `"${output.name}" has changed since the last sync`,
          body: 'MsgFlow did not write to the file to avoid overwriting your changes. Review the differences to continue.',
          link: `/dashboard/outputs/${output.id}`,
        },
      }),
    ]);

    return {
      outputId: output.id,
      outputName: output.name,
      status: 'CONFLICT',
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      warnings: outcome.warnings,
      error: outcome.error,
    };
  }

  // Persist per-record sync state.
  if (!options.dryRun) {
    for (const rowOutcome of outcome.rows) {
      const row = rows.find((r) => r.recordId === rowOutcome.recordId);
      const succeeded = rowOutcome.action !== 'failed';
      await prisma.outputSyncRecord.upsert({
        where: { outputId_recordId: { outputId: output.id, recordId: rowOutcome.recordId } },
        create: {
          tenantId: options.tenantId,
          outputId: output.id,
          recordId: rowOutcome.recordId,
          externalRowId: rowOutcome.externalRowId ?? null,
          externalRecordId: rowOutcome.externalRecordId ?? null,
          syncStatus: succeeded ? 'SYNCED' : 'FAILED',
          syncVersion: succeeded ? (row?.version ?? 0) : 0,
          lastSyncedAt: succeeded ? new Date() : null,
          errorMessage: rowOutcome.error ?? null,
          attempts: 1,
        },
        update: {
          externalRowId: rowOutcome.externalRowId ?? undefined,
          externalRecordId: rowOutcome.externalRecordId ?? undefined,
          syncStatus: succeeded ? 'SYNCED' : 'FAILED',
          syncVersion: succeeded ? (row?.version ?? 0) : undefined,
          lastSyncedAt: succeeded ? new Date() : undefined,
          errorMessage: rowOutcome.error ?? null,
          attempts: { increment: 1 },
        },
      });
    }
  }

  // Version snapshot for file outputs, so every write is recoverable.
  let versionCreated: number | undefined;
  if (!options.dryRun && isFileOutput(output.type) && outcome.storageRef && outcome.checksum) {
    const nextVersion = output.currentVersion + 1;
    await prisma.outputVersion.create({
      data: {
        tenantId: options.tenantId,
        outputId: output.id,
        version: nextVersion,
        storageRef: outcome.storageRef,
        checksum: outcome.checksum,
        recordCount: outcome.recordCount ?? 0,
        sizeBytes: outcome.sizeBytes ?? 0,
        operation: target.operation,
        createdBy: options.startedBy ?? null,
      },
    });
    versionCreated = nextVersion;
  }

  if (!options.dryRun) {
    const nextConfig = { ...((output.config ?? {}) as Record<string, unknown>) };
    if (outcome.storageRef) nextConfig.storageRef = outcome.storageRef;

    await prisma.output.update({
      where: { id: output.id },
      data: {
        status: outcome.status === 'SUCCESS' ? 'ACTIVE' : outcome.status === 'FAILED' ? 'FAILED' : 'PARTIAL_SUCCESS',
        config: nextConfig as Prisma.InputJsonValue,
        currentVersion: versionCreated ?? output.currentVersion,
        recordCount: outcome.recordCount ?? output.recordCount,
        lastSyncAt: new Date(),
        lastSyncStatus: outcome.status,
        lastError: outcome.error ?? null,
        lastKnownChecksum: outcome.checksum ?? output.lastKnownChecksum,
        lastKnownModifiedAt: outcome.checksum ? new Date() : output.lastKnownModifiedAt,
      },
    });
  }

  log.info('Output target synced', {
    outputId: output.id,
    operation: target.operation,
    created: outcome.created,
    updated: outcome.updated,
    skipped: outcome.skipped + preSkipped,
    failed: outcome.failed,
  });

  return {
    outputId: output.id,
    outputName: output.name,
    status: outcome.status,
    created: outcome.created,
    updated: outcome.updated,
    skipped: outcome.skipped + preSkipped,
    failed: outcome.failed,
    warnings: outcome.warnings,
    error: outcome.error,
    versionCreated,
  };
}

/** Retry only the rows that previously failed against an output. */
export async function retryFailedRows(
  tenantId: string,
  outputId: string,
  startedBy?: string | null,
): Promise<SyncTargetResult[]> {
  const failed = await prisma.outputSyncRecord.findMany({
    where: { tenantId, outputId, syncStatus: 'FAILED' },
    select: { recordId: true },
    take: 1_000,
  });

  if (failed.length === 0) return [];

  const targets = await prisma.outputTarget.findMany({
    where: { tenantId, outputId, enabled: true },
    select: { id: true },
  });

  const results: SyncTargetResult[] = [];
  for (const target of targets) {
    results.push(
      await syncOutputTarget({
        tenantId,
        outputTargetId: target.id,
        recordIds: failed.map((f) => f.recordId),
        force: true,
        startedBy,
      }),
    );
  }
  return results;
}
