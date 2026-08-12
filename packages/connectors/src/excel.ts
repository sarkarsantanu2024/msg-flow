import ExcelJS from 'exceljs';
import { EXCEL_AT_RISK_FEATURES } from '@msgflow/config';
import { createLogger } from '@msgflow/logger';
import { AppError } from '@msgflow/types';
import type {
  ColumnPreview,
  OutputConnector,
  SyncContext,
  SyncOutcome,
  SyncRow,
  SyncRowOutcome,
  WorkbookPreview,
  WorksheetPreview,
} from '@msgflow/types';
import { buildRowKey, keyFieldsOf, mergeRowValues, normalizeKeyValue } from './mapping.js';
import { buildStorageRef, checksumOf, getStorage } from './storage.js';

const log = createLogger('connector:excel');

/**
 * Excel connector.
 *
 * The central design rule: NEVER rebuild the workbook. We load the existing
 * file, write individual cells, and save. That is what keeps a client's
 * formulas, number formats, merged ranges, named ranges and hidden sheets
 * intact through a sync (spec §125/§126).
 *
 * Features that cannot survive a programmatic write are reported as warnings
 * rather than quietly destroyed — see EXCEL_AT_RISK_FEATURES.
 */

interface SheetIndex {
  worksheet: ExcelJS.Worksheet;
  headerRow: number;
  /** target field name → 1-based column number */
  columns: Map<string, number>;
  /** normalized composite key → 1-based row number */
  keyIndex: Map<string, number>;
  /** first empty row after the last used row */
  nextRow: number;
}

export function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    // Formula cells: prefer the cached result, which is what a human sees.
    if ('result' in v) return cellToString(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('richText' in v && Array.isArray(v.richText)) {
      return (v.richText as Array<{ text: string }>).map((t) => t.text).join('');
    }
    if ('hyperlink' in v) return String(v.text ?? v.hyperlink);
    if ('error' in v) return '';
    return '';
  }
  return String(value);
}

/**
 * Whether a cell carries a formula (its own or a shared one).
 *
 * `cell.formula` covers the owner of a shared formula but not the cells that
 * merely participate in it, so the ValueType check is what actually protects a
 * whole spilled column from being overwritten with static values.
 */
export function isFormulaCell(cell: ExcelJS.Cell): boolean {
  if (cell.type === ExcelJS.ValueType.Formula) return true;
  const raw = cell.value as unknown as Record<string, unknown> | null;
  return Boolean(raw && typeof raw === 'object' && ('formula' in raw || 'sharedFormula' in raw));
}

function inferType(samples: string[]): ColumnPreview['inferredType'] {
  const nonEmpty = samples.filter((s) => s.trim() !== '');
  if (nonEmpty.length === 0) return 'empty';
  if (nonEmpty.every((s) => /^-?[\d,]+(\.\d+)?$/.test(s.trim()))) return 'number';
  if (nonEmpty.every((s) => /^(true|false|yes|no)$/i.test(s.trim()))) return 'boolean';
  if (nonEmpty.every((s) => !Number.isNaN(Date.parse(s)) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s.trim()))) {
    return 'date';
  }
  return 'string';
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

/** Detect features present in a worksheet that a write cannot fully guarantee. */
function detectWarnings(worksheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook): string[] {
  const warnings: string[] = [];

  const merges = (worksheet as unknown as { _merges?: Record<string, unknown> })._merges;
  if (merges && Object.keys(merges).length > 0) {
    warnings.push(
      `This sheet has ${Object.keys(merges).length} merged cell range(s). They are preserved, but new rows are appended below the used range to avoid splitting them.`,
    );
  }

  let formulaCount = 0;
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (isFormulaCell(cell)) formulaCount++;
    });
  });
  if (formulaCount > 0) {
    warnings.push(
      `${formulaCount} formula cell(s) detected. Formulas are preserved; Excel recalculates them when the file is opened.`,
    );
  }

  if (worksheet.state === 'hidden' || worksheet.state === 'veryHidden') {
    warnings.push('This worksheet is hidden. It stays hidden after a sync.');
  }

  const definedNames = (workbook as unknown as { _definedNames?: { model?: unknown[] } })._definedNames;
  if (definedNames?.model && definedNames.model.length > 0) {
    warnings.push(`${definedNames.model.length} named range(s) preserved.`);
  }

  return warnings;
}

