import PDFDocument from 'pdfkit';
import { createLogger } from '@msgflow/logger';
import type { OutputConnector, SyncContext, SyncOutcome, SyncRow } from '@msgflow/types';
import { buildStorageRef, getStorage } from './storage.js';

const log = createLogger('connector:pdf');

/**
 * PDF report generator.
 *
 * A document output is inherently CREATE_NEW / GENERATE_NEW_VERSION: you cannot
 * meaningfully UPSERT a row into a rendered PDF. Rather than pretend otherwise,
 * the connector reports that clearly in `warnings` when asked for an update
 * operation and produces a fresh document.
 */

interface DocumentConfig {
  fileName?: string;
  title?: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
}

export async function renderRecordsPdf(
  rows: SyncRow[],
  columns: string[],
  config: DocumentConfig,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: config.orientation ?? 'landscape',
      margin: 36,
      info: { Title: config.title ?? 'MsgFlow Report', Creator: 'MsgFlow' },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.fontSize(20).fillColor('#0f172a').text(config.title ?? 'MsgFlow Report');
    if (config.subtitle) {
      doc.moveDown(0.2).fontSize(10).fillColor('#64748b').text(config.subtitle);
    }
    doc
      .moveDown(0.2)
      .fontSize(9)
      .fillColor('#94a3b8')
      .text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${rows.length} record(s)`);
    doc.moveDown(1);

    if (rows.length === 0) {
      doc.fontSize(12).fillColor('#64748b').text('No records matched this report.');
      doc.end();
      return;
    }

    const colWidth = pageWidth / Math.max(columns.length, 1);
    const rowHeight = 20;

    const drawHeader = () => {
      const y = doc.y;
      doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).fill('#f1f5f9');
      doc.fillColor('#0f172a').fontSize(9);
      columns.forEach((col, i) => {
        doc.text(col, doc.page.margins.left + i * colWidth + 4, y + 6, {
          width: colWidth - 8,
          ellipsis: true,
          lineBreak: false,
        });
      });
      doc.y = y + rowHeight;
    };

    drawHeader();

    rows.forEach((row, rowIndex) => {
      // Repeat the header on every page — a table whose header is only on page
      // one is unreadable in print.
      if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        drawHeader();
      }

      const y = doc.y;
      if (rowIndex % 2 === 1) {
        doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).fill('#fafafa');
      }
      doc.fillColor('#334155').fontSize(8.5);
      columns.forEach((col, i) => {
        const value = row.values[col];
        const text = value === null || value === undefined ? '' : String(value);
        doc.text(text, doc.page.margins.left + i * colWidth + 4, y + 6, {
          width: colWidth - 8,
          ellipsis: true,
          lineBreak: false,
        });
      });
      doc.y = y + rowHeight;
    });

    doc.end();
  });
}

export class PdfConnector implements OutputConnector {
  readonly type = 'PDF';

  isConfigured(): boolean {
    return true;
  }

  async sync(rows: SyncRow[], context: SyncContext): Promise<SyncOutcome> {
    const config = context.config as unknown as DocumentConfig;
    const columns = context.mappings.map((m) => m.targetField);
    const warnings: string[] = [];

    if (!['CREATE_NEW', 'GENERATE_NEW_VERSION', 'REPLACE'].includes(context.operation)) {
      warnings.push(
        `A PDF cannot be updated row by row, so ${context.operation} produced a freshly rendered document instead.`,
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

    const buffer = await renderRecordsPdf(rows, columns, config);
    const ref = buildStorageRef(context.tenantId, 'outputs', `${config.fileName ?? 'report'}.pdf`);
    const stored = await getStorage().write(ref, buffer);

    log.info('PDF generated', { outputId: context.outputId, rows: rows.length });

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

export const pdfConnector = new PdfConnector();
