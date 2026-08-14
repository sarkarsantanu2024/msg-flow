import ExcelJS from 'exceljs';
import { buildStorageRef, getStorage, renderRecordsDocx, renderRecordsPdf, renderRecordsPptx, toCsv } from '@msgflow/connectors';
import { prisma, recordAudit, recordUsage } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { exportRequestSchema } from '@msgflow/validation';
import { resolvePreset, startOfLocalDay } from '@msgflow/workflow';
import type { SyncRow } from '@msgflow/types';
import { created, ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export const GET = route(async () => {
  const context = await requirePermission('exports:create');
  const exports_ = await prisma.export.findMany({
    where: { tenantId: context.tenantId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return ok(exports_);
});

/**
 * Generate an export.
 *
 * Runs synchronously and returns a ready file. Exports here are bounded
 * (10k rows) so a request cannot run away; the Outputs system is the right tool
 * for continuously maintained datasets, and the row cap is reported rather than
 * silently applied.
 */
export const POST = route(async (request: Request) => {
  const context = await requirePermission('exports:create');
  const input = exportRequestSchema.parse(await readJson(request));

  const range = resolvePreset(
    input.from || input.to ? 'custom' : 'last30',
    context.timezone,
    new Date(),
    { from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined },
  );

  // Non-contiguous day selection ("the 10th and the 14th"). Each date becomes
  // its own local-midnight-to-midnight window; the queries OR them together.
  // Day boundaries come from startOfLocalDay so a 23/25-hour DST day is still
  // exactly one calendar day. The noon-UTC anchor pins the intended calendar
  // date for any timezone in UTC-12…UTC+11:59 (all of the product's markets);
  // UTC+12 and beyond would land a day late — accepted and documented.
  const dayWindows =
    input.dates && input.dates.length > 0
      ? input.dates.map((d) => {
          const anchor = new Date(`${d}T12:00:00Z`);
          return {
            start: startOfLocalDay(anchor, context.timezone),
            end: startOfLocalDay(anchor, context.timezone, 1),
          };
        })
      : null;

  /** Prisma time condition: the picked days when given, else the from/to range. */
  const timeFilter = (field: string): Record<string, unknown> =>
    dayWindows
      ? { OR: dayWindows.map((w) => ({ [field]: { gte: w.start, lt: w.end } })) }
      : { [field]: { gte: range.start, lt: range.end } };

  const rangeLabel = dayWindows ? (input.dates ?? []).join(', ') : range.label;

  const MAX_ROWS = 10_000;
  let columns: string[] = [];
  let rows: Array<Record<string, unknown>> = [];

  if (input.entity === 'messages') {
    const messages = await prisma.message.findMany({
      where: { tenantId: context.tenantId, ...timeFilter('timestamp') },
      orderBy: { timestamp: 'desc' },
      take: MAX_ROWS,
      include: { group: { select: { name: true } }, classification: true },
    });
    columns = ['Date', 'Group', 'Sender', 'Message', 'Category', 'Importance', 'Confidence', 'Status'];
    rows = messages.map((m) => ({
      Date: m.timestamp.toISOString().slice(0, 16).replace('T', ' '),
      Group: m.group?.name ?? '',
      Sender: m.senderName ?? '',
      Message: m.text ?? '',
      Category: m.classification?.category ?? '',
      Importance: m.classification?.importance ?? '',
      Confidence: m.classification ? Math.round(m.classification.confidence * 100) / 100 : '',
      Status: m.status,
    }));
  } else if (input.entity === 'records') {
    const records = await prisma.extractedRecord.findMany({
      where: { tenantId: context.tenantId, ...timeFilter('createdAt') },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      include: { schema: { include: { fields: { orderBy: { order: 'asc' } } } } },
    });

    const fieldKeys = [...new Set(records.flatMap((r) => r.schema.fields.map((f) => f.key)))];
    columns = [...fieldKeys, 'Status', 'Confidence', 'Created'];
    rows = records.map((r) => {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const row: Record<string, unknown> = {};
      for (const key of fieldKeys) row[key] = data[key] ?? '';
      row.Status = r.status;
      row.Confidence = Math.round(r.confidence * 100) / 100;
      row.Created = r.createdAt.toISOString().slice(0, 10);
      return row;
    });
  } else if (input.entity === 'runs') {
    const runs = await prisma.workflowRun.findMany({
      where: { tenantId: context.tenantId, ...timeFilter('queuedAt') },
      orderBy: { queuedAt: 'desc' },
      take: MAX_ROWS,
      include: { automation: { select: { name: true } } },
    });
    columns = ['Started', 'Automation', 'Trigger', 'Status', 'Messages', 'Created', 'Updated', 'Skipped', 'Failed'];
    rows = runs.map((r) => ({
      Started: r.queuedAt.toISOString().slice(0, 16).replace('T', ' '),
      Automation: r.automation?.name ?? '',
      Trigger: r.trigger,
      Status: r.status,
      Messages: r.messagesProcessed,
      Created: r.recordsCreated,
      Updated: r.recordsUpdated,
      Skipped: r.recordsSkipped,
      Failed: r.recordsFailed,
    }));
  } else {
    const usage = await prisma.usage.findMany({
      where: { tenantId: context.tenantId, ...timeFilter('periodStart') },
      orderBy: { periodStart: 'asc' },
      take: MAX_ROWS,
    });
    columns = ['Date', 'Messages', 'AI calls', 'Input tokens', 'Output tokens', 'Cost USD', 'Records created', 'Records updated'];
    rows = usage.map((u) => ({
      Date: u.periodStart.toISOString().slice(0, 10),
      Messages: u.messages,
      'AI calls': u.aiCalls,
      'Input tokens': u.inputTokens,
      'Output tokens': u.outputTokens,
      'Cost USD': Number(u.costUsd),
      'Records created': u.recordsCreated,
      'Records updated': u.recordsUpdated,
    }));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `msgflow-${input.entity}-${stamp}.${input.format}`;
  let buffer: Buffer;

  if (input.format === 'csv') {
    buffer = Buffer.from(
      `﻿${toCsv([columns, ...rows.map((r) => columns.map((c) => String(r[c] ?? '')))])}`,
      'utf8',
    );
  } else if (input.format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MsgFlow';
    const sheet = workbook.addWorksheet(input.entity);
    sheet.addRow(columns);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    for (const row of rows) sheet.addRow(columns.map((c) => row[c] ?? ''));
    sheet.columns.forEach((column) => {
      column.width = 18;
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    buffer = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
  } else {
    const syncRows: SyncRow[] = rows.map((row, index) => ({
      recordId: String(index),
      keyValue: String(index),
      values: row,
      externalRowId: null,
      version: 1,
      updatedAt: new Date(),
    }));
    const config = { fileName, title: `MsgFlow — ${input.entity}`, subtitle: rangeLabel };
    buffer =
      input.format === 'pdf'
        ? await renderRecordsPdf(syncRows, columns, config)
        : input.format === 'docx'
          ? await renderRecordsDocx(syncRows, columns, config)
          : await renderRecordsPptx(syncRows, columns, config);
  }

  const storageRef = buildStorageRef(context.tenantId, 'exports', fileName);
  const stored = await getStorage().write(storageRef, buffer);

  const record = await prisma.export.create({
    data: {
      tenantId: context.tenantId,
      status: 'READY',
      entity: input.entity,
      format: input.format,
      fileName,
      storageRef: stored.storageRef,
      sizeBytes: stored.sizeBytes,
      filters: { ...input.filters, range: rangeLabel } as Prisma.InputJsonValue,
      recordCount: rows.length,
      requestedBy: context.userId,
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });

  await recordUsage(context.tenantId, startOfLocalDay(new Date(), context.timezone), { exports: 1 });
  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'export.generated',
    entityType: 'Export',
    entityId: record.id,
    after: { entity: input.entity, format: input.format, rows: rows.length },
    ...(await requestMeta()),
  });

  return created({
    ...record,
    truncated: rows.length >= MAX_ROWS,
    note: rows.length >= MAX_ROWS ? `Capped at ${MAX_ROWS} rows. Narrow the date range for the rest.` : null,
  });
});
