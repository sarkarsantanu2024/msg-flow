import { describe, expect, it } from 'vitest';
import {
  buildNaturalKey,
  buildRecordSchema,
  normalizeKeyPart,
  validateRecordData,
  loginSchema,
  signupSchema,
  outputTargetWithKeyRule,
  automationSchema,
} from '@msgflow/validation';
import type { ExtractionFieldSpec } from '@msgflow/types';

const SALES_FIELDS: ExtractionFieldSpec[] = [
  { key: 'date', label: 'Date', type: 'DATE', required: true },
  { key: 'customerName', label: 'Customer', type: 'STRING', required: true },
  { key: 'product', label: 'Product', type: 'STRING', required: true },
  { key: 'quantity', label: 'Quantity', type: 'DECIMAL', required: false },
  { key: 'rate', label: 'Rate', type: 'CURRENCY', required: false },
  { key: 'status', label: 'Status', type: 'ENUM', required: false, enumValues: ['New', 'Confirmed', 'Cancelled'] },
];

describe('dynamic record validation', () => {
  it('accepts a well-formed record', () => {
    const result = validateRecordData(SALES_FIELDS, {
      date: '2026-08-12',
      customerName: 'ABC Traders',
      product: 'Product X',
      quantity: 50,
      rate: 250,
    });

    expect(result.valid).toBe(true);
    expect(result.data.quantity).toBe(50);
  });

  it('rejects a record missing a required field', () => {
    const result = validateRecordData(SALES_FIELDS, { date: '2026-08-12', product: 'Product X' });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'customerName')).toBe(true);
  });

  it('coerces the currency and unit forms real messages use', () => {
    const result = validateRecordData(SALES_FIELDS, {
      date: '2026-08-12',
      customerName: 'ABC Traders',
      product: 'Product X',
      quantity: '50 kg',
      rate: '₹1,250.50',
    });

    expect(result.valid).toBe(true);
    expect(result.data.quantity).toBe(50);
    expect(result.data.rate).toBe(1250.5);
  });

  it('scales k / lakh / crore shorthand', () => {
    const fields: ExtractionFieldSpec[] = [{ key: 'amount', label: 'Amount', type: 'DECIMAL', required: true }];

    expect(validateRecordData(fields, { amount: '2.5k' }).data.amount).toBe(2500);
    expect(validateRecordData(fields, { amount: '3 lakh' }).data.amount).toBe(300_000);
    expect(validateRecordData(fields, { amount: '1.2 cr' }).data.amount).toBe(12_000_000);
  });

  it('reads dd/mm/yyyy as day-first, not month-first', () => {
    // 05/08 is 5 August in Indian business usage. Date.parse would say 8 May.
    const result = validateRecordData(SALES_FIELDS, {
      date: '05/08/2026',
      customerName: 'ABC',
      product: 'X',
    });

    expect(result.valid).toBe(true);
    expect(result.data.date).toBe('2026-08-05');
  });

  it('matches enum values case-insensitively', () => {
    const result = validateRecordData(SALES_FIELDS, {
      date: '2026-08-12',
      customerName: 'ABC',
      product: 'X',
      status: 'confirmed',
    });

    expect(result.valid).toBe(true);
    expect(result.data.status).toBe('Confirmed');
  });

  it('treats empty strings on optional fields as absent, not invalid', () => {
    const result = validateRecordData(SALES_FIELDS, {
      date: '2026-08-12',
      customerName: 'ABC',
      product: 'X',
      quantity: '',
    });

    expect(result.valid).toBe(true);
    expect(result.data.quantity).toBeUndefined();
  });

  it('drops unknown keys rather than failing the whole extraction', () => {
    const schema = buildRecordSchema(SALES_FIELDS);
    const parsed = schema.parse({
      date: '2026-08-12',
      customerName: 'ABC',
      product: 'X',
      somethingTheModelInvented: 'noise',
    });

    expect(parsed).not.toHaveProperty('somethingTheModelInvented');
  });
});

describe('natural keys', () => {
  it('treats case and whitespace variants as the same entity', () => {
    const a = buildNaturalKey({ customerName: 'ABC Traders', product: 'Product X' }, ['customerName', 'product']);
    const b = buildNaturalKey({ customerName: 'abc  traders', product: 'PRODUCT X' }, ['customerName', 'product']);

    expect(a).toBe(b);
  });

  it('collapses an ISO datetime to its date', () => {
    expect(normalizeKeyPart('2026-08-12T14:30:00.000Z')).toBe('2026-08-12');
  });

  it('distinguishes genuinely different records', () => {
    const a = buildNaturalKey({ customerName: 'ABC Traders', product: 'Product X' }, ['customerName', 'product']);
    const b = buildNaturalKey({ customerName: 'ABC Traders', product: 'Product Y' }, ['customerName', 'product']);

    expect(a).not.toBe(b);
  });
});

describe('auth schemas', () => {
  it('requires a password of at least 10 characters', () => {
    expect(signupSchema.safeParse({
      name: 'Test User',
      email: 'test@example.com',
      password: 'short',
      organizationName: 'Test Co',
    }).success).toBe(false);
  });

  it('normalises email casing and whitespace', () => {
    const result = loginSchema.parse({ email: '  Test@Example.COM ', password: 'anything' });
    expect(result.email).toBe('test@example.com');
  });
});

describe('output target rules', () => {
  const base = {
    automationId: 'auto1',
    outputId: 'out1',
    enabled: true,
    order: 0,
    config: {},
    mappings: [
      { sourceField: 'customerName', targetField: 'Customer', updateStrategy: 'ALWAYS_UPDATE' as const, transform: {}, isKeyPart: false, order: 0 },
    ],
  };

  it('rejects UPSERT without a unique key', () => {
    const result = outputTargetWithKeyRule.safeParse({ ...base, operation: 'UPSERT' });
    expect(result.success).toBe(false);
  });

  it('rejects UPDATE_EXISTING without a unique key', () => {
    const result = outputTargetWithKeyRule.safeParse({ ...base, operation: 'UPDATE_EXISTING' });
    expect(result.success).toBe(false);
  });

  it('allows APPEND without a unique key', () => {
    const result = outputTargetWithKeyRule.safeParse({ ...base, operation: 'APPEND' });
    expect(result.success).toBe(true);
  });

  it('allows UPSERT once a key is declared', () => {
    const result = outputTargetWithKeyRule.safeParse({
      ...base,
      operation: 'UPSERT',
      mappings: [{ ...base.mappings[0], isKeyPart: true, keyOrder: 0 }],
    });
    expect(result.success).toBe(true);
  });
});

describe('automation schema', () => {
  it('requires at least one source group', () => {
    const result = automationSchema.safeParse({
      name: 'Test',
      groupIds: [],
      schemaId: 'schema1',
    });
    expect(result.success).toBe(false);
  });

  it('requires both dates for a custom range', () => {
    const result = automationSchema.safeParse({
      name: 'Test',
      groupIds: ['g1'],
      schemaId: 'schema1',
      dateRangeMode: 'CUSTOM',
    });
    expect(result.success).toBe(false);
  });

  it('requires a cron expression for custom scheduling', () => {
    const result = automationSchema.safeParse({
      name: 'Test',
      groupIds: ['g1'],
      schemaId: 'schema1',
      processingMode: 'CUSTOM',
    });
    expect(result.success).toBe(false);
  });
});
