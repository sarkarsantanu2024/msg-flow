import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { MockProvider, parseJsonResponse, normalizeConfidence, estimateCostUsd } from '@msgflow/ai';
import {
  buildRowKey,
  evaluateCondition,
  keyFieldsOf,
  mapRecordToTarget,
  mergeRowValues,
  interpolatePath,
  applyTransform,
  signPayload,
  parseCsv,
  toCsv,
  readPath,
  operationSupported,
} from '@msgflow/connectors';
import { roleHasPermission, permissionsForRole, assertTenantOwned } from '@msgflow/db';
import type { MappingSpec, ExtractionFieldSpec } from '@msgflow/types';

describe('message deduplication', () => {
  /** Mirrors the hash the ingest route computes. */
  function contentHash(group: string, sender: string, timestamp: number, text: string) {
    return createHash('sha256').update(`${group}|${sender}|${timestamp}|${text}`).digest('hex');
  }

  it('produces the same hash for a redelivered message', () => {
    const a = contentHash('g1@g.us', 's1@c.us', 1_760_000_000_000, 'ABC Traders need 50 kg');
    const b = contentHash('g1@g.us', 's1@c.us', 1_760_000_000_000, 'ABC Traders need 50 kg');
    expect(a).toBe(b);
  });

  it('distinguishes the same text sent twice at different times', () => {
    const a = contentHash('g1@g.us', 's1@c.us', 1_760_000_000_000, 'ok');
    const b = contentHash('g1@g.us', 's1@c.us', 1_760_000_060_000, 'ok');
    expect(a).not.toBe(b);
  });

  it('distinguishes identical text from different senders', () => {
    const a = contentHash('g1@g.us', 's1@c.us', 1_760_000_000_000, 'ok');
    const b = contentHash('g1@g.us', 's2@c.us', 1_760_000_000_000, 'ok');
    expect(a).not.toBe(b);
  });
});

describe('AI classification (mock provider)', () => {
  const provider = new MockProvider();

  it('ignores greetings and acknowledgements', async () => {
    for (const text of ['Good morning', 'thanks', 'ok', '👍']) {
      const result = await provider.classifyMessage({ text });
      expect(result.data.category).toBe('IGNORE');
      expect(result.data.importance).toBe('IGNORE');
    }
  });

  it('classifies a sales enquiry and pulls out entities', async () => {
    const result = await provider.classifyMessage({
      text: 'ABC Traders require 50 kg Product X at ₹250/kg. Delivery by 15/08.',
    });

    expect(['SALES', 'ORDER']).toContain(result.data.category);
    expect(result.data.importance).toBe('HIGH');
    expect(result.data.entities.quantity).toBe(50);
    expect(result.data.entities.rate).toBe(250);
  });

  it('classifies a stock update as inventory', async () => {
    const result = await provider.classifyMessage({ text: 'Stock update: Product ABC is now 75 units.' });
    expect(result.data.category).toBe('INVENTORY');
  });

  it('never claims a confidence outside 0..1', async () => {
    const result = await provider.classifyMessage({ text: 'ABC Traders ordered 50 kg Product X' });
    expect(result.data.confidence).toBeGreaterThanOrEqual(0);
    expect(result.data.confidence).toBeLessThanOrEqual(1);
  });
});