/** Read an uploaded workbook and describe it for the mapping UI. */
export async function previewWorkbook(buffer: Buffer, fileName: string): Promise<WorkbookPreview> {
  if (/\.xlsm$/i.test(fileName)) {
    throw new AppError(
      'EXCEL_FAILED',
      'Macro-enabled workbooks (.xlsm) are not supported because macros cannot be preserved. Save the file as .xlsx and upload it again.',
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (err) {
    throw new AppError('EXCEL_FAILED', 'That file could not be read as an Excel workbook.', {
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  const worksheets: WorksheetPreview[] = [];

  workbook.eachSheet((worksheet) => {
    const headerRow = 1;
    const header = worksheet.getRow(headerRow);
    const columnCount = Math.max(worksheet.columnCount, header.cellCount);

    const columns: ColumnPreview[] = [];
    for (let col = 1; col <= columnCount; col++) {
      const headerValue = cellToString(header.getCell(col).value).trim();
      if (!headerValue) continue;

      const samples: string[] = [];
      const lastSampleRow = Math.min(worksheet.rowCount, headerRow + 8);
      for (let r = headerRow + 1; r <= lastSampleRow; r++) {
        samples.push(cellToString(worksheet.getRow(r).getCell(col).value));
      }

      columns.push({
        index: col,
        letter: columnLetter(col),
        header: headerValue,
        sampleValues: samples.filter((s) => s !== '').slice(0, 5),
        inferredType: inferType(samples),
      });
    }

    worksheets.push({
      name: worksheet.name,
      rowCount: Math.max(0, worksheet.rowCount - headerRow),
      columnCount: columns.length,
      columns,
      warnings: detectWarnings(worksheet, workbook),
    });
  });

  if (worksheets.length === 0) {
    throw new AppError('EXCEL_FAILED', 'That workbook has no readable worksheets.');
  }

  return {
    fileName,
    worksheets,
    checksum: checksumOf(buffer),
    sizeBytes: buffer.length,
  };
}

function buildSheetIndex(
  workbook: ExcelJS.Workbook,
  worksheetName: string,
  headerRow: number,
  targetFields: string[],
  keyFields: string[],
  createMissingColumns: boolean,
): SheetIndex {
  let worksheet = workbook.getWorksheet(worksheetName);
  if (!worksheet) {
    worksheet = workbook.addWorksheet(worksheetName);
  }

  const header = worksheet.getRow(headerRow);
  const columns = new Map<string, number>();
  const usedColumns = Math.max(worksheet.columnCount, header.cellCount);

  for (let col = 1; col <= usedColumns; col++) {
    const value = cellToString(header.getCell(col).value).trim();
    if (value) columns.set(value.toLowerCase(), col);
  }

  // Append any mapped column the sheet does not have yet, at the right edge.
  let nextColumn = usedColumns + 1;
  for (const field of targetFields) {
    if (!columns.has(field.toLowerCase())) {
      if (!createMissingColumns) {
        throw new AppError(
          'EXCEL_FAILED',
          `The worksheet "${worksheetName}" has no column named "${field}". Fix the mapping or add the column to the file.`,
        );
      }
      header.getCell(nextColumn).value = field;
      columns.set(field.toLowerCase(), nextColumn);
      nextColumn++;
    }
  }
  header.commit();

  // Index existing rows by their composite key so UPDATE/UPSERT can find them.
  const keyIndex = new Map<string, number>();
  const keyColumns = keyFields
    .map((f) => columns.get(f.toLowerCase()))
    .filter((c): c is number => typeof c === 'number');

  let lastUsedRow = headerRow;
  if (keyColumns.length > 0) {
    for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const parts = keyColumns.map((col) => normalizeKeyValue(cellToString(row.getCell(col).value)));
      const hasAnyValue = parts.some((p) => p !== '');
      if (!hasAnyValue) continue;
      lastUsedRow = r;
      const key = parts.join('|');
      // First occurrence wins — updating the earliest row keeps a stable target
      // when a file already contains accidental duplicates.
      if (!keyIndex.has(key)) keyIndex.set(key, r);
    }
  } else {
    for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      let hasValue = false;
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cellToString(cell.value).trim() !== '') hasValue = true;
      });
      if (hasValue) lastUsedRow = r;
    }
  }

  return { worksheet, headerRow, columns, keyIndex, nextRow: lastUsedRow + 1 };
}

function readRowValues(index: SheetIndex, rowNumber: number, fields: string[]): Record<string, unknown> {
  const row = index.worksheet.getRow(rowNumber);
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const col = index.columns.get(field.toLowerCase());
    values[field] = col ? cellToString(row.getCell(col).value) : '';
  }
  return values;
}

