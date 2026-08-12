import { google, type sheets_v4 } from 'googleapis';
import { isGoogleConfigured } from '@msgflow/config';
import { createLogger } from '@msgflow/logger';
import { AppError } from '@msgflow/types';
import type { OutputConnector, SyncContext, SyncOutcome, SyncRow, SyncRowOutcome } from '@msgflow/types';
import { buildRowKey, keyFieldsOf, mergeRowValues } from './mapping.js';

const log = createLogger('connector:sheets');

/**
 * Google Sheets connector.
 *
 * Fully implemented against the Sheets v4 API. When Google credentials are not
 * configured it runs in MOCK mode: the same mapping, key-matching and
 * update-strategy logic executes and reports exactly what it would have done,
 * but nothing leaves the process. That keeps the feature demonstrable and
 * testable without credentials, and the switch is a single boolean rather than
 * a separate code path that can drift.
 *
 * Credentials required to activate this integration.
 */

interface SheetsCredentials {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Service-account JSON, as an alternative to OAuth. */
  serviceAccountJson?: string;
}

function buildClient(credentials: SheetsCredentials): sheets_v4.Sheets {
  if (credentials.serviceAccountJson) {
    const parsed = JSON.parse(credentials.serviceAccountJson) as { client_email: string; private_key: string };
    const auth = new google.auth.JWT({
      email: parsed.client_email,
      key: parsed.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
  }

  const oauth = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  oauth.setCredentials({
    access_token: credentials.accessToken,
    refresh_token: credentials.refreshToken,
  });
  return google.sheets({ version: 'v4', auth: oauth });
}

function columnLetter(index: number): string {
  let n = index;
  let letter = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

export class GoogleSheetsConnector implements OutputConnector {
  readonly type = 'GOOGLE_SHEETS';

  isConfigured(context: SyncContext): boolean {
    const creds = context.credentials as SheetsCredentials | undefined;
    if (!creds) return false;
    if (creds.serviceAccountJson) return true;
    return Boolean(creds.accessToken || creds.refreshToken) && isGoogleConfigured();
  }

  async sync(rows: SyncRow[], context: SyncContext): Promise<SyncOutcome> {
    const config = context.config as { spreadsheetId?: string; worksheetTitle?: string; headerRow?: number };
    if (!config.spreadsheetId) {
      throw new AppError('INTEGRATION_NOT_CONFIGURED', 'This output has no Google spreadsheet selected.');
    }

    const mock = !this.isConfigured(context);
    const worksheetTitle = config.worksheetTitle || 'Sheet1';
    const headerRow = config.headerRow ?? 1;

    const targetFields = context.mappings.map((m) => m.targetField);
    const keyMappings = keyFieldsOf(context.mappings);
    const keyFields = keyMappings.map((m) => m.targetField);

    if (['UPDATE_EXISTING', 'UPSERT'].includes(context.operation) && keyFields.length === 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${context.operation} needs at least one field marked as part of the unique key.`,
      );
    }

    let client: sheets_v4.Sheets | null = null;
    let sheetValues: string[][] = [];

    if (mock) {
      // Mock mode still needs a header to map against.
      sheetValues = [targetFields];
    } else {
      client = buildClient(context.credentials as SheetsCredentials);
      try {
        const response = await client.spreadsheets.values.get({
          spreadsheetId: config.spreadsheetId,
          range: `${worksheetTitle}!A${headerRow}:ZZ`,
        });
        sheetValues = (response.data.values ?? []) as string[][];
      } catch (err) {
        throw new AppError('SHEETS_FAILED', `Google Sheets could not be read: ${describe(err)}`, {
          retryable: true,
        });
      }
    }

    let header = sheetValues[0] ?? [];
    if (header.length === 0) header = [...targetFields];

    let dataRows = context.operation === 'REPLACE' ? [] : sheetValues.slice(1);

    const missingColumns = targetFields.filter(
      (f) => !header.some((h) => String(h).toLowerCase() === f.toLowerCase()),
    );
    header = [...header, ...missingColumns];

    const columnIndex = new Map(header.map((h, i) => [String(h).toLowerCase(), i]));
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

    const isInsertOnly = ['CREATE_NEW', 'APPEND', 'REPLACE', 'GENERATE_NEW_VERSION'].includes(context.operation);
    const outcomes: SyncRowOutcome[] = [];
    const updates: Array<{ range: string; values: string[][] }> = [];
    const appends: string[][] = [];

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
        const sheetRowNumber = headerRow + 1 + existingIdx;

        if (!merge.changed) {
          skipped++;
          outcomes.push({ recordId: row.recordId, action: 'skipped', externalRowId: String(sheetRowNumber) });
          continue;
        }

        const raw = [...(dataRows[existingIdx] ?? [])];
        while (raw.length < header.length) raw.push('');
        for (const [field, value] of Object.entries(merge.values)) {
          const idx = columnIndex.get(field.toLowerCase());
          if (idx !== undefined) raw[idx] = stringify(value);
        }
        dataRows[existingIdx] = raw;

        updates.push({
          range: `${worksheetTitle}!A${sheetRowNumber}:${columnLetter(header.length)}${sheetRowNumber}`,
          values: [raw],
        });
        updated++;
        outcomes.push({ recordId: row.recordId, action: 'updated', externalRowId: String(sheetRowNumber) });
        continue;
      }

      if (context.operation === 'UPDATE_EXISTING') {
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
      appends.push(raw);
      const projectedRow = headerRow + 1 + dataRows.length + appends.length - 1;
      dataRows.push(raw);
      if (key) keyIndex.set(key, dataRows.length - 1);
      created++;
      outcomes.push({ recordId: row.recordId, action: 'created', externalRowId: String(projectedRow) });
    }

    const warnings: string[] = [];
    if (mock) {
      warnings.push(
        'Google Sheets is running in mock mode — credentials required to activate this integration. No data was written to Google.',
      );
    }

    if (!mock && !context.dryRun && client) {
      try {
        if (missingColumns.length > 0 || context.operation === 'REPLACE') {
          await client.spreadsheets.values.update({
            spreadsheetId: config.spreadsheetId,
            range: `${worksheetTitle}!A${headerRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [header] },
          });
        }

        if (context.operation === 'REPLACE') {
          await client.spreadsheets.values.clear({
            spreadsheetId: config.spreadsheetId,
            range: `${worksheetTitle}!A${headerRow + 1}:ZZ`,
          });
        }

        if (updates.length > 0) {
          // One batch call rather than N round-trips — Sheets quota is per
          // request, not per cell, and this is the difference between a sync
          // that takes 2 seconds and one that takes 2 minutes.
          await client.spreadsheets.values.batchUpdate({
            spreadsheetId: config.spreadsheetId,
            requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
          });
        }

        if (appends.length > 0) {
          await client.spreadsheets.values.append({
            spreadsheetId: config.spreadsheetId,
            range: `${worksheetTitle}!A${headerRow}`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: appends },
          });
        }
      } catch (err) {
        throw new AppError('SHEETS_FAILED', `Google Sheets rejected the write: ${describe(err)}`, {
          retryable: true,
        });
      }
    }

    log.info('Sheets sync complete', {
      outputId: context.outputId,
      mock,
      created,
      updated,
      skipped,
      failed,
    });

    return {
      status: failed > 0 ? (created + updated > 0 ? 'PARTIAL_SUCCESS' : 'FAILED') : 'SUCCESS',
      created,
      updated,
      skipped,
      failed,
      rows: outcomes,
      recordCount: dataRows.length,
      warnings,
    };
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const googleSheetsConnector = new GoogleSheetsConnector();
