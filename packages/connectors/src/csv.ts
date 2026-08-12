import { createLogger } from '@msgflow/logger';
import type { OutputConnector, SyncContext, SyncOutcome, SyncRow, SyncRowOutcome } from '@msgflow/types';
import { buildRowKey, keyFieldsOf, mergeRowValues } from './mapping.js';
import { buildStorageRef, checksumOf, getStorage } from './storage.js';

const log = createLogger('connector:csv');

/**
 * CSV connector.
 *
 * A hand-rolled parser rather than a dependency: CSV is a small, well-specified
 * format (RFC 4180) and the edge cases that matter — quoted fields containing
 * commas, escaped quotes, CRLF — are a dozen lines. It also means the exact
 * quoting behaviour on write matches what we accept on read.
 */

export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Strip a UTF-8 BOM — Excel writes one and it corrupts the first header.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // handled by the \n branch
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function toCsv(rows: string[][], delimiter = ','): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell ?? '';
          return /["\n\r]|^\s|\s$/.test(value) || value.includes(delimiter)
            ? `"${value.replace(/"/g, '""')}"`
            : value;
        })
        .join(delimiter),
    )
    .join('\r\n');
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

export class CsvConnector implements OutputConnector {
  readonly type = 'CSV';

  isConfigured(): boolean {
    return true;
  }

  async fingerprint(context: SyncContext) {
    const ref = context.config.storageRef as string | undefined;
    if (!ref) return { checksum: null, modifiedAt: null };
    const info = await getStorage().stat(ref);
    return info ? { checksum: info.checksum, modifiedAt: info.modifiedAt } : { checksum: null, modifiedAt: null };
  }

  async sync(rows: SyncRow[], context: SyncContext): Promise<SyncOutcome> {
    const storage = getStorage();
    const config = context.config as { storageRef?: string; fileName?: string; delimiter?: string };
    const delimiter = config.delimiter || ',';
    const fileName = config.fileName || 'output.csv';
    const operation = context.operation;

    const targetFields = context.mappings.map((m) => m.targetField);
    const keyMappings = keyFieldsOf(context.mappings);
    const keyFields = keyMappings.map((m) => m.targetField);

    let header: string[] = [...targetFields];
    let dataRows: string[][] = [];

    if (config.storageRef && operation !== 'CREATE_NEW' && (await storage.exists(config.storageRef))) {
      const buffer = await storage.read(config.storageRef);
      const actualChecksum = checksumOf(buffer);
      if (context.lastKnownChecksum && context.lastKnownChecksum !== actualChecksum) {
        return {
          status: 'CONFLICT',
          created: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          rows: [],
          warnings: [],
          error: 'The output file has changed since the last synchronization.',
          conflict: { expectedChecksum: context.lastKnownChecksum, actualChecksum, detail: { fileName } },
        };
      }

      const parsed = parseCsv(buffer.toString('utf8'), delimiter);
      if (parsed.length > 0) {
        header = parsed[0];
        dataRows = operation === 'REPLACE' ? [] : parsed.slice(1);
        // Append any mapped column the file does not already have.
        for (const field of targetFields) {
          if (!header.some((h) => h.toLowerCase() === field.toLowerCase())) header.push(field);
        }
      }
    }

    const columnIndex = new Map(header.map((h, i) => [h.toLowerCase(), i]));
    const rowToValues = (raw: string[]): Record<string, unknown> => {
      const values: Record<string, unknown> = {};
      for (const field of targetFields) {
        const idx = columnIndex.get(field.toLowerCase());
        values[field] = idx === undefined ? '' : (raw[idx] ?? '');
      }
      return values;
    };

    const keyIndex = new Map<string, number>();
    if (keyFields.length > 0) {
      dataRows.forEach((raw, i) => {
        const key = buildRowKey(rowToValues(raw), keyMappings);
        if (key && !keyIndex.has(key)) keyIndex.set(key, i);
      });
    }

    const isInsertOnly = ['CREATE_NEW', 'APPEND', 'REPLACE', 'GENERATE_NEW_VERSION'].includes(operation);
    const outcomes: SyncRowOutcome[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      const key = keyFields.length > 0 ? buildRowKey(row.values, keyMappings) : '';
      const existingIdx = !isInsertOnly && key ? keyIndex.get(key) : undefined;

      if (existingIdx !== undefined) {
        const current = rowToValues(dataRows[existingIdx]);
        const merge = mergeRowValues(current, row.values, context.mappings, {
          incomingUpdatedAt: row.updatedAt,
        });
        if (!merge.changed) {
          skipped++;
          outcomes.push({ recordId: row.recordId, action: 'skipped', externalRowId: String(existingIdx + 2) });
          continue;
        }
        const raw = [...dataRows[existingIdx]];
        for (const [field, value] of Object.entries(merge.values)) {
          const idx = columnIndex.get(field.toLowerCase());
          if (idx !== undefined) raw[idx] = stringify(value);
        }
        dataRows[existingIdx] = raw;
        updated++;
        outcomes.push({ recordId: row.recordId, action: 'updated', externalRowId: String(existingIdx + 2) });
        continue;
      }

      if (operation === 'UPDATE_EXISTING') {
        failed++;
        outcomes.push({
          recordId: row.recordId,
          action: 'failed',
          error: `No existing row matched the key "${key}".`,
        });
        continue;
      }

      const raw = new Array(header.length).fill('');
      for (const [field, value] of Object.entries(row.values)) {
        const idx = columnIndex.get(field.toLowerCase());
        if (idx !== undefined) raw[idx] = stringify(value);
      }
      dataRows.push(raw);
      if (key) keyIndex.set(key, dataRows.length - 1);
      created++;
      outcomes.push({ recordId: row.recordId, action: 'created', externalRowId: String(dataRows.length + 1) });
    }

    if (context.dryRun) {
      return {
        status: failed > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
        created,
        updated,
        skipped,
        failed,
        rows: outcomes,
        warnings: [],
        recordCount: dataRows.length,
      };
    }

    const csv = toCsv([header, ...dataRows], delimiter);
    const buffer = Buffer.from(`﻿${csv}`, 'utf8');

    const shouldCreateNewRef =
      !config.storageRef || operation === 'CREATE_NEW' || operation === 'GENERATE_NEW_VERSION';
    const targetRef = shouldCreateNewRef
      ? buildStorageRef(context.tenantId, 'outputs', fileName)
      : config.storageRef!;

    const stored = await storage.write(targetRef, buffer);
    log.info('CSV sync complete', { outputId: context.outputId, created, updated, skipped, failed });

    return {
      status: failed > 0 ? (created + updated > 0 ? 'PARTIAL_SUCCESS' : 'FAILED') : 'SUCCESS',
      created,
      updated,
      skipped,
      failed,
      rows: outcomes,
      checksum: stored.checksum,
      storageRef: stored.storageRef,
      sizeBytes: stored.sizeBytes,
      recordCount: dataRows.length,
      warnings: [],
    };
  }
}

export const csvConnector = new CsvConnector();
