import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  ExcelConnector,
  previewWorkbook,
  cellToString,
  setStorageDriver,
  type StorageDriver,
} from '@msgflow/connectors';
import { createHash } from 'node:crypto';
import type { MappingSpec, SyncContext, SyncRow } from '@msgflow/types';

/**
 * Excel connector tests against real workbooks held in memory.
 *
 * The point of this suite is the promise the product makes about existing
 * files: UPSERT finds the right row, formulas survive, and a file edited
 * outside MsgFlow is never silently overwritten.
 */

class MemoryStorage implements StorageDriver {
  files = new Map<string, Buffer>();

  async read(ref: string) {
    const data = this.files.get(ref);
    if (!data) throw new Error(`Missing ${ref}`);
    return data;
  }

  async write(ref: string, data: Buffer) {
    this.files.set(ref, data);
    return {
      storageRef: ref,
      checksum: createHash('sha256').update(data).digest('hex'),
      sizeBytes: data.length,
      modifiedAt: new Date(),
    };
  }

  async exists(ref: string) {
    return this.files.has(ref);
  }

  async remove(ref: string) {
    this.files.delete(ref);
  }

  async stat(ref: string) {
    const data = this.files.get(ref);
    if (!data) return null;
    return {
      checksum: createHash('sha256').update(data).digest('hex'),
      sizeBytes: data.length,
      modifiedAt: new Date(),
    };
  }
}

let storage: MemoryStorage;
const connector = new ExcelConnector();

const MAPPINGS: MappingSpec[] = [
  { sourceField: 'customerName', targetField: 'Customer', updateStrategy: 'NEVER_UPDATE', transform: {}, isKeyPart: true, keyOrder: 0 },
  { sourceField: 'product', targetField: 'Product', updateStrategy: 'NEVER_UPDATE', transform: {}, isKeyPart: true, keyOrder: 1 },
  { sourceField: 'quantity', targetField: 'Quantity', updateStrategy: 'ALWAYS_UPDATE', transform: {}, isKeyPart: false },
  { sourceField: 'rate', targetField: 'Rate', updateStrategy: 'ALWAYS_UPDATE', transform: {}, isKeyPart: false },
  { sourceField: 'notes', targetField: 'Notes', updateStrategy: 'UPDATE_IF_EMPTY', transform: {}, isKeyPart: false },
];

async function buildExistingWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sales');

  sheet.addRow(['Customer', 'Product', 'Quantity', 'Rate', 'Notes', 'Total']);
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(['ABC Traders', 'Product X', 20, 250, 'Regular customer', null]);
  sheet.addRow(['XYZ Ltd', 'Product Y', 10, 180, '', null]);

  // A formula column: the connector must never overwrite these with values.
  sheet.getCell('F2').value = { formula: 'C2*D2', result: 5000 };
  sheet.getCell('F3').value = { formula: 'C3*D3', result: 1800 };

  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

function row(overrides: Partial<SyncRow> & { values: Record<string, unknown> }): SyncRow {
  return {
    recordId: overrides.recordId ?? 'rec1',
    keyValue: overrides.keyValue ?? '',
    externalRowId: overrides.externalRowId ?? null,
    version: overrides.version ?? 1,
    updatedAt: overrides.updatedAt ?? new Date(),
    values: overrides.values,
  };
}

function context(overrides: Partial<SyncContext> = {}): SyncContext {
  return {
    tenantId: 'tenant1',
    outputId: 'output1',
    operation: 'UPSERT',
    mappings: MAPPINGS,
    config: { storageRef: 'existing.xlsx', worksheet: 'Sales', headerRow: 1, fileName: 'sales.xlsx' },
    ...overrides,
  };
}

async function readBack(ref: string): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await storage.read(ref)) as unknown as ArrayBuffer);
  return workbook.getWorksheet('Sales')!;
}

beforeEach(async () => {
  storage = new MemoryStorage();
  setStorageDriver(storage);
  await storage.write('existing.xlsx', await buildExistingWorkbook());
});

