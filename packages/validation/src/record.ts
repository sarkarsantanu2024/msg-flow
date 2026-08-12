import { z } from 'zod';

export const recordStatusSchema = z.enum(['DRAFT', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED']);

export const updateRecordSchema = z.object({
  data: z.record(z.unknown()),
  reviewNote: z.string().max(1000).optional(),
});

export const reviewActionSchema = z.object({
  action: z.enum(['approve', 'edit_approve', 'reject', 'reprocess']),
  data: z.record(z.unknown()).optional(),
  note: z.string().max(1000).optional(),
});

export const recordQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().max(200).optional(),
  status: z.union([recordStatusSchema, z.array(recordStatusSchema)]).optional(),
  schemaId: z.string().optional(),
  automationId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'confidence', 'naturalKey']).default('updatedAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});

export const messageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().max(200).optional(),
  groupId: z.string().optional(),
  senderPhone: z.string().optional(),
  category: z.string().optional(),
  importance: z.enum(['HIGH', 'MEDIUM', 'LOW', 'IGNORE']).optional(),
  status: z
    .enum([
      'PENDING',
      'CLASSIFIED',
      'PROCESSING',
      'EXTRACTED',
      'SKIPPED',
      'IGNORED',
      'NEEDS_REVIEW',
      'FAILED',
    ])
    .optional(),
  automationId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const reprocessMessageSchema = z.object({
  action: z.enum(['reprocess', 'ignore', 'assign']),
  automationId: z.string().optional(),
});

/** Demo Mode: process typed text through the full pipeline without WhatsApp. */
export const demoMessageSchema = z.object({
  text: z.string().trim().min(3, 'Type a message to process').max(2000),
  schemaId: z.string().optional(),
  automationId: z.string().optional(),
  senderName: z.string().max(80).default('Demo Sender'),
  groupName: z.string().max(80).default('Demo Group'),
  /** Persist the result, or run it as a preview only. */
  persist: z.boolean().default(false),
});
export type DemoMessageInput = z.infer<typeof demoMessageSchema>;
