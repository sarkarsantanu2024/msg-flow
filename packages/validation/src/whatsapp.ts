import { z } from 'zod';

export const normalizedMessageSchema = z.object({
  externalId: z.string().min(1),
  groupExternalId: z.string().min(1),
  groupName: z.string().default(''),
  senderId: z.string().default(''),
  senderName: z.string().default(''),
  senderPhone: z.string().nullable().default(null),
  text: z.string().default(''),
  messageType: z
    .enum([
      'TEXT',
      'IMAGE',
      'VIDEO',
      'AUDIO',
      'DOCUMENT',
      'LOCATION',
      'CONTACT_CARD',
      'STICKER',
      'SYSTEM',
      'OTHER',
    ])
    .default('TEXT'),
  timestamp: z.number().int().positive(),
  isFromMe: z.boolean().default(false),
  quotedMessageId: z.string().nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
});

/** Batch ingest payload posted by the worker. Capped to bound a single request. */
export const ingestPayloadSchema = z.object({
  tenantId: z.string().min(1),
  connectionId: z.string().min(1),
  source: z.enum(['LIVE', 'BACKLOG']).default('LIVE'),
  messages: z.array(normalizedMessageSchema).min(1).max(500),
});
export type IngestPayloadInput = z.infer<typeof ingestPayloadSchema>;

export const workerStatusReportSchema = z.object({
  workerName: z.string().min(1),
  hostname: z.string().default('unknown'),
  pid: z.number().int().optional(),
  version: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  status: z.enum(['STARTING', 'ONLINE', 'DEGRADED', 'OFFLINE']).default('ONLINE'),
  cpuPercent: z.number().optional(),
  memoryMb: z.number().optional(),
  uptimeSec: z.number().int().optional(),
  connections: z.number().int().default(0),
  messagesSeen: z.number().int().default(0),
  queueDepth: z.number().int().default(0),
});

export const connectionStateReportSchema = z.object({
  tenantId: z.string().min(1),
  connectionId: z.string().min(1),
  state: z.enum([
    'DISCONNECTED',
    'QR_REQUIRED',
    'CONNECTING',
    'AUTHENTICATED',
    'READY',
    'RECONNECTING',
    'ERROR',
    'LOGGED_OUT',
  ]),
  phoneNumber: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  qrCode: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
  workerName: z.string().optional(),
});

export const groupSyncSchema = z.object({
  tenantId: z.string().min(1),
  connectionId: z.string().min(1),
  groups: z
    .array(
      z.object({
        externalId: z.string().min(1),
        name: z.string().default('Unnamed group'),
        description: z.string().nullable().default(null),
        participantCount: z.number().int().default(0),
        isGroup: z.boolean().default(true),
      }),
    )
    .max(1000),
});

export const connectionActionSchema = z.object({
  action: z.enum(['connect', 'reconnect', 'disconnect', 'logout', 'refresh-qr', 'sync-groups']),
});

export const createConnectionSchema = z.object({
  name: z.string().trim().min(2).max(60).default('Primary WhatsApp'),
  provider: z.enum(['WHATSAPP_WEB', 'WHATSAPP_CLOUD', 'DEMO']).default('WHATSAPP_WEB'),
});

export const toggleGroupSchema = z.object({
  isMonitored: z.boolean(),
});
