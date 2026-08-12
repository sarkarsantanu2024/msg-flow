import PptxGenJS from 'pptxgenjs';
import { createLogger } from '@msgflow/logger';
import type { OutputConnector, SyncContext, SyncOutcome, SyncRow } from '@msgflow/types';
import { buildStorageRef, getStorage } from './storage.js';

const log = createLogger('connector:pptx');

/**
 * PowerPoint report generator.
 *
 * Like PDF, a deck is regenerated rather than updated in place. Rows are
 * paginated across slides so a 500-record report is readable instead of one
 * unreadable table.
 */

interface DocumentConfig {
  fileName?: string;
  title?: string;
  subtitle?: string;
}

const ROWS_PER_SLIDE = 12;

export async function renderRecordsPptx(
  rows: SyncRow[],
  columns: string[],
  config: DocumentConfig,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'MsgFlow';
  pptx.title = config.title ?? 'MsgFlow Report';

  const title = pptx.addSlide();
  title.background = { color: '0F172A' };
  title.addText(config.title ?? 'MsgFlow Report', {
    x: 0.6,
    y: 2.2,
    w: 11.5,
    h: 1,
    fontSize: 40,
    bold: true,
    color: 'FFFFFF',
  });
  title.addText(config.subtitle ?? 'Turn Messages Into Business Data.', {
    x: 0.6,
    y: 3.2,
    w: 11.5,
    h: 0.6,
    fontSize: 16,
    color: '94A3B8',
  });
  title.addText(`${rows.length} record(s) · ${new Date().toISOString().slice(0, 10)}`, {
    x: 0.6,
    y: 4.0,
    w: 11.5,
    h: 0.4,
    fontSize: 12,
    color: '64748B',
  });

  if (rows.length === 0) {
    const empty = pptx.addSlide();
    empty.addText('No records matched this report.', {
      x: 0.6,
      y: 2.8,
      w: 11.5,
      h: 0.6,
      fontSize: 20,
      color: '475569',
    });
  }

  for (let start = 0; start < rows.length; start += ROWS_PER_SLIDE) {
    const chunk = rows.slice(start, start + ROWS_PER_SLIDE);
    const slide = pptx.addSlide();

    slide.addText(config.title ?? 'Records', {
      x: 0.4,
      y: 0.25,
      w: 12,
      h: 0.5,
      fontSize: 18,
      bold: true,
      color: '0F172A',
    });
    slide.addText(`Rows ${start + 1}–${start + chunk.length} of ${rows.length}`, {
      x: 0.4,
      y: 0.72,
      w: 12,
      h: 0.3,
      fontSize: 10,
      color: '64748B',
    });

    const tableRows: PptxGenJS.TableRow[] = [
      columns.map((col) => ({
        text: col,
        options: { bold: true, color: 'FFFFFF', fill: { color: '1E293B' }, fontSize: 10 },
      })),
      ...chunk.map((row) =>
        columns.map((col) => {
          const value = row.values[col];
          return {
            text: value === null || value === undefined ? '' : String(value),
            options: { fontSize: 9, color: '334155' },
          };
        }),
      ),
    ];

    slide.addTable(tableRows, {
      x: 0.4,
      y: 1.1,
      w: 12.5,
      colW: new Array(columns.length).fill(12.5 / Math.max(columns.length, 1)),
      border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
      autoPage: false,
    });
  }

  const data = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return Buffer.isBuffer(data) ? data : Buffer.from(data as unknown as ArrayBuffer);
}

export class PptxConnector implements OutputConnector {
  readonly type = 'POWERPOINT';

  isConfigured(): boolean {
    return true;
  }

  async sync(rows: SyncRow[], context: SyncContext): Promise<SyncOutcome> {
    const config = context.config as unknown as DocumentConfig;
    const columns = context.mappings.map((m) => m.targetField);
    const warnings: string[] = [];

    if (!['CREATE_NEW', 'GENERATE_NEW_VERSION', 'REPLACE'].includes(context.operation)) {
      warnings.push(
        `A presentation cannot be updated row by row, so ${context.operation} produced a freshly rendered deck instead.`,
      );
    }

    if (context.dryRun) {
      return {
        status: 'SUCCESS',
        created: rows.length,
        updated: 0,
        skipped: 0,
        failed: 0,
        rows: rows.map((r) => ({ recordId: r.recordId, action: 'created' as const })),
        warnings,
      };
    }

    const buffer = await renderRecordsPptx(rows, columns, config);
    const ref = buildStorageRef(context.tenantId, 'outputs', `${config.fileName ?? 'report'}.pptx`);
    const stored = await getStorage().write(ref, buffer);

    log.info('PPTX generated', { outputId: context.outputId, rows: rows.length });

    return {
      status: 'SUCCESS',
      created: rows.length,
      updated: 0,
      skipped: 0,
      failed: 0,
      rows: rows.map((r) => ({ recordId: r.recordId, action: 'created' as const })),
      checksum: stored.checksum,
      storageRef: stored.storageRef,
      sizeBytes: stored.sizeBytes,
      recordCount: rows.length,
      warnings,
    };
  }
}

export const pptxConnector = new PptxConnector();
