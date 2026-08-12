import { assertTenantOwned, prisma, recordAudit } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { reprocessMessageSchema } from '@msgflow/validation';
import { classifyMessage, extractFromMessage } from '@msgflow/workflow';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export const GET = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('messages:read');
  const { id } = await params;

  const message = assertTenantOwned(
    await prisma.message.findUnique({
      where: { id },
      include: {
        group: true,
        classification: true,
        recordSources: {
          include: {
            record: { include: { schema: { select: { name: true } }, syncRecords: { include: { output: true } } } },
          },
        },
      },
    }),
    context.tenantId,
    'Message',
  );

  return ok(message);
});

/**
 * Reprocess, ignore, or assign a message to an automation.
 *
 * Reprocessing is safe to repeat: message dedupe and the record natural key
 * make extraction idempotent, so a retry updates the existing record rather
 * than creating a duplicate.
 */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('messages:reprocess');
  const { id } = await params;
  const input = reprocessMessageSchema.parse(await readJson(request));

  const message = assertTenantOwned(
    await prisma.message.findUnique({ where: { id }, include: { group: true } }),
    context.tenantId,
    'Message',
  );

  if (input.action === 'ignore') {
    await prisma.message.update({ where: { id: message.id }, data: { status: 'IGNORED' } });
    await recordAudit({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'message.reprocessed',
      entityType: 'Message',
      entityId: message.id,
      after: { action: 'ignore' },
      ...(await requestMeta()),
    });
    return ok({ action: 'ignore', status: 'IGNORED' });
  }

  // Which automation should read this message? Either the one named, or every
  // active automation watching its group.
  let automationIds: string[] = [];

  if (input.automationId) {
    const automation = await prisma.automation.findFirst({
      where: { id: input.automationId, tenantId: context.tenantId },
    });
    if (!automation) throw new AppError('NOT_FOUND', 'That automation does not exist in this workspace.');
    automationIds = [automation.id];
  } else if (message.groupId) {
    const automations = await prisma.automation.findMany({
      where: {
        tenantId: context.tenantId,
        status: { in: ['ACTIVE', 'DRAFT', 'PAUSED'] },
        triggers: { some: { groupId: message.groupId } },
      },
      select: { id: true },
    });
    automationIds = automations.map((a) => a.id);
  }

  if (automationIds.length === 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      'No automation is watching this message’s group. Choose one to run against.',
    );
  }

  await prisma.message.update({ where: { id: message.id }, data: { status: 'PROCESSING', errorMessage: null } });

  // Force re-classification: a message being reprocessed usually means the last
  // classification was wrong.
  await classifyMessage({ tenantId: context.tenantId, messageId: message.id, force: true });

  const results = [];
  for (const automationId of automationIds) {
    try {
      results.push({
        automationId,
        ...(await extractFromMessage({ tenantId: context.tenantId, messageId: message.id, automationId })),
      });
    } catch (err) {
      results.push({
        automationId,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 1,
        recordIds: [],
        confidence: 0,
        reasoning: err instanceof Error ? err.message : 'Extraction failed',
      });
    }
  }

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'message.reprocessed',
    entityType: 'Message',
    entityId: message.id,
    after: { automations: automationIds.length },
    ...(await requestMeta()),
  });

  return ok({ action: input.action, results });
});