describe('workbook preview', () => {
  it('reads real worksheets, columns and sample values', async () => {
    const preview = await previewWorkbook(await storage.read('existing.xlsx'), 'sales.xlsx');

    expect(preview.worksheets).toHaveLength(1);
    const sheet = preview.worksheets[0];
    expect(sheet.name).toBe('Sales');
    expect(sheet.columns.map((c) => c.header)).toEqual(['Customer', 'Product', 'Quantity', 'Rate', 'Notes', 'Total']);
    expect(sheet.rowCount).toBe(2);
    expect(sheet.columns[0].sampleValues).toContain('ABC Traders');
  });

  it('warns that the sheet contains formulas', async () => {
    const preview = await previewWorkbook(await storage.read('existing.xlsx'), 'sales.xlsx');
    expect(preview.worksheets[0].warnings.join(' ')).toMatch(/formula/i);
  });

  it('refuses macro-enabled workbooks rather than silently dropping macros', async () => {
    await expect(previewWorkbook(await storage.read('existing.xlsx'), 'book.xlsm')).rejects.toThrow(/xlsm|macro/i);
  });
});

describe('UPSERT against an existing workbook', () => {
  it('updates the matching row instead of appending a duplicate', async () => {
    const outcome = await connector.sync(
      [row({ values: { Customer: 'ABC Traders', Product: 'Product X', Quantity: 75, Rate: 260, Notes: 'Updated' } })],
      context(),
    );

    expect(outcome.status).toBe('SUCCESS');
    expect(outcome.updated).toBe(1);
    expect(outcome.created).toBe(0);

    const sheet = await readBack('existing.xlsx');
    expect(sheet.rowCount).toBe(3); // header + 2 rows, unchanged
    expect(cellToString(sheet.getCell('C2').value)).toBe('75');
    expect(cellToString(sheet.getCell('D2').value)).toBe('260');
  });

  it('inserts when no row matches the key', async () => {
    const outcome = await connector.sync(
      [row({ values: { Customer: 'New Corp', Product: 'Product Z', Quantity: 5, Rate: 99, Notes: '' } })],
      context(),
    );

    expect(outcome.created).toBe(1);
    expect(outcome.updated).toBe(0);

    const sheet = await readBack('existing.xlsx');
    expect(cellToString(sheet.getCell('A4').value)).toBe('New Corp');
  });

  it('matches keys case-insensitively', async () => {
    const outcome = await connector.sync(
      [row({ values: { Customer: 'abc  traders', Product: 'PRODUCT X', Quantity: 99, Rate: 250, Notes: '' } })],
      context(),
    );

    expect(outcome.updated).toBe(1);
    expect(outcome.created).toBe(0);
  });

  it('never overwrites a formula cell with a value', async () => {
    const mappingsWithTotal: MappingSpec[] = [
      ...MAPPINGS,
      { sourceField: 'total', targetField: 'Total', updateStrategy: 'ALWAYS_UPDATE', transform: {}, isKeyPart: false },
    ];

    await connector.sync(
      [
        row({
          values: { Customer: 'ABC Traders', Product: 'Product X', Quantity: 75, Rate: 260, Notes: '', Total: 999 },
        }),
      ],
      context({ mappings: mappingsWithTotal }),
    );

    const sheet = await readBack('existing.xlsx');
    const cell = sheet.getCell('F2');
    expect((cell.value as { formula?: string })?.formula).toBe('C2*D2');
  });

  it('honours NEVER_UPDATE and UPDATE_IF_EMPTY', async () => {
    await connector.sync(
      [
        row({
          values: {
            Customer: 'ABC Traders',
            Product: 'Product X',
            Quantity: 30,
            Rate: 250,
            // Notes already has "Regular customer"; UPDATE_IF_EMPTY must not touch it.
            Notes: 'Should not overwrite',
          },
        }),
      ],
      context(),
    );

    const sheet = await readBack('existing.xlsx');
    expect(cellToString(sheet.getCell('E2').value)).toBe('Regular customer');
    expect(cellToString(sheet.getCell('C2').value)).toBe('30');
  });

  it('reports no change as skipped rather than a spurious update', async () => {
    const outcome = await connector.sync(
      [row({ values: { Customer: 'ABC Traders', Product: 'Product X', Quantity: 20, Rate: 250, Notes: '' } })],
      context(),
    );

    expect(outcome.skipped).toBe(1);
    expect(outcome.updated).toBe(0);
  });
});

