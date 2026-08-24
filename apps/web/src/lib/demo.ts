import type { Prisma } from '@msgflow/db';

/**
 * Demo-data visibility.
 *
 * Demo rows are ordinary rows with `ingestSource: DEMO` on the message that
 * produced them, so the switch is a query filter rather than a separate code
 * path — the pages you show a client are the same pages, running the same
 * queries, over the same tables.
 *
 * The filters are *exclusions*: when demo mode is on nothing is added, and when
 * it is off the demo rows are removed. That direction matters — a bug here hides
 * data rather than inventing it.
 */

/** Message-level filter. Spread into a `where` on Message. */
export function messageDemoFilter(demoMode: boolean): Prisma.MessageWhereInput {
  return demoMode ? {} : { ingestSource: { not: 'DEMO' } };
}

/**
 * Record-level filter, applied through the message that first created it.
 * Records with no origin message are never demo rows, so they always pass.
 */
export function recordDemoFilter(demoMode: boolean): Prisma.ExtractedRecordWhereInput {
  return demoMode ? {} : { OR: [{ originMessage: null }, { originMessage: { ingestSource: { not: 'DEMO' } } }] };
}

/** Group-level filter, applied through the connection that owns the group. */
export function groupDemoFilter(demoMode: boolean): Prisma.WhatsAppGroupWhereInput {
  return demoMode ? {} : { connection: { provider: { not: 'DEMO' } } };
}

/** Classification-level filter, applied through its message. */
export function classificationDemoFilter(demoMode: boolean): Prisma.MessageClassificationWhereInput {
  return demoMode ? {} : { message: { ingestSource: { not: 'DEMO' } } };
}

/**
 * Workflow-run filter.
 *
 * A run has no ingest source of its own, so it is judged by the company it
 * keeps: a run belongs to the demo set when its automation reads from a group
 * on a demo connection. Runs with no automation are output-only and always pass.
 */
export function workflowRunDemoFilter(demoMode: boolean): Prisma.WorkflowRunWhereInput {
  if (demoMode) return {};
  return {
    NOT: {
      automation: {
        triggers: { some: { group: { connection: { provider: 'DEMO' } } } },
      },
    },
  };
}

/** Automation filter, on the same "reads from a demo group" basis. */
export function automationDemoFilter(demoMode: boolean): Prisma.AutomationWhereInput {
  if (demoMode) return {};
  return { NOT: { triggers: { some: { group: { connection: { provider: 'DEMO' } } } } } };
}
