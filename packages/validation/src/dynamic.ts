import { z } from 'zod';
import type { ExtractionFieldSpec } from '@msgflow/types';

/**
 * Build a Zod schema at runtime from a tenant's ExtractionField definitions.
 *
 * This is the gate between the AI and the database. The model returns free-form
 * JSON; nothing reaches ExtractedRecord until it has passed through a schema
 * derived from what the tenant actually declared. "AI never writes business
 * data directly" is enforced here, not by convention.
 */

function coerceNumber(value: unknown): unknown {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  // Tolerate the forms real messages use: "₹1,250.50", "50 kg", "2.5k"
  const cleaned = value.replace(/[₹$€£,\s]/g, '');
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return value;
  const base = Number(match[0]);
  if (/k$/i.test(cleaned)) return base * 1_000;
  if (/(l|lakh)$/i.test(cleaned)) return base * 100_000;
  if (/(cr|crore)$/i.test(cleaned)) return base * 10_000_000;
  return base;
}

function coerceBoolean(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'done', 'confirmed'].includes(v)) return true;
    if (['false', 'no', 'n', '0', 'pending', 'cancelled'].includes(v)) return false;
  }
  return value;
}

function coerceDate(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed;

  // dd/mm/yyyy and dd-mm-yyyy — the Indian business default, which is also
  // where Date.parse silently guesses American order and gets it wrong.
  const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return trimmed;
}

function baseSchemaFor(field: ExtractionFieldSpec): z.ZodTypeAny {
  const v = (field as { validation?: Record<string, unknown> }).validation ?? {};

  switch (field.type) {
    case 'INTEGER': {
      let s = z.preprocess(coerceNumber, z.number().int());
      if (typeof v.min === 'number') s = z.preprocess(coerceNumber, z.number().int().min(v.min));
      if (typeof v.max === 'number') s = z.preprocess(coerceNumber, z.number().int().max(v.max));
      return s;
    }
    case 'NUMBER':
    case 'DECIMAL':
    case 'CURRENCY': {
      let inner = z.number();
      if (typeof v.min === 'number') inner = inner.min(v.min);
      if (typeof v.max === 'number') inner = inner.max(v.max);
      return z.preprocess(coerceNumber, inner);
    }
    case 'BOOLEAN':
      return z.preprocess(coerceBoolean, z.boolean());
    case 'DATE':
    case 'DATETIME':
      return z.preprocess(coerceDate, z.string().min(4, 'Not a recognisable date'));
    case 'EMAIL':
      return z.string().trim().toLowerCase().email('Not a valid email');
    case 'PHONE':
      return z
        .string()
        .trim()
        .regex(/^[+]?[\d\s()-]{6,20}$/, 'Not a valid phone number');
    case 'ENUM': {
      const values = field.enumValues ?? [];
      if (values.length === 0) return z.string();
      // Case-insensitive match against the declared options.
      return z.preprocess((raw) => {
        if (typeof raw !== 'string') return raw;
        const hit = values.find((o) => o.toLowerCase() === raw.trim().toLowerCase());
        return hit ?? raw;
      }, z.enum(values as [string, ...string[]]));
    }
    case 'TEXT':
      return z.string().max(5_000);
    case 'STRING':
    default: {
      let s = z.string().trim();
      if (typeof v.minLength === 'number') s = s.min(v.minLength);
      if (typeof v.maxLength === 'number') s = s.max(v.maxLength);
      if (typeof v.pattern === 'string') {
        try {
          s = s.regex(new RegExp(v.pattern), 'Does not match the expected format');
        } catch {
          // An invalid stored pattern must not break extraction for everyone.
        }
      }
      return s;
    }
  }
}

export function buildRecordSchema(fields: ExtractionFieldSpec[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    const base = baseSchemaFor(field);
    shape[field.key] = field.required
      ? base
      : // Absent, null and "" all mean "the message didn't say".
        z.preprocess((v) => (v === '' || v === null ? undefined : v), base.optional());
  }
  // Unknown keys are dropped rather than rejected: a model that volunteers an
  // extra field should not fail an otherwise-valid extraction.
  return z.object(shape).strip() as z.ZodType<Record<string, unknown>>;
}

export interface RecordValidationResult {
  valid: boolean;
  data: Record<string, unknown>;
  errors: Array<{ field: string; message: string }>;
}

export function validateRecordData(
  fields: ExtractionFieldSpec[],
  raw: Record<string, unknown>,
): RecordValidationResult {
  const schema = buildRecordSchema(fields);
  const result = schema.safeParse(raw);
  if (result.success) {
    return { valid: true, data: result.data, errors: [] };
  }
  return {
    valid: false,
    data: raw,
    errors: result.error.issues.map((i) => ({
      field: i.path.join('.') || '_',
      message: i.message,
    })),
  };
}

/**
 * Build the natural key for a record.
 *
 * Normalisation matters more than it looks: "ABC Traders", "abc traders" and
 * "ABC  Traders" are the same customer, and if the key does not say so the
 * system creates three records and the client's file grows duplicates.
 */
export function buildNaturalKey(data: Record<string, unknown>, keyFields: string[]): string {
  if (keyFields.length === 0) {
    // No declared key — fall back to the whole record so at least identical
    // repeats collapse instead of multiplying.
    return JSON.stringify(data);
  }
  return keyFields
    .map((key) => normalizeKeyPart(data[key]))
    .join('|');
}

export function normalizeKeyPart(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  // ISO datetimes collapse to the date — an order placed at 10:00 and updated
  // at 14:00 on the same day is one order.
  const iso = str.match(/^(\d{4}-\d{2}-\d{2})t/);
  return iso ? iso[1] : str;
}
