import { prisma, recordUsage, sha256 } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { createLogger, describeError } from '@msgflow/logger';
import { processIncomingMessage, startOfLocalDay } from '@msgflow/workflow';
import { ingestPayloadSchema } from '@msgflow/validation';
import type { IngestResult } from '@msgflow/types';
import { enforceRateLimit, ok, readJson, route } from '@/lib/api';
import { requireWorkerAuth } from '@/lib/worker-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const log = createLogger('api:ingest');

/**
 * Message ingestion — the durability boundary.
 *
 * Messages are committed to PostgreSQL *before* any AI work happens. If
 * classification or extraction later fails, the message is still safely stored
 * and can be reprocessed. Nothing here depends on WhatsApp still having the
 * message, which is the whole point of §130.
 *
 * Duplicate protection is enforced by the database (unique on
 * (tenantId, externalId) and (tenantId, contentHash)), not by application
 * logic — a redelivered webhook is a no-op rather than a duplicate row.
 */
export const POST = route(async (request: Request) => {
  requireWorkerAuth(request);

  const payload = ingestPayloadSchema.parse(await readJson(request));
  enforceRateLimit(`ingest:${payload.tenantId}`, 'ingest');

  const connection = await prisma.whatsAppConnection.findFirst({
    where: { id: payload.connectionId, tenantId: payload.tenantId },
  });

  if (!connection) {
    return ok<IngestResult>({
      received: payload.messages.length,
      stored: 0,
      duplicates: 0,
      skipped: payload.messages.length,
      errors: ['Unknown connection for this tenant.'],
    });
  }

  const result: IngestResult = {
    received: payload.messages.length,
    stored: 0,
    duplicates: 0,
    skipped: 0,
    errors: [],
  };

  const groupIds = [...new Set(payload.messages.map((m) => m.groupExternalId))];
  const groups = await prisma.whatsAppGroup.findMany({
    where: { connectionId: connection.id, externalId: { in: groupIds } },
  });
  const groupByExternalId = new Map(groups.map((g) => [g.externalId, g]));

  const storedIds: string[] = [];

  for (const message of payload.messages) {
    let group = groupByExternalId.get(message.groupExternalId);

    // A chat we have never seen is registered on its first message and starts
    // monitored. The worker only forwards capture-tagged messages, so arrival
    // here IS the user's opt-in — this is also the only way a direct (1-to-1)
    // chat can appear, since group sync only discovers @g.us chats. A chat the
    // user has explicitly un-monitored stays skipped: the toggle wins over
    // the tag.
    if (!group) {
      try {
        group = await prisma.whatsAppGroup.create({
          data: {
            tenantId: payload.tenantId,
            connectionId: connection.id,
            externalId: message.groupExternalId,
            name: message.groupName || message.groupExternalId.split('@')[0],
            isGroup: message.groupExternalId.endsWith('@g.us'),
            isMonitored: true,
          },
        });
      } catch {
        // Unique (connectionId, externalId) race with a concurrent batch — the
        // row exists now; use it.
        group =
          (await prisma.whatsAppGroup.findFirst({
            where: { connectionId: connection.id, externalId: message.groupExternalId },
          })) ?? undefined;
      }
      if (group) groupByExternalId.set(message.groupExternalId, group);
    }

    if (!group || !group.isMonitored) {
      result.skipped++;
      continue;
    }

    const timestamp = new Date(message.timestamp);
    const contentHash = sha256(
      `${message.groupExternalId}|${message.senderId}|${message.timestamp}|${message.text}`,
    );

    try {
      const created = await prisma.message.create({
        data: {
          tenantId: payload.tenantId,
          connectionId: connection.id,
          groupId: group.id,
          externalId: message.externalId,
          contentHash,
          senderId: message.senderId,
          senderName: message.senderName,
          senderPhone: message.senderPhone,
          text: message.text,
          messageType: message.messageType,
          metadata: message.metadata as Prisma.InputJsonValue,
          isFromMe: message.isFromMe,
          quotedMessageId: message.quotedMessageId,
          timestamp,
          ingestSource: payload.source,
          status: 'PENDING',
        },
      });

      result.stored++;
      storedIds.push(created.id);
    } catch (err) {
      // P2002 = unique violation = we already have this message. Expected.
      if ((err as { code?: string }).code === 'P2002') {
        result.duplicates++;
        continue;
      }
      result.errors.push(describeError(err).message);
      log.error('Failed to store message', { externalId: message.externalId, ...describeError(err) });
    }
  }

  if (result.stored > 0) {
    const latest = payload.messages.reduce((max, m) => Math.max(max, m.timestamp), 0);

    await Promise.all([
      prisma.whatsAppConnection.update({
        where: { id: connection.id },
        data: { lastMessageAt: new Date(latest) },
      }),
      ...[...new Set(payload.messages.map((m) => m.groupExternalId))].map((externalId) => {
        const group = groupByExternalId.get(externalId);
        if (!group) return Promise.resolve(null);
        const count = payload.messages.filter((m) => m.groupExternalId === externalId).length;
        return prisma.whatsAppGroup.update({
          where: { id: group.id },
          data: { messageCount: { increment: count }, lastMessageAt: new Date(latest) },
        });
      }),
    ]);

    const tenant = await prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { timezone: true },
    });
    await recordUsage(payload.tenantId, startOfLocalDay(new Date(), tenant?.timezone ?? 'Asia/Kolkata'), {
      messages: result.stored,
    });
  }

  // Respond first, process after: the worker must not block on AI latency, and
  // a slow model must never cause it to retry an already-stored message.
  if (payload.source === 'LIVE' && storedIds.length > 0) {
    void (async () => {
      for (const messageId of storedIds) {
        try {
          await processIncomingMessage(payload.tenantId, messageId);
        } catch (err) {
          log.error('Real-time processing failed', { messageId, ...describeError(err) });
        }
      }
    })();
  }

  log.info('Ingested messages', {
    tenantId: payload.tenantId,
    ...result,
    errors: result.errors.length,
  });

  return ok(result);
});
