import { MAX_MESSAGES_PER_RUN } from '@msgflow/config';
import { evaluateCondition } from '@msgflow/connectors';
import { prisma, recordUsage } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { createLogger, describeError } from '@msgflow/logger';
import { AppError } from '@msgflow/types';
import { classifyMessage, extractFromMessage } from './pipeline.js';
import { syncOutputTarget, type SyncTargetResult } from './sync.js';
import { computeNextRun } from './schedule.js';
import { resolveWindow, startOfLocalDay, type WindowMode } from './windows.js';

const log = createLogger('workflow:engine');

/**
 * The automation engine.
 *
 * One run = resolve window → select messages → classify → extract → execute
 * ordered actions (including output syncs). Every step is recorded as a
 * WorkflowRunStep so a failure is inspectable rather than a mystery.
 *
 * Cursor discipline: `lastSuccessfulRunAt` advances only when the run fully
 * succeeds. A partial failure leaves the cursor alone so the failed messages
 * are retried next time — re-scanning is harmless because message dedupe and
 * the record natural key make reprocessing idempotent.
 */

const IMPORTANCE_RANK: Record<string, number> = { IGNORE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

export interface RunAutomationOptions {
  tenantId: string;
  automationId: string;
  trigger: 'SCHEDULE' | 'MANUAL' | 'REAL_TIME' | 'SYNC_NOW' | 'BACKLOG' | 'REPROCESS';
  startedBy?: string | null;
  /** Overrides the automation's configured window. */
  from?: Date | null;
  to?: Date | null;
  /** Reprocess messages even if already extracted. */
  force?: boolean;
  /** Real-time path: process exactly these messages. */
  messageIds?: string[];
  dryRun?: boolean;
}

export interface RunAutomationResult {
  runId: string;
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  windowStart: Date | null;
  windowEnd: Date | null;
  windowLabel: string;
  messagesScanned: number;
  messagesProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  outputs: SyncTargetResult[];
  errors: string[];
}

export async function runAutomation(options: RunAutomationOptions): Promise<RunAutomationResult> {
  const automation = await prisma.automation.findFirst({
    where: { id: options.automationId, tenantId: options.tenantId },
    include: {
      tenant: { select: { timezone: true } },
      triggers: { include: { group: true } },
      actions: { orderBy: { order: 'asc' }, include: { outputTarget: true } },
      outputTargets: { where: { enabled: true }, include: { output: true } },
      schema: { include: { fields: true } },
    },
  });

  if (!automation) throw new AppError('NOT_FOUND', 'Automation not found.');

  if (automation.status === 'PAUSED' && options.trigger === 'SCHEDULE') {
    throw new AppError('CONFLICT', 'This automation is paused.');
  }

  const timezone = automation.timezone || automation.tenant.timezone;

  const window = resolveWindow(automation.dateRangeMode as WindowMode, {
    timezone,
    lastSuccessfulRunAt: automation.lastSuccessfulRunAt,
    customFrom: options.from ?? automation.customFrom,
    customTo: options.to ?? automation.customTo,
  });

  const windowStart = options.from ?? window.start;
  const windowEnd = options.to ?? window.end;

  const run = await prisma.workflowRun.create({
    data: {
      tenantId: options.tenantId,
      automationId: automation.id,
      trigger: options.trigger,
      status: 'RUNNING',
      startedBy: options.startedBy ?? null,
      windowStart,
      windowEnd,
      startedAt: new Date(),
    },
  });

  const result: RunAutomationResult = {
    runId: run.id,
    status: 'SUCCESS',
    windowStart,
    windowEnd,
    windowLabel: window.label,
    messagesScanned: 0,
    messagesProcessed: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    recordsFailed: 0,
    outputs: [],
    errors: [],
  };

  try {
    const groupIds = automation.triggers
      .filter((t) => t.enabled && t.groupId)
      .map((t) => t.groupId as string);

    if (groupIds.length === 0 && !options.messageIds?.length) {
      throw new AppError('VALIDATION_FAILED', 'This automation has no source groups selected.');
    }

    const messageWhere: Prisma.MessageWhereInput = options.messageIds?.length
      ? { id: { in: options.messageIds }, tenantId: options.tenantId }
      : {
          tenantId: options.tenantId,
          groupId: { in: groupIds },
          timestamp: { gte: windowStart, lt: windowEnd },
          // Ignore system messages and our own outgoing messages.
          isFromMe: false,
          messageType: { in: ['TEXT', 'IMAGE', 'DOCUMENT'] },
          ...(options.force
            ? {}
            : { status: { notIn: ['EXTRACTED', 'IGNORED', 'SKIPPED'] } }),
        };

    const messages = await prisma.message.findMany({
      where: messageWhere,
      orderBy: { timestamp: 'asc' },
      take: MAX_MESSAGES_PER_RUN,
      include: { classification: true },
    });

    result.messagesScanned = messages.length;

    if (messages.length === MAX_MESSAGES_PER_RUN) {
      // Never silently truncate — say so in the run summary.
      result.errors.push(
        `Reached the ${MAX_MESSAGES_PER_RUN}-message limit for a single run. Remaining messages will be picked up by the next run.`,
      );
    }

    const keywordFilter = automation.keywordFilter?.trim().toLowerCase();
    const minRank = IMPORTANCE_RANK[automation.minImportance] ?? 2;
    const touchedRecordIds = new Set<string>();

    for (const message of messages) {
      try {
        if (keywordFilter) {
          const keywords = keywordFilter.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
          const text = (message.text ?? '').toLowerCase();
          if (keywords.length > 0 && !keywords.some((k) => text.includes(k))) {
            result.recordsSkipped++;
            continue;
          }
        }

        // Classify once, then reuse.
        let classification = message.classification;
        if (!classification) {
          await classifyMessage({ tenantId: options.tenantId, messageId: message.id });
          classification = await prisma.messageClassification.findUnique({ where: { messageId: message.id } });
        }

        if (classification) {
          if (classification.category === 'IGNORE') {
            result.recordsSkipped++;
            continue;
          }
          if (automation.requireImportant && (IMPORTANCE_RANK[classification.importance] ?? 0) < minRank) {
            result.recordsSkipped++;
            continue;
          }
          if (
            automation.categories.length > 0 &&
            !automation.categories.includes(classification.category)
          ) {
            result.recordsSkipped++;
            continue;
          }
        }

        const extraction = await extractFromMessage({
          tenantId: options.tenantId,
          messageId: message.id,
          automationId: automation.id,
          runId: run.id,
        });

        result.messagesProcessed++;
        result.recordsCreated += extraction.created;
        result.recordsUpdated += extraction.updated;
        result.recordsSkipped += extraction.skipped;
        result.recordsFailed += extraction.failed;
        extraction.recordIds.forEach((id) => touchedRecordIds.add(id));
      } catch (err) {
        result.recordsFailed++;
        const detail = describeError(err);
        result.errors.push(`Message ${message.id}: ${detail.message}`);
        log.error('Message processing failed', { messageId: message.id, ...detail });
      }
    }

    // ---- Actions -----------------------------------------------------------
    const actions = automation.actions.filter((a) => a.enabled);
    const recordIds = [...touchedRecordIds];

    // With no explicit actions configured, syncing every enabled output target
    // is the sensible default — it is what the automation wizard implies.
    if (actions.length === 0) {
      for (const target of automation.outputTargets) {
        const stepResult = await runOutputStep({
          tenantId: options.tenantId,
          runId: run.id,
          targetId: target.id,
          name: `Sync ${target.output.name}`,
          order: 0,
          recordIds,
          dryRun: options.dryRun,
          startedBy: options.startedBy,
        });
        result.outputs.push(...stepResult.outputs);
        result.errors.push(...stepResult.errors);
      }
    } else {
      for (const action of actions) {
        if (action.condition && recordIds.length > 0) {
          const sample = await prisma.extractedRecord.findFirst({
            where: { id: { in: recordIds }, tenantId: options.tenantId },
          });
          if (sample && !evaluateCondition(action.condition, sample.data as Record<string, unknown>)) {
            await prisma.workflowRunStep.create({
              data: {
                tenantId: options.tenantId,
                runId: run.id,
                actionId: action.id,
                name: action.name,
                type: action.type,
                order: action.order,
                status: 'CANCELLED',
                errorMessage: `Condition not met: ${action.condition}`,
              },
            });
            continue;
          }
        }

        if (action.type === 'SYNC_OUTPUT' && action.outputTargetId) {
          const stepResult = await runOutputStep({
            tenantId: options.tenantId,
            runId: run.id,
            targetId: action.outputTargetId,
            actionId: action.id,
            name: action.name,
            order: action.order,
            recordIds,
            dryRun: options.dryRun,
            startedBy: options.startedBy,
            retryPolicy: action.retryPolicy as { maxAttempts?: number; initialDelayMs?: number },
            continueOnError: action.continueOnError,
          });
          result.outputs.push(...stepResult.outputs);
          result.errors.push(...stepResult.errors);
          if (stepResult.fatal) break;
          continue;
        }

        // SAVE_RECORD is implicit (records are already persisted); NOTIFY and
        // GENERATE_DOCUMENT are recorded so the run history is complete.
        await prisma.workflowRunStep.create({
          data: {
            tenantId: options.tenantId,
            runId: run.id,
            actionId: action.id,
            name: action.name,
            type: action.type,
            order: action.order,
            status: 'SUCCESS',
            output: { note: 'Handled inline by the extraction stage.' } as Prisma.InputJsonValue,
            startedAt: new Date(),
            finishedAt: new Date(),
          },
        });

        if (action.type === 'NOTIFY' && recordIds.length > 0) {
          await prisma.notification.create({
            data: {
              tenantId: options.tenantId,
              severity: 'INFO',
              code: 'AUTOMATION_RECORDS',
              title: `${automation.name}: ${recordIds.length} record(s) processed`,
              body: `${result.recordsCreated} created, ${result.recordsUpdated} updated.`,
              link: `/dashboard/runs/${run.id}`,
            },
          });
        }
      }
    }

    const outputFailed = result.outputs.some((o) => o.status === 'FAILED' || o.status === 'CONFLICT');
    const anythingFailed = result.recordsFailed > 0 || outputFailed || result.errors.length > 0;
    const anythingSucceeded =
      result.recordsCreated + result.recordsUpdated > 0 ||
      result.outputs.some((o) => o.created + o.updated > 0);

    result.status = !anythingFailed ? 'SUCCESS' : anythingSucceeded ? 'PARTIAL_SUCCESS' : 'FAILED';

    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: result.status,
        finishedAt: new Date(),
        messagesScanned: result.messagesScanned,
        messagesProcessed: result.messagesProcessed,
        recordsCreated: result.recordsCreated,
        recordsUpdated: result.recordsUpdated,
        recordsSkipped: result.recordsSkipped,
        recordsFailed: result.recordsFailed,
        rowsCreated: result.outputs.reduce((a, o) => a + o.created, 0),
        rowsUpdated: result.outputs.reduce((a, o) => a + o.updated, 0),
        rowsSkipped: result.outputs.reduce((a, o) => a + o.skipped, 0),
        rowsFailed: result.outputs.reduce((a, o) => a + o.failed, 0),
        errorMessage: result.errors.length > 0 ? result.errors.slice(0, 5).join(' | ').slice(0, 1000) : null,
        summary: {
          windowLabel: result.windowLabel,
          outputs: result.outputs.map((o) => ({
            name: o.outputName,
            status: o.status,
            created: o.created,
            updated: o.updated,
            skipped: o.skipped,
            failed: o.failed,
          })),
          warnings: result.outputs.flatMap((o) => o.warnings).slice(0, 20),
        } as Prisma.InputJsonValue,
      },
    });

    // Advance the cursor only on a clean run.
    const cursorUpdate: Prisma.AutomationUpdateInput = {
      lastRunAt: new Date(),
      nextRunAt: computeNextRun({
        processingMode: automation.processingMode,
        scheduleHour: automation.scheduleHour,
        scheduleMinute: automation.scheduleMinute,
        scheduleWeekday: automation.scheduleWeekday,
        scheduleDay: automation.scheduleDay,
        cronExpression: automation.cronExpression,
        timezone,
      }),
    };

    if (result.status === 'SUCCESS' && !options.dryRun) {
      cursorUpdate.lastSuccessfulRunAt = windowEnd;
      cursorUpdate.lastProcessedAt = new Date();
      if (messages.length > 0) {
        cursorUpdate.lastProcessedMessageId = messages[messages.length - 1].id;
      }
    }

    await prisma.automation.update({ where: { id: automation.id }, data: cursorUpdate });

    await recordUsage(options.tenantId, startOfLocalDay(new Date(), timezone), {
      automationRuns: 1,
      workflowRuns: 1,
    });

    log.info('Automation run complete', {
      automationId: automation.id,
      runId: run.id,
      status: result.status,
      messagesProcessed: result.messagesProcessed,
    });

    return result;
  } catch (err) {
    const detail = describeError(err);
    log.error('Automation run failed', { automationId: automation.id, runId: run.id, ...detail });

    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: detail.message.slice(0, 1000),
        messagesScanned: result.messagesScanned,
        messagesProcessed: result.messagesProcessed,
      },
    });

    await prisma.automation.update({
      where: { id: automation.id },
      data: { lastRunAt: new Date(), status: automation.status === 'ACTIVE' ? 'ACTIVE' : automation.status },
    });

    result.status = 'FAILED';
    result.errors.push(detail.message);
    return result;
  }
}