describe('AI extraction (mock provider)', () => {
  const provider = new MockProvider();

  const fields: ExtractionFieldSpec[] = [
    { key: 'date', label: 'Date', type: 'DATE', required: false },
    { key: 'customerName', label: 'Customer', type: 'STRING', required: true },
    { key: 'product', label: 'Product', type: 'STRING', required: false },
    { key: 'quantity', label: 'Quantity', type: 'DECIMAL', required: false },
    { key: 'rate', label: 'Rate', type: 'CURRENCY', required: false },
  ];

  it('extracts the fields a real message contains', async () => {
    const result = await provider.extractStructuredData({
      text: 'ABC Traders require 50 kg Product X at ₹250/kg.',
      fields,
      schemaName: 'Sales Enquiry',
    });

    expect(result.data.records).toHaveLength(1);
    const data = result.data.records[0].data;
    expect(data.customerName).toBe('ABC Traders');
    expect(data.quantity).toBe(50);
    expect(data.rate).toBe(250);
  });

  it('returns nothing when a required field cannot be found', async () => {
    const result = await provider.extractStructuredData({
      text: 'ok noted thanks',
      fields,
      schemaName: 'Sales Enquiry',
    });

    expect(result.data.records).toHaveLength(0);
    expect(result.data.confidence).toBe(0);
  });

  it('never invents fields that were not requested', async () => {
    const result = await provider.extractStructuredData({
      text: 'ABC Traders require 50 kg Product X',
      fields: [{ key: 'customerName', label: 'Customer', type: 'STRING', required: true }],
      schemaName: 'Minimal',
    });

    expect(Object.keys(result.data.records[0].data)).toEqual(['customerName']);
  });
});

describe('AI response parsing', () => {
  it('extracts JSON from a fenced code block', () => {
    const parsed = parseJsonResponse<{ a: number }>('Here you go:\n```json\n{"a": 1}\n```\nHope that helps.');
    expect(parsed.a).toBe(1);
  });

  it('recovers from trailing commas', () => {
    const parsed = parseJsonResponse<{ a: number }>('{"a": 1,}');
    expect(parsed.a).toBe(1);
  });

  it('finds a balanced object inside surrounding prose', () => {
    const parsed = parseJsonResponse<{ ok: boolean }>('Sure! {"ok": true} — done.');
    expect(parsed.ok).toBe(true);
  });

  it('throws on genuinely unparseable output', () => {
    expect(() => parseJsonResponse('no json here at all')).toThrow();
  });

  it('rescales a percentage-style confidence', () => {
    expect(normalizeConfidence(85)).toBe(0.85);
    expect(normalizeConfidence(0.85)).toBe(0.85);
    expect(normalizeConfidence('nonsense')).toBe(0.5);
    expect(normalizeConfidence(-5)).toBe(0);
  });

  it('estimates cost from token counts', () => {
    expect(estimateCostUsd('claude-sonnet-5', 1_000_000, 0)).toBeCloseTo(3, 5);
    expect(estimateCostUsd('unknown-model', 0, 0)).toBe(0);
  });
});

