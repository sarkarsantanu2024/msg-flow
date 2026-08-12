import { MESSAGE_CATEGORIES, IMPORTANCE_LEVELS } from '@msgflow/types';
import type {
  AiCategory,
  AiImportance,
  AutomationDraft,
  ClassificationResult,
  ExtractionResult,
  ValidationVerdict,
} from '@msgflow/types';
import { normalizeConfidence } from '../json.js';

/**
 * Coercion layer between raw model JSON and our typed results.
 *
 * Every provider runs its output through these. A model that invents a category
 * or returns `records` as a bare object instead of an array must not crash the
 * pipeline — it should degrade to something safe and typed.
 */

export function coerceClassification(raw: unknown): ClassificationResult {
  const obj = (raw ?? {}) as Record<string, unknown>;

  const rawCategory = String(obj.category ?? 'OTHER').toUpperCase().trim();
  const category = (MESSAGE_CATEGORIES as readonly string[]).includes(rawCategory)
    ? (rawCategory as AiCategory)
    : 'OTHER';

  const rawImportance = String(obj.importance ?? 'LOW').toUpperCase().trim();
  const importance = (IMPORTANCE_LEVELS as readonly string[]).includes(rawImportance)
    ? (rawImportance as AiImportance)
    : 'LOW';

  return {
    category,
    // An IGNORE category with HIGH importance is incoherent; trust the category.
    importance: category === 'IGNORE' ? 'IGNORE' : importance,
    confidence: normalizeConfidence(obj.confidence),
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 500) : '',
    entities: isPlainObject(obj.entities) ? obj.entities : {},
  };
}

export function coerceExtraction(raw: unknown): ExtractionResult {
  const obj = (raw ?? {}) as Record<string, unknown>;

  let records: Array<{ data: Record<string, unknown>; confidence: number }> = [];

  if (Array.isArray(obj.records)) {
    records = obj.records
      .map((entry) => {
        if (!isPlainObject(entry)) return null;
        // Accept both { data: {...}, confidence } and a bare field object.
        const data = isPlainObject(entry.data) ? entry.data : stripMeta(entry);
        if (Object.keys(data).length === 0) return null;
        return { data, confidence: normalizeConfidence(entry.confidence ?? obj.confidence) };
      })
      .filter((r): r is { data: Record<string, unknown>; confidence: number } => r !== null);
  } else if (isPlainObject(obj.data)) {
    records = [{ data: obj.data, confidence: normalizeConfidence(obj.confidence) }];
  }

  const overall =
    records.length > 0
      ? records.reduce((acc, r) => acc + r.confidence, 0) / records.length
      : normalizeConfidence(obj.confidence ?? 0);

  return {
    records,
    confidence: records.length === 0 ? 0 : overall,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 500) : '',
  };
}

export function coerceAutomationDraft(raw: unknown): AutomationDraft {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const schema = isPlainObject(obj.schema) ? obj.schema : {};
  const output = isPlainObject(obj.output) ? obj.output : {};

  const fields = Array.isArray(schema.fields)
    ? schema.fields
        .filter(isPlainObject)
        .map((f, index) => ({
          key: sanitizeKey(String(f.key ?? `field${index + 1}`)),
          label: String(f.label ?? f.key ?? `Field ${index + 1}`).slice(0, 80),
          type: String(f.type ?? 'STRING').toUpperCase(),
          required: Boolean(f.required),
          description: typeof f.description === 'string' ? f.description.slice(0, 300) : undefined,
          enumValues: Array.isArray(f.enumValues) ? f.enumValues.map(String) : undefined,
        }))
        .slice(0, 30)
    : [];

  const categories = Array.isArray(obj.categories)
    ? obj.categories
        .map((c) => String(c).toUpperCase())
        .filter((c): c is AiCategory => (MESSAGE_CATEGORIES as readonly string[]).includes(c))
    : [];

  return {
    name: String(obj.name ?? 'Untitled Automation').slice(0, 100),
    description: String(obj.description ?? '').slice(0, 500),
    suggestedGroupIds: Array.isArray(obj.suggestedGroupIds) ? obj.suggestedGroupIds.map(String) : [],
    categories,
    processingMode: pickEnum(
      obj.processingMode,
      ['REAL_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM', 'MANUAL'],
      'REAL_TIME',
    ) as AutomationDraft['processingMode'],
    dateRangeMode: pickEnum(
      obj.dateRangeMode,
      [
        'CURRENT_MESSAGE',
        'TODAY',
        'YESTERDAY',
        'THIS_WEEK',
        'LAST_WEEK',
        'THIS_MONTH',
        'LAST_MONTH',
        'LAST_7_DAYS',
        'CUSTOM',
        'SINCE_LAST_SUCCESSFUL_RUN',
      ],
      'SINCE_LAST_SUCCESSFUL_RUN',
    ),
    schema: {
      name: String(schema.name ?? 'Extracted Data').slice(0, 80),
      fields: fields.length > 0 ? fields : defaultFields(),
    },
    output: {
      type: pickEnum(output.type, ['EXCEL', 'CSV', 'GOOGLE_SHEETS', 'REST_API', 'WEBHOOK'], 'EXCEL'),
      operation: pickEnum(
        output.operation,
        ['CREATE_NEW', 'APPEND', 'UPDATE_EXISTING', 'UPSERT', 'REPLACE', 'GENERATE_NEW_VERSION'],
        'UPSERT',
      ),
      keyFields: Array.isArray(output.keyFields) ? output.keyFields.map(String) : [],
    },
    reasoning: String(obj.reasoning ?? '').slice(0, 1000),
  };
}

export function coerceVerdict(raw: unknown, confidence: number): ValidationVerdict {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const issues = Array.isArray(obj.issues)
    ? obj.issues.filter(isPlainObject).map((i) => ({
        field: String(i.field ?? '_'),
        issue: String(i.issue ?? 'Unspecified issue').slice(0, 300),
        severity: (String(i.severity ?? 'warning').toLowerCase() === 'error' ? 'error' : 'warning') as
          | 'error'
          | 'warning',
      }))
    : [];

  return {
    // An explicit `valid: true` alongside errors is contradictory — errors win.
    valid: obj.valid === true && !issues.some((i) => i.severity === 'error'),
    issues,
    correctedData: isPlainObject(obj.correctedData) ? obj.correctedData : undefined,
    confidence,
  };
}

function defaultFields() {
  return [
    { key: 'date', label: 'Date', type: 'DATE', required: true, description: 'Date referenced in the message' },
    { key: 'customerName', label: 'Customer', type: 'STRING', required: true, description: 'Customer or party name' },
    { key: 'details', label: 'Details', type: 'TEXT', required: false, description: 'Summary of the message' },
  ];
}

function sanitizeKey(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '').replace(/^[^a-zA-Z]+/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'field';
}

function pickEnum(value: unknown, allowed: string[], fallback: string): string {
  const v = String(value ?? '').toUpperCase().trim();
  return allowed.includes(v) ? v : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripMeta(entry: Record<string, unknown>): Record<string, unknown> {
  const { confidence: _c, reasoning: _r, ...rest } = entry;
  return rest;
}
