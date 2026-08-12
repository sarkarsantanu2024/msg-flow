import { z } from 'zod';

export const outputTypeSchema = z.enum([
  'EXCEL',
  'CSV',
  'GOOGLE_SHEETS',
  'PDF',
  'POWERPOINT',
  'WEBHOOK',
  'REST_API',
  'CLIENT_WEBSITE',
  'CLIENT_ADMIN',
]);

export const outputOperationSchema = z.enum([
  'CREATE_NEW',
  'APPEND',
  'UPDATE_EXISTING',
  'UPSERT',
  'REPLACE',
  'GENERATE_NEW_VERSION',
]);

export const updateStrategySchema = z.enum([
  'ALWAYS_UPDATE',
  'UPDATE_IF_EMPTY',
  'NEVER_UPDATE',
  'UPDATE_IF_NEWER',
]);

export const outputMappingSchema = z.object({
  sourceField: z.string().min(1, 'Choose a source field'),
  targetField: z.string().min(1, 'Choose a target column'),
  targetColumn: z.string().max(10).nullable().optional(),
  updateStrategy: updateStrategySchema.default('ALWAYS_UPDATE'),
  transform: z.record(z.unknown()).default({}),
  defaultValue: z.string().max(200).nullable().optional(),
  isKeyPart: z.boolean().default(false),
  keyOrder: z.coerce.number().int().min(0).nullable().optional(),
  order: z.coerce.number().int().default(0),
});

/** Per-type target configuration. Discriminated so each shape is validated. */
export const excelConfigSchema = z.object({
  storageRef: z.string().optional(),
  fileName: z.string().min(1).default('output.xlsx'),
  worksheet: z.string().min(1).default('Sheet1'),
  headerRow: z.coerce.number().int().min(1).default(1),
});

export const csvConfigSchema = z.object({
  storageRef: z.string().optional(),
  fileName: z.string().min(1).default('output.csv'),
  delimiter: z.string().length(1).default(','),
  headerRow: z.coerce.number().int().min(1).default(1),
});

export const sheetsConfigSchema = z.object({
  spreadsheetId: z.string().min(1, 'Spreadsheet ID is required'),
  worksheetTitle: z.string().min(1).default('Sheet1'),
  headerRow: z.coerce.number().int().min(1).default(1),
});

export const restApiConfigSchema = z.object({
  baseUrl: z.string().url('Enter a valid URL'),
  createPath: z.string().default('/'),
  updatePath: z.string().default('/{id}'),
  lookupPath: z.string().optional(),
  createMethod: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  updateMethod: z.enum(['POST', 'PUT', 'PATCH']).default('PUT'),
  headers: z.record(z.string()).default({}),
  /** Wrap the mapped payload, e.g. { "data": {...} }. */
  bodyWrapper: z.string().optional(),
  /** JSON path to the id in the create response, e.g. "data.id". */
  idPath: z.string().default('id'),
  timeoutMs: z.coerce.number().int().min(1000).max(120_000).default(30_000),
});

export const webhookConfigSchema = z.object({
  url: z.string().url('Enter a valid URL'),
  method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string()).default({}),
  /** Send all rows in one request instead of one request per row. */
  batch: z.boolean().default(true),
  timeoutMs: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  signPayload: z.boolean().default(true),
});

export const documentConfigSchema = z.object({
  fileName: z.string().min(1).default('report'),
  title: z.string().max(120).default('MsgFlow Report'),
  subtitle: z.string().max(200).optional(),
  orientation: z.enum(['portrait', 'landscape']).default('landscape'),
});

export const createOutputSchema = z.object({
  name: z.string().trim().min(2, 'Name this output').max(100),
  type: outputTypeSchema,
  config: z.record(z.unknown()).default({}),
  integrationId: z.string().optional(),
  allowDelete: z.boolean().default(false),
});
export type CreateOutputInput = z.infer<typeof createOutputSchema>;

export const updateOutputSchema = createOutputSchema.partial().extend({
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
});

export const outputTargetSchema = z.object({
  automationId: z.string().min(1, 'Choose an automation'),
  outputId: z.string().min(1, 'Choose an output'),
  operation: outputOperationSchema.default('UPSERT'),
  enabled: z.boolean().default(true),
  order: z.coerce.number().int().default(0),
  cronExpression: z.string().max(120).optional(),
  config: z.record(z.unknown()).default({}),
  mappings: z.array(outputMappingSchema).min(1, 'Map at least one field'),
});
export type OutputTargetInput = z.infer<typeof outputTargetSchema>;

/**
 * UPDATE and UPSERT are meaningless without a way to find an existing row.
 * Rejecting the configuration here is what stops a misconfigured automation
 * from silently appending duplicates to a customer's master file.
 */
export const outputTargetWithKeyRule = outputTargetSchema.refine(
  (v) => !['UPDATE_EXISTING', 'UPSERT'].includes(v.operation) || v.mappings.some((m) => m.isKeyPart),
  {
    message: 'UPDATE and UPSERT need at least one field marked as part of the unique key',
    path: ['mappings'],
  },
);

export const syncNowSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  dryRun: z.boolean().default(false),
});

export const resolveConflictSchema = z.object({
  resolution: z.enum(['USE_LATEST_FILE', 'KEEP_AUTOMATION_VERSION', 'IGNORED']),
});

export const restoreVersionSchema = z.object({
  version: z.coerce.number().int().min(1),
});

export const integrationSchema = z.object({
  type: z.enum(['GOOGLE_SHEETS', 'GOOGLE_DRIVE', 'REST_API', 'WEBHOOK', 'CLIENT_WEBSITE', 'CLIENT_ADMIN']),
  name: z.string().trim().min(2).max(80),
  config: z.record(z.unknown()).default({}),
  credentials: z.record(z.unknown()).optional(),
  credentialType: z.enum(['OAUTH2', 'API_KEY', 'BEARER_TOKEN', 'BASIC_AUTH', 'HMAC', 'NONE']).default('API_KEY'),
});

export const exportRequestSchema = z.object({
  entity: z.enum(['messages', 'records', 'runs', 'analytics']),
  format: z.enum(['xlsx', 'csv', 'pdf', 'pptx']),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  filters: z.record(z.unknown()).default({}),
});