interface OutputStepOptions {
  tenantId: string;
  runId: string;
  targetId: string;
  actionId?: string;
  name: string;
  order: number;
  recordIds: string[];
  dryRun?: boolean;
  startedBy?: string | null;
  retryPolicy?: { maxAttempts?: number; initialDelayMs?: number };
  continueOnError?: boolean;
}

async function runOutputStep(options: OutputStepOptions): Promise<{
  outputs: SyncTargetResult[];
  errors: string[];
  fatal: boolean;
}> {
  const maxAttempts = options.retryPolicy?.maxAttempts ?? 3;
  const initialDelay = options.retryPolicy?.initialDelayMs ?? 1_000;

  const step = await prisma.workflowRunStep.create({
    data: {
      tenantId: options.tenantId,
      runId: options.runId,
      actionId: options.actionId ?? null,
      name: options.name,
      type: 'SYNC_OUTPUT',
      order: options.order,
      status: 'RUNNING',
      maxAttempts,
      startedAt: new Date(),
      input: { recordCount: options.recordIds.length } as Prisma.InputJsonValue,
    },
  });

  const started = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const outcome = await syncOutputTarget({
        tenantId: options.tenantId,
        outputTargetId: options.targetId,
        runId: options.runId,
        recordIds: options.recordIds.length > 0 ? options.recordIds : undefined,
        dryRun: options.dryRun,
        startedBy: options.startedBy,
      });

      await prisma.workflowRunStep.update({
        where: { id: step.id },
        data: {
          status:
            outcome.status === 'SUCCESS'
              ? 'SUCCESS'
              : outcome.status === 'CONFLICT'
                ? 'FAILED'
                : outcome.status === 'FAILED'
                  ? 'FAILED'
                  : 'PARTIAL_SUCCESS',
          attempt,
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          output: outcome as unknown as Prisma.InputJsonValue,
          errorMessage: outcome.error ?? null,
        },
      });

      return {
        outputs: [outcome],
        errors: outcome.error ? [`${outcome.outputName}: ${outcome.error}`] : [],
        fatal: false,
      };
    } catch (err) {
      lastError = err;
      const retryable = (err as { retryable?: boolean }).retryable === true;
      if (!retryable || attempt === maxAttempts) break;

      await prisma.workflowRunStep.update({
        where: { id: step.id },
        data: { status: 'RETRYING', attempt },
      });
      await new Promise((resolve) => setTimeout(resolve, initialDelay * 2 ** (attempt - 1)));
    }
  }

  const detail = describeError(lastError);
  await prisma.workflowRunStep.update({
    where: { id: step.id },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      durationMs: Date.now() - started,
      errorMessage: detail.message.slice(0, 1000),
    },
  });

  return {
    outputs: [],
    errors: [`${options.name}: ${detail.message}`],
    fatal: options.continueOnError === false,
  };
}