describe('mapping and update strategies', () => {
  const mappings: MappingSpec[] = [
    { sourceField: 'customerName', targetField: 'Customer', updateStrategy: 'NEVER_UPDATE', transform: {}, isKeyPart: true, keyOrder: 0 },
    { sourceField: 'quantity', targetField: 'Qty', updateStrategy: 'ALWAYS_UPDATE', transform: {}, isKeyPart: false },
    { sourceField: 'notes', targetField: 'Notes', updateStrategy: 'UPDATE_IF_EMPTY', transform: {}, isKeyPart: false },
    { sourceField: 'owner', targetField: 'Owner', updateStrategy: 'NEVER_UPDATE', transform: {}, isKeyPart: false },
  ];

  it('maps record fields to target columns', () => {
    const values = mapRecordToTarget({ customerName: 'ABC', quantity: 5, notes: 'hi', owner: 'R' }, mappings);
    expect(values).toEqual({ Customer: 'ABC', Qty: 5, Notes: 'hi', Owner: 'R' });
  });

  it('falls back to the default value when a field is absent', () => {
    const withDefault: MappingSpec[] = [
      { sourceField: 'status', targetField: 'Status', updateStrategy: 'ALWAYS_UPDATE', transform: {}, defaultValue: 'New', isKeyPart: false },
    ];
    expect(mapRecordToTarget({}, withDefault).Status).toBe('New');
  });

  it('ALWAYS_UPDATE overwrites', () => {
    const result = mergeRowValues({ Qty: 10 }, { Qty: 20 }, mappings);
    expect(result.values.Qty).toBe(20);
    expect(result.changed).toBe(true);
  });

  it('NEVER_UPDATE holds the existing value', () => {
    const result = mergeRowValues({ Owner: 'Original' }, { Owner: 'New' }, mappings);
    expect(result.values.Owner).toBe('Original');
    expect(result.skippedFields).toContain('Owner');
  });

  it('UPDATE_IF_EMPTY fills a blank but not a filled value', () => {
    expect(mergeRowValues({ Notes: '' }, { Notes: 'filled' }, mappings).values.Notes).toBe('filled');
    expect(mergeRowValues({ Notes: 'existing' }, { Notes: 'new' }, mappings).values.Notes).toBe('existing');
  });

  it('never blanks an existing value with an empty extraction', () => {
    const result = mergeRowValues({ Qty: 10 }, { Qty: '' }, mappings);
    expect(result.values.Qty).toBe(10);
    expect(result.changed).toBe(false);
  });

  it('never rewrites key fields', () => {
    const result = mergeRowValues({ Customer: 'ABC' }, { Customer: 'Changed' }, mappings);
    expect(result.values.Customer).toBe('ABC');
  });

  it('UPDATE_IF_NEWER refuses when the existing timestamp is unknown', () => {
    const strategy: MappingSpec[] = [
      { sourceField: 'q', targetField: 'Q', updateStrategy: 'UPDATE_IF_NEWER', transform: {}, isKeyPart: false },
    ];
    const result = mergeRowValues({ Q: 1 }, { Q: 2 }, strategy, { incomingUpdatedAt: new Date() });
    expect(result.values.Q).toBe(1);
  });

  it('builds composite keys in the declared order', () => {
    const keys = keyFieldsOf([
      { sourceField: 'b', targetField: 'B', updateStrategy: 'ALWAYS_UPDATE', transform: {}, isKeyPart: true, keyOrder: 1 },
      { sourceField: 'a', targetField: 'A', updateStrategy: 'ALWAYS_UPDATE', transform: {}, isKeyPart: true, keyOrder: 0 },
    ]);
    expect(keys.map((k) => k.targetField)).toEqual(['A', 'B']);
    expect(buildRowKey({ A: 'One', B: 'Two' }, keys)).toBe('one|two');
  });

  it('applies declared transforms', () => {
    expect(applyTransform('2026-08-12', { type: 'date', format: 'dd-MM-yyyy' })).toBe('12-08-2026');
    expect(applyTransform(3.14159, { type: 'number', decimals: 2 })).toBe(3.14);
    expect(applyTransform('abc', { type: 'uppercase' })).toBe('ABC');
  });
});

describe('condition evaluation', () => {
  const data = { quantity: 50, status: 'Confirmed', notes: '' };

  it('evaluates comparisons', () => {
    expect(evaluateCondition('quantity > 10', data)).toBe(true);
    expect(evaluateCondition('quantity < 10', data)).toBe(false);
    expect(evaluateCondition('quantity >= 50', data)).toBe(true);
    expect(evaluateCondition('status == "Confirmed"', data)).toBe(true);
    expect(evaluateCondition('status != "Cancelled"', data)).toBe(true);
  });

  it('supports contains, exists and empty', () => {
    expect(evaluateCondition('status contains "confirm"', data)).toBe(true);
    expect(evaluateCondition('quantity exists', data)).toBe(true);
    expect(evaluateCondition('notes empty', data)).toBe(true);
  });

  it('supports && and ||', () => {
    expect(evaluateCondition('quantity > 10 && status == "Confirmed"', data)).toBe(true);
    expect(evaluateCondition('quantity > 100 || status == "Confirmed"', data)).toBe(true);
    expect(evaluateCondition('quantity > 100 && status == "Confirmed"', data)).toBe(false);
  });

  it('treats an unparseable condition as "do not run"', () => {
    expect(evaluateCondition('!!!nonsense!!!', data)).toBe(false);
  });

  it('treats an empty condition as always true', () => {
    expect(evaluateCondition('', data)).toBe(true);
  });
});