function writeRowValues(index: SheetIndex, rowNumber: number, values: Record<string, unknown>): void {
  const row = index.worksheet.getRow(rowNumber);
  for (const [field, value] of Object.entries(values)) {
    const col = index.columns.get(field.toLowerCase());
    if (!col) continue;
    const cell = row.getCell(col);
    // Writing a formula cell would destroy the formula. The user's spreadsheet
    // logic outranks our data — skip and report it instead.
    if (isFormulaCell(cell)) continue;
    cell.value = toCellValue(value);
  }
  row.commit();
}

function toCellValue(value: unknown): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const str = String(value);
  // ISO dates become real Excel dates so date filters and formats work.
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(`${str}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return str;
}

export class ExcelConnector implements OutputConnector {
  readonly type = 'EXCEL';

  isConfigured(): boolean {
    // File outputs need no credentials — the storage driver is always present.
    return true;
  }

  async fingerprint(context: SyncContext): Promise<{ checksum: string | null; modifiedAt: Date | null }> {
    const ref = context.config.storageRef as string | undefined;
    if (!ref) return { checksum: null, modifiedAt: null };
    const info = await getStorage().stat(ref);
    return info ? { checksum: info.checksum, modifiedAt: info.modifiedAt } : { checksum: null, modifiedAt: null };
  }

  async sync(rows: SyncRow[], context: SyncContext): Promise<SyncOutcome> {
    const storage = getStorage();
    const config = context.config as {
      storageRef?: string;
      fileName?: string;
      worksheet?: string;
      headerRow?: number;
    };

    const worksheetName = config.worksheet || 'Sheet1';
    const headerRow = config.headerRow ?? 1;
    const fileName = config.fileName || 'output.xlsx';
    const operation = context.operation;

    const outcomes: SyncRowOutcome[] = [];
    const warnings: string[] = [];

    const workbook = new ExcelJS.Workbook();
    let existingBuffer: Buffer | null = null;

    const wantsExistingFile =
      operation !== 'CREATE_NEW' && operation !== 'GENERATE_NEW_VERSION' && Boolean(config.storageRef);

    if (config.storageRef && (await storage.exists(config.storageRef))) {
      existingBuffer = await storage.read(config.storageRef);

      // Conflict detection: if the file changed since our last sync, refuse to
      // write. Overwriting a customer's manual edits is the one failure mode we
      // cannot undo from their point of view.
      const actualChecksum = checksumOf(existingBuffer);
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
          conflict: {
            expectedChecksum: context.lastKnownChecksum,
            actualChecksum,
            detail: { fileName, worksheet: worksheetName },
          },
        };
      }

      try {
        await workbook.xlsx.load(existingBuffer as unknown as ArrayBuffer);
      } catch (err) {
        throw new AppError('EXCEL_FAILED', 'The existing workbook could not be opened.', {
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (wantsExistingFile) {
      warnings.push(
        `No existing file was found for this output, so a new workbook was created and rows were inserted.`,
      );
    }

    const keyMappings = keyFieldsOf(context.mappings);
    const keyFields = keyMappings.map((m) => m.targetField);
    const targetFields = context.mappings.map((m) => m.targetField);

    if (['UPDATE_EXISTING', 'UPSERT'].includes(operation) && keyFields.length === 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${operation} needs at least one field marked as part of the unique key.`,
      );
    }

    // REPLACE regenerates the dataset: clear data rows, keep the header,
    // formatting and every other sheet untouched.
    if (operation === 'REPLACE') {
      const existing = workbook.getWorksheet(worksheetName);
      if (existing) {
        for (let r = existing.rowCount; r > headerRow; r--) {
          existing.spliceRows(r, 1);
        }
        warnings.push('REPLACE cleared the existing data rows in this worksheet before writing.');
      }
    }

    const index = buildSheetIndex(workbook, worksheetName, headerRow, targetFields, keyFields, true);

    const isInsertOnly = ['CREATE_NEW', 'APPEND', 'REPLACE', 'GENERATE_NEW_VERSION'].includes(operation);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let formulaSkips = 0;

    for (const row of rows) {
      try {
        const key = keyFields.length > 0 ? buildRowKey(row.values, keyMappings) : '';
        const existingRowNumber =
          !isInsertOnly && key ? (index.keyIndex.get(key) ?? matchByStoredRow(index, row, headerRow)) : undefined;

        if (existingRowNumber) {
          const currentValues = readRowValues(index, existingRowNumber, targetFields);
          const merge = mergeRowValues(currentValues, row.values, context.mappings, {
            incomingUpdatedAt: row.updatedAt,
            existingUpdatedAt: readRowTimestamp(currentValues),
          });

          if (!merge.changed) {
            skipped++;
            outcomes.push({
              recordId: row.recordId,
              action: 'skipped',
              externalRowId: String(existingRowNumber),
              reason:
                merge.skippedFields.length > 0
                  ? `No change after update strategies (held back: ${merge.skippedFields.join(', ')})`
                  : 'Row already matches',
            });
            continue;
          }

          if (!context.dryRun) {
            const before = countFormulaCells(index, existingRowNumber, targetFields);
            writeRowValues(index, existingRowNumber, merge.values);
            formulaSkips += before;
          }
          updated++;
          outcomes.push({ recordId: row.recordId, action: 'updated', externalRowId: String(existingRowNumber) });
          continue;
        }

        if (operation === 'UPDATE_EXISTING') {
          failed++;
          outcomes.push({
            recordId: row.recordId,
            action: 'failed',
            error: `No existing row matched the key "${key}". UPDATE_EXISTING does not insert new rows.`,
          });
          continue;
        }

        const rowNumber = index.nextRow;
        if (!context.dryRun) writeRowValues(index, rowNumber, row.values);
        if (key) index.keyIndex.set(key, rowNumber);
        index.nextRow++;
        created++;
        outcomes.push({ recordId: row.recordId, action: 'created', externalRowId: String(rowNumber) });
      } catch (err) {
        failed++;
        outcomes.push({
          recordId: row.recordId,
          action: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (formulaSkips > 0) {
      warnings.push(
        `${formulaSkips} cell(s) contained formulas and were left untouched. MsgFlow never overwrites a formula with a value.`,
      );
    }
    if (existingBuffer) {
      warnings.push(...EXCEL_AT_RISK_FEATURES.map((f) => `Not guaranteed: ${f}`).slice(0, 2));
    }

    if (context.dryRun) {
      return {
        status: failed > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
        created,
        updated,
        skipped,
        failed,
        rows: outcomes,
        warnings,
        recordCount: index.nextRow - headerRow - 1,
      };
    }

    let buffer: Buffer;
    try {
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      buffer = Buffer.from(arrayBuffer as ArrayBuffer);
    } catch (err) {
      throw new AppError('EXCEL_FAILED', 'The workbook could not be saved. The previous file is unchanged.', {
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // GENERATE_NEW_VERSION and CREATE_NEW always land on a fresh ref so the
    // previous file stays downloadable.
    const shouldCreateNewRef =
      !config.storageRef || operation === 'CREATE_NEW' || operation === 'GENERATE_NEW_VERSION';
    const targetRef = shouldCreateNewRef
      ? buildStorageRef(context.tenantId, 'outputs', fileName)
      : config.storageRef!;

    const stored = await storage.write(targetRef, buffer);

    log.info('Excel sync complete', {
      outputId: context.outputId,
      operation,
      created,
      updated,
      skipped,
      failed,
      storageRef: stored.storageRef,
    });

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
      recordCount: index.nextRow - headerRow - 1,
      warnings,
    };
  }
}

/**
 * Fall back to the row number recorded at the last sync when the key lookup
 * misses — a user renaming a customer should not orphan the row we own.
 */
function matchByStoredRow(index: SheetIndex, row: SyncRow, headerRow: number): number | undefined {
  if (!row.externalRowId) return undefined;
  const rowNumber = Number(row.externalRowId);
  if (!Number.isInteger(rowNumber) || rowNumber <= headerRow) return undefined;
  if (rowNumber > index.worksheet.rowCount) return undefined;
  return rowNumber;
}

function countFormulaCells(index: SheetIndex, rowNumber: number, fields: string[]): number {
  const row = index.worksheet.getRow(rowNumber);
  let count = 0;
  for (const field of fields) {
    const col = index.columns.get(field.toLowerCase());
    if (!col) continue;
    const cell = row.getCell(col);
    if (isFormulaCell(cell)) count++;
  }
  return count;
}

/** Look for a conventional "updated at" column to support UPDATE_IF_NEWER. */
function readRowTimestamp(values: Record<string, unknown>): Date | null {
  for (const [key, value] of Object.entries(values)) {
    if (!/updated|modified|last\s*sync/i.test(key)) continue;
    const parsed = new Date(String(value));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export const excelConnector = new ExcelConnector();