/**
 * Real-time path: a message just arrived, run every REAL_TIME automation that
 * watches its group.
 */
export async function processIncomingMessage(tenantId: string, messageId: string): Promise<void> {
  const message = await prisma.message.findFirst({
    where: { id: messageId, tenantId },
    select: { id: true, groupId: true },
  });
  if (!message?.groupId) return;

  const automations = await prisma.automation.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      processingMode: 'REAL_TIME',
      triggers: { some: { groupId: message.groupId, enabled: true } },
    },
    select: { id: true },
  });

  for (const automation of automations) {
    try {
      await runAutomation({
        tenantId,
        automationId: automation.id,
        trigger: 'REAL_TIME',
        messageIds: [messageId],
      });
    } catch (err) {
      log.error('Real-time automation failed', {
        automationId: automation.id,
        messageId,
        ...describeError(err),
      });
    }
  }
}

/**
 * Scheduler tick. Runs every due automation.
 *
 * Invoked by the worker's internal ticker and by /api/cron/tick (so a Vercel
 * cron or an external scheduler can drive it too).
 */
export async function runDueAutomations(now = new Date()): Promise<{ ran: number; results: RunAutomationResult[] }> {
  const due = await prisma.automation.findMany({
    where: {
      status: 'ACTIVE',
      nextRunAt: { not: null, lte: now },
      processingMode: { in: ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'] },
    },
    select: { id: true, tenantId: true, name: true },
    take: 50,
  });

  const results: RunAutomationResult[] = [];
  for (const automation of due) {
    try {
      results.push(
        await runAutomation({
          tenantId: automation.tenantId,
          automationId: automation.id,
          trigger: 'SCHEDULE',
          startedBy: 'scheduler',
        }),
      );
    } catch (err) {
      log.error('Scheduled automation failed', { automationId: automation.id, ...describeError(err) });
    }
  }

  return { ran: due.length, results };
}