describe('API connector helpers', () => {
  it('interpolates path placeholders', () => {
    const row = {
      recordId: 'rec1',
      keyValue: 'k',
      values: { sku: 'ABC-1' },
      externalRowId: '42',
      version: 1,
      updatedAt: new Date(),
    };
    expect(interpolatePath('/products/{id}', row)).toBe('/products/42');
    expect(interpolatePath('/products/{sku}', row)).toBe('/products/ABC-1');
  });

  it('reads nested response paths', () => {
    expect(readPath({ data: { id: 7 } }, 'data.id')).toBe(7);
    expect(readPath({ items: [{ id: 3 }] }, 'items.0.id')).toBe(3);
    expect(readPath({}, 'missing.path')).toBeUndefined();
  });

  it('signs webhook payloads over timestamp and body together', () => {
    const a = signPayload('{"a":1}', 'secret', 1_700_000_000);
    const b = signPayload('{"a":1}', 'secret', 1_700_000_001);
    // A different timestamp must produce a different signature, otherwise a
    // captured request could be replayed forever.
    expect(a).not.toBe(b);
    expect(a).toBe(signPayload('{"a":1}', 'secret', 1_700_000_000));
  });
});

describe('CSV handling', () => {
  it('round-trips quoted fields containing commas and quotes', () => {
    const rows = [
      ['Customer', 'Notes'],
      ['ABC, Ltd', 'He said "hello"'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    expect(parseCsv('﻿Customer,Product\nABC,X')[0][0]).toBe('Customer');
  });
});

describe('operation support matrix', () => {
  it('allows UPSERT on spreadsheets but not on webhooks', () => {
    expect(operationSupported('EXCEL', 'UPSERT')).toBe(true);
    expect(operationSupported('GOOGLE_SHEETS', 'UPSERT')).toBe(true);
    expect(operationSupported('WEBHOOK', 'UPSERT')).toBe(false);
    expect(operationSupported('PDF', 'UPSERT')).toBe(false);
  });
});

describe('permissions and tenant isolation', () => {
  it('grants and withholds by role', () => {
    expect(roleHasPermission('VIEWER', 'messages:read')).toBe(true);
    expect(roleHasPermission('VIEWER', 'outputs:sync')).toBe(false);
    expect(roleHasPermission('OPERATOR', 'outputs:sync')).toBe(true);
    expect(roleHasPermission('OPERATOR', 'members:manage')).toBe(false);
    expect(roleHasPermission('ADMIN', 'members:manage')).toBe(true);
    expect(roleHasPermission('ADMIN', 'billing:manage')).toBe(false);
    expect(roleHasPermission('OWNER', 'billing:manage')).toBe(true);
  });

  it('gives an owner a superset of an operator’s permissions', () => {
    const operator = permissionsForRole('OPERATOR');
    const owner = permissionsForRole('OWNER');
    expect(operator.every((p) => owner.includes(p))).toBe(true);
    expect(owner.length).toBeGreaterThan(operator.length);
  });

  it('rejects a resource belonging to another tenant', () => {
    expect(() => assertTenantOwned({ tenantId: 'tenant-b' }, 'tenant-a')).toThrow(/not found/i);
  });

  it('rejects a missing resource', () => {
    expect(() => assertTenantOwned(null, 'tenant-a')).toThrow(/not found/i);
  });

  it('accepts a resource belonging to the requesting tenant', () => {
    const entity = { tenantId: 'tenant-a', id: '1' };
    expect(assertTenantOwned(entity, 'tenant-a')).toBe(entity);
  });
});

describe('credential encryption', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips a secret and never stores it in the clear', async () => {
    const { encryptJson, decryptJson } = await import('@msgflow/db');
    const secret = { apiKey: 'super-secret-value', token: 'abc123' };
    const encrypted = encryptJson(secret);

    expect(encrypted).not.toContain('super-secret-value');
    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(decryptJson(encrypted)).toEqual(secret);
  });

  it('produces a different ciphertext each time for the same input', async () => {
    const { encryptSecret } = await import('@msgflow/db');
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects a tampered payload', async () => {
    const { encryptSecret, decryptSecret } = await import('@msgflow/db');
    const encrypted = encryptSecret('value');
    const tampered = `${encrypted.slice(0, -4)}AAAA`;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
