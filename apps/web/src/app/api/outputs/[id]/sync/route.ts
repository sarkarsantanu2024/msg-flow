import { assertTenantOwned, prisma, recordAudit } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { syncNowSchema } from '@msgflow/validation';
import { runAutomation, syncOutputTarget } from '@msgflow/workflow';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * SYNC NOW.
 *
 * Runs the full pipeline for every automation feeding this output: resolve the
 * configured date range → find messages → extract → validate → update the
 * output → report exactly what happened. The returned summary is the one the
 * UI shows (processed / created / updated / skipped / failed).
 */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('outputs:sync');
  const { id } = await params;

  const body = await readJson(request).catch(() => ({}));
  const input = syncNowSchema.parse(body ?? {});

  const output = assertTenantOwned(
    await prisma.output.findUnique({
      where: { id },
      include: { targets: { where: { enabled: true }, include: { automation: true } } },
    }),
    context.tenantId,
    'Output',
  );

  if (output.targets.length === 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      'This output is not connected to any automation yet, so there is nothing to synchronize.',
    );
  }

  const pendingConflict = await prisma.outputConflict.findFirst({
    where: { outputId: output.id, resolution: 'PENDING' },
  });
  if (pendingConflict && !input.dryRun) {
    throw new AppError(
      'SYNC_CONFLICT',
      'This output has an unresolved conflict. Review the differences before synchronizing again.',
    );
  }

  const summary = {
    messagesProcessed: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    recordsFailed: 0,
    rowsCreated: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    rowsFailed: 0,
    warnings: [] as string[],
    errors: [] as string[],
    status: 'SUCCESS' as 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'CONFLICT',
  };

  for (const target of output.targets) {
    // Run the whole automation when it can process messages, so Sync Now really
    // does "find messages → extract → update", not merely "re-push what exists".
    if (target.automation.status !== 'ARCHIVED') {
      const run = await runAutomation({
        tenantId: context.tenantId,
        automationId: target.automationId,
        trigger: 'SYNC_NOW',
        startedBy: context.userId,
        from: input.from ? new Date(input.from) : null,
        to: input.to ? new Date(input.to) : null,
        dryRun: input.dryRun,
      });

      summary.messagesProcessed += run.messagesProcessed;
      summary.recordsCreated += run.recordsCreated;
      summary.recordsUpdated += run.recordsUpdated;
      summary.recordsSkipped += run.recordsSkipped;
      summary.recordsFailed += run.recordsFailed;
      summary.errors.push(...run.errors);

      for (const outputResult of run.outputs) {
        summary.rowsCreated += outputResult.created;
        summary.rowsUpdated += outputResult.updated;
        summary.rowsSkipped += outputResult.skipped;
        summary.rowsFailed += outputResult.failed;
        summary.warnings.push(...outputResult.warnings);
        if (outputResult.status === 'CONFLICT') summary.status = 'CONFLICT';
      }
      continue;
    }

    const result = await syncOutputTarget({
      tenantId: context.tenantId,
      outputTargetId: target.id,
      dryRun: input.dryRun,
      startedBy: context.userId,
    });
    summary.rowsCreated += result.created;
    summary.rowsUpdated += result.updated;
    summary.rowsSkipped += result.skipped;
    summary.rowsFailed += result.failed;
    summary.warnings.push(...result.warnings);
    if (result.status === 'CONFLICT') summary.status = 'CONFLICT';
  }

  if (summary.status !== 'CONFLICT') {
    const failed = summary.rowsFailed > 0 || summary.recordsFailed > 0 || summary.errors.length > 0;
    const succeeded = summary.rowsCreated + summary.rowsUpdated > 0;
    summary.status = !failed ? 'SUCCESS' : succeeded ? 'PARTIAL_SUCCESS' : 'FAILED';
  }

  if (!input.dryRun) {
    await recordAudit({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'output.synced',
      entityType: 'Output',
      entityId: output.id,
      after: summary,
      ...(await requestMeta()),
    });
  }

  return ok(summary);
});
