import { z } from 'zod';

export const fieldTypeSchema = z.enum([
  'STRING',
  'TEXT',
  'NUMBER',
  'INTEGER',
  'DECIMAL',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'ENUM',
  'EMAIL',
  'PHONE',
  'CURRENCY',
]);

export const extractionFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Field key is required')
    .max(60)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Use letters, numbers and underscores, starting with a letter'),
  label: z.string().trim().min(1, 'Field label is required').max(80),
  type: fieldTypeSchema.default('STRING'),
  required: z.boolean().default(false),
  isKeyField: z.boolean().default(false),
  enumValues: z.array(z.string()).default([]),
  description: z.string().max(300).optional(),
  validation: z.record(z.unknown()).default({}),
  order: z.number().int().default(0),
});

export const extractionSchemaSchema = z.object({
  name: z.string().trim().min(2, 'Name your data schema').max(80),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().max(4000).optional(),
  confidenceThreshold: z.coerce.number().min(0).max(1).default(0.7),
  fields: z.array(extractionFieldSchema).min(1, 'Add at least one field').max(50),
});
export type ExtractionSchemaInput = z.infer<typeof extractionSchemaSchema>;

export const processingModeSchema = z.enum(['REAL_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM', 'MANUAL']);

export const dateRangeModeSchema = z.enum([
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
]);

export const messageCategorySchema = z.enum([
  'SALES',
  'ORDER',
  'PURCHASE',
  'INVENTORY',
  'PAYMENT',
  'CUSTOMER',
  'COMPLAINT',
  'MEETING',
  'TASK',
  'HR',
  'FINANCE',
  'DELIVERY',
  'LOGISTICS',
  'ANNOUNCEMENT',
  'OTHER',
  'IGNORE',
]);

export const automationSchema = z
  .object({
    name: z.string().trim().min(2, 'Name your automation').max(100),
    description: z.string().max(500).optional(),

    schemaId: z.string().min(1, 'Choose a data schema').optional(),
    /** Inline schema definition, when creating schema + automation together. */
    schema: extractionSchemaSchema.optional(),

    groupIds: z.array(z.string()).min(1, 'Select at least one WhatsApp group'),

    processingMode: processingModeSchema.default('REAL_TIME'),
    dateRangeMode: dateRangeModeSchema.default('SINCE_LAST_SUCCESSFUL_RUN'),

    scheduleHour: z.coerce.number().int().min(0).max(23).default(23),
    scheduleMinute: z.coerce.number().int().min(0).max(59).default(0),
    scheduleWeekday: z.coerce.number().int().min(0).max(6).default(1),
    scheduleDay: z.coerce.number().int().min(1).max(28).default(1),
    cronExpression: z.string().max(120).optional(),
    timezone: z.string().optional(),

    customFrom: z.string().datetime().optional(),
    customTo: z.string().datetime().optional(),

    requireImportant: z.boolean().default(true),
    minImportance: z.enum(['HIGH', 'MEDIUM', 'LOW', 'IGNORE']).default('MEDIUM'),
    categories: z.array(messageCategorySchema).default([]),
    keywordFilter: z.string().max(300).optional(),
    minConfidence: z.coerce.number().min(0).max(1).default(0.7),
  })
  .refine((v) => v.schemaId || v.schema, {
    message: 'Provide an existing schema or define a new one',
    path: ['schemaId'],
  })
  .refine((v) => v.dateRangeMode !== 'CUSTOM' || (v.customFrom && v.customTo), {
    message: 'A custom date range needs both a start and an end',
    path: ['customFrom'],
  })
  .refine(
    (v) => v.processingMode !== 'CUSTOM' || Boolean(v.cronExpression),
    { message: 'Custom scheduling requires a cron expression', path: ['cronExpression'] },
  );
export type AutomationInput = z.infer<typeof automationSchema>;

export const automationStatusActionSchema = z.object({
  action: z.enum(['activate', 'pause', 'resume', 'archive', 'duplicate']),
});

export const nlAutomationSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(15, 'Describe what you want to automate in a little more detail')
    .max(1000),
});

export const runAutomationSchema = z.object({
  trigger: z.enum(['MANUAL', 'SYNC_NOW', 'REPROCESS']).default('MANUAL'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Ignore cursors and reprocess everything in the window. */
  force: z.boolean().default(false),
});

export const actionTypeSchema = z.enum([
  'SAVE_RECORD',
  'SYNC_OUTPUT',
  'CALL_API',
  'SEND_WEBHOOK',
  'GENERATE_DOCUMENT',
  'NOTIFY',
]);

export const automationActionSchema = z.object({
  type: actionTypeSchema,
  name: z.string().trim().min(1).max(80),
  order: z.coerce.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
  outputTargetId: z.string().optional(),
  condition: z.string().max(300).optional(),
  config: z.record(z.unknown()).default({}),
  timeoutMs: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  continueOnError: z.boolean().default(true),
  retryPolicy: z
    .object({
      maxAttempts: z.coerce.number().int().min(1).max(10).default(3),
      backoff: z.enum(['fixed', 'exponential']).default('exponential'),
      initialDelayMs: z.coerce.number().int().min(100).max(60_000).default(1_000),
      maxDelayMs: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    })
    .default({ maxAttempts: 3, backoff: 'exponential', initialDelayMs: 1_000, maxDelayMs: 30_000 }),
});
