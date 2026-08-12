import type { MappingSpec, SyncRow, UpdateStrategyName } from '@msgflow/types';

/**
 * Field mapping and update-strategy engine.
 *
 * Shared by every connector so that "NEVER_UPDATE means never update" is one
 * implementation, not five slightly different ones. This is the code that
 * decides whether a customer's existing spreadsheet value gets overwritten, so
 * it errs toward keeping what is already there.
 */

/** Ordered key fields for a target (composite keys respect keyOrder). */
export function keyFieldsOf(mappings: MappingSpec[]): MappingSpec[] {
  return mappings
    .filter((m) => m.isKeyPart)
    .sort((a, b) => (a.keyOrder ?? 0) - (b.keyOrder ?? 0));
}

/** Normalise a value for key comparison — see the note in @msgflow/validation. */
export function normalizeKeyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return String(value);
  const str = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  const iso = str.match(/^(\d{4}-\d{2}-\d{2})(?:t|\s)/);
  return iso ? iso[1] : str;
}

/** Build the composite key for a row of already-mapped target values. */
export function buildRowKey(values: Record<string, unknown>, keyMappings: MappingSpec[]): string {
  return keyMappings.map((m) => normalizeKeyValue(values[m.targetField])).join('|');
}

/** Apply a transform declared on a mapping. */
export function applyTransform(value: unknown, transform: Record<string, unknown>): unknown {
  if (value === null || value === undefined) return value;
  const type = typeof transform.type === 'string' ? transform.type : null;
  if (!type) return value;

  switch (type) {
    case 'date': {
      const format = typeof transform.format === 'string' ? transform.format : 'yyyy-MM-dd';
      return formatDate(value, format);
    }
    case 'number': {
      const decimals = typeof transform.decimals === 'number' ? transform.decimals : 2;
      const n = Number(value);
      return Number.isFinite(n) ? Number(n.toFixed(decimals)) : value;
    }
    case 'uppercase':
      return String(value).toUpperCase();
    case 'lowercase':
      return String(value).toLowerCase();
    case 'trim':
      return String(value).trim();
    case 'prefix':
      return `${transform.value ?? ''}${value}`;
    case 'suffix':
      return `${value}${transform.value ?? ''}`;
    default:
      return value;
  }
}

function formatDate(value: unknown, format: string): unknown {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return value;

  const pad = (n: number) => String(n).padStart(2, '0');
  const map: Record<string, string> = {
    yyyy: String(date.getUTCFullYear()),
    yy: String(date.getUTCFullYear()).slice(2),
    MM: pad(date.getUTCMonth() + 1),
    dd: pad(date.getUTCDate()),
    HH: pad(date.getUTCHours()),
    mm: pad(date.getUTCMinutes()),
    ss: pad(date.getUTCSeconds()),
  };
  return format.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (token) => map[token] ?? token);
}