describe('other operations', () => {
  it('APPEND always inserts, even for an existing key', async () => {
    const outcome = await connector.sync(
      [row({ values: { Customer: 'ABC Traders', Product: 'Product X', Quantity: 5, Rate: 250, Notes: '' } })],
      context({ operation: 'APPEND' }),
    );

    expect(outcome.created).toBe(1);
    const sheet = await readBack('existing.xlsx');
    expect(sheet.rowCount).toBe(4);
  });

  it('UPDATE_EXISTING fails unmatched rows instead of inserting them', async () => {
    const outcome = await connector.sync(
      [row({ values: { Customer: 'Nobody', Product: 'Nothing', Quantity: 1, Rate: 1, Notes: '' } })],
      context({ operation: 'UPDATE_EXISTING' }),
    );

    expect(outcome.failed).toBe(1);
    expect(outcome.created).toBe(0);
    expect(outcome.rows[0].error).toMatch(/no existing row/i);
  });

  it('REPLACE clears the data rows but keeps the header', async () => {
    const outcome = await connector.sync(
      [row({ values: { Customer: 'Fresh Co', Product: 'Product A', Quantity: 1, Rate: 10, Notes: '' } })],
      context({ operation: 'REPLACE' }),
    );

    expect(outcome.created).toBe(1);
    const sheet = await readBack('existing.xlsx');
    expect(cellToString(sheet.getCell('A1').value)).toBe('Customer');
    expect(cellToString(sheet.getCell('A2').value)).toBe('Fresh Co');
    expect(sheet.rowCount).toBe(2);
  });

  it('GENERATE_NEW_VERSION writes a new file and leaves the original alone', async () => {
    const before = await storage.read('existing.xlsx');

    const outcome = await connector.sync(
      [row({ values: { Customer: 'Version Co', Product: 'Product V', Quantity: 1, Rate: 10, Notes: '' } })],
      context({ operation: 'GENERATE_NEW_VERSION' }),
    );

    expect(outcome.storageRef).not.toBe('existing.xlsx');
    expect(await storage.read('existing.xlsx')).toEqual(before);
  });

  it('creates a workbook when none exists yet', async () => {
    const outcome = await connector.sync(
      [row({ values: { Customer: 'First Co', Product: 'Product A', Quantity: 1, Rate: 10, Notes: '' } })],
      context({ operation: 'CREATE_NEW', config: { fileName: 'brand-new.xlsx', worksheet: 'Sales', headerRow: 1 } }),
    );

    expect(outcome.status).toBe('SUCCESS');
    expect(outcome.created).toBe(1);
    expect(outcome.storageRef).toBeDefined();
  });
});

describe('conflict detection', () => {
  it('refuses to write when the file changed since the last sync', async () => {
    const outcome = await connector.sync(
      [row({ values: { Customer: 'ABC Traders', Product: 'Product X', Quantity: 99, Rate: 250, Notes: '' } })],
      context({ lastKnownChecksum: 'a-checksum-from-a-previous-version' }),
    );

    expect(outcome.status).toBe('CONFLICT');
    expect(outcome.conflict?.expectedChecksum).toBe('a-checksum-from-a-previous-version');

    // Crucially, nothing was written.
    const sheet = await readBack('existing.xlsx');
    expect(cellToString(sheet.getCell('C2').value)).toBe('20');
  });

  it('proceeds when the checksum still matches', async () => {
    const info = await storage.stat('existing.xlsx');
    const outcome = await connector.sync(
      [row({ values: { Customer: 'ABC Traders', Product: 'Product X', Quantity: 99, Rate: 250, Notes: '' } })],
      context({ lastKnownChecksum: info!.checksum }),
    );

    expect(outcome.status).toBe('SUCCESS');
    expect(outcome.updated).toBe(1);
  });
});

describe('dry run', () => {
  it('reports what would happen without writing', async () => {
    const before = await storage.read('existing.xlsx');

    const outcome = await connector.sync(
      [row({ values: { Customer: 'ABC Traders', Product: 'Product X', Quantity: 500, Rate: 250, Notes: '' } })],
      context({ dryRun: true }),
    );

    expect(outcome.updated).toBe(1);
    expect(await storage.read('existing.xlsx')).toEqual(before);
  });
});

describe('validation', () => {
  it('rejects UPSERT with no key mapping', async () => {
    const noKeys = MAPPINGS.map((m) => ({ ...m, isKeyPart: false }));
    await expect(
      connector.sync([row({ values: { Customer: 'A', Product: 'B' } })], context({ mappings: noKeys })),
    ).rejects.toThrow(/unique key/i);
  });
});