/** Map a record's `data` into target-field values. */
export function mapRecordToTarget(
  data: Record<string, unknown>,
  mappings: MappingSpec[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const mapping of mappings) {
    const raw = data[mapping.sourceField];
    const value =
      raw === undefined || raw === null || raw === ''
        ? (mapping.defaultValue ?? null)
        : applyTransform(raw, mapping.transform);
    values[mapping.targetField] = value;
  }
  return values;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

export interface MergeResult {
  values: Record<string, unknown>;
  /** True when at least one field actually changed. */
  changed: boolean;
  /** Fields that were held back by their update strategy. */
  skippedFields: string[];
}

/**
 * Merge incoming values onto an existing row according to each field's strategy.
 *
 * `existingUpdatedAt` supports UPDATE_IF_NEWER: when the target row carries no
 * timestamp we cannot prove the incoming value is newer, so we do not update —
 * refusing to overwrite is the safe default when the answer is unknown.
 */
export function mergeRowValues(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  mappings: MappingSpec[],
  options: { incomingUpdatedAt?: Date; existingUpdatedAt?: Date | null } = {},
): MergeResult {
  const merged: Record<string, unknown> = { ...existing };
  const skippedFields: string[] = [];
  let changed = false;

  for (const mapping of mappings) {
    const field = mapping.targetField;
    const nextValue = incoming[field];
    const currentValue = existing[field];

    // Key fields identify the row; rewriting them would re-target the update.
    if (mapping.isKeyPart) continue;

    if (!shouldUpdate(mapping.updateStrategy, currentValue, nextValue, options)) {
      skippedFields.push(field);
      continue;
    }

    if (normalizeKeyValue(currentValue) !== normalizeKeyValue(nextValue)) {
      merged[field] = nextValue;
      changed = true;
    }
  }

  return { values: merged, changed, skippedFields };
}

function shouldUpdate(
  strategy: UpdateStrategyName,
  currentValue: unknown,
  nextValue: unknown,
  options: { incomingUpdatedAt?: Date; existingUpdatedAt?: Date | null },
): boolean {
  // An extraction that produced nothing for a field must never blank out a
  // value a human already put there.
  if (isEmpty(nextValue)) return false;

  switch (strategy) {
    case 'NEVER_UPDATE':
      return false;
    case 'UPDATE_IF_EMPTY':
      return isEmpty(currentValue);
    case 'UPDATE_IF_NEWER': {
      const incomingAt = options.incomingUpdatedAt;
      const existingAt = options.existingUpdatedAt;
      if (!incomingAt) return false;
      if (!existingAt) return false;
      return incomingAt.getTime() > existingAt.getTime();
    }
    case 'ALWAYS_UPDATE':
    default:
      return true;
  }
}

/** Build the payload sent to an API/webhook target for one row. */
export function buildApiPayload(row: SyncRow, wrapper?: string): Record<string, unknown> {
  const base = { ...row.values };
  if (!wrapper) return base;
  return { [wrapper]: base };
}

/** Resolve `{field}` placeholders in a URL path against a row's values. */
export function interpolatePath(template: string, row: SyncRow): string {
  return template.replace(/\{([^}]+)\}/g, (_match, token: string) => {
    if (token === 'id' || token === 'externalId') return encodeURIComponent(row.externalRowId ?? '');
    if (token === 'recordId') return encodeURIComponent(row.recordId);
    const value = row.values[token];
    return encodeURIComponent(value === null || value === undefined ? '' : String(value));
  });
}

/**
 * Evaluate an action condition such as `quantity > 0` or `status == "Confirmed"`.
 *
 * A tiny expression evaluator rather than `eval` or a dependency: the condition
 * comes from user configuration, and handing user input to `eval` inside the
 * workflow engine would be a straightforward code-execution hole.
 */
export function evaluateCondition(condition: string, data: Record<string, unknown>): boolean {
  const expr = condition.trim();
  if (!expr) return true;

  // Support `a && b` / `a || b` with left-to-right evaluation, no nesting.
  if (expr.includes('&&')) {
    return expr.split('&&').every((part) => evaluateCondition(part, data));
  }
  if (expr.includes('||')) {
    return expr.split('||').some((part) => evaluateCondition(part, data));
  }

  const match = expr.match(/^\s*([A-Za-z_][\w.]*)\s*(==|!=|>=|<=|>|<|contains|exists|empty)\s*(.*)$/);
  if (!match) {
    // An unparseable condition must not silently pass — treat it as "do not run".
    return false;
  }

  const [, field, operator, rawExpected] = match;
  const actual = data[field];
  const expected = parseLiteral(rawExpected.trim());

  switch (operator) {
    case '==':
      return normalizeKeyValue(actual) === normalizeKeyValue(expected);
    case '!=':
      return normalizeKeyValue(actual) !== normalizeKeyValue(expected);
    case '>':
      return toNumber(actual) > toNumber(expected);
    case '<':
      return toNumber(actual) < toNumber(expected);
    case '>=':
      return toNumber(actual) >= toNumber(expected);
    case '<=':
      return toNumber(actual) <= toNumber(expected);
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'exists':
      return !isEmpty(actual);
    case 'empty':
      return isEmpty(actual);
    default:
      return false;
  }
}

function parseLiteral(raw: string): unknown {
  if (raw === '') return '';
  if (/^".*"$/.test(raw) || /^'.*'$/.test(raw)) return raw.slice(1, -1);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}
