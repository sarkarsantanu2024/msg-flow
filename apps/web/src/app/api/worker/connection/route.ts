import { prisma } from '@msgflow/db';
import { createLogger } from '@msgflow/logger';
import { connectionStateReportSchema, groupSyncSchema } from '@msgflow/validation';
import { ok, readJson, route } from '@/lib/api';
import { requireWorkerAuth } from '@/lib/worker-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const log = createLogger('api:worker-connection');

/**
 * Connection state reported by the worker.
 *
 * Every transition is also written to ConnectionEvent, and a drop raises a
 * notification. The specification is explicit that the system must never
 * silently continue as if WhatsApp were still connected.
 */
export const POST = route(async (request: Request) => {
  requireWorkerAuth(request);
  const payload = connectionStateReportSchema.parse(await readJson(request));

  const connection = await prisma.whatsAppConnection.findFirst({
    where: { id: payload.connectionId, tenantId: payload.tenantId },
  });
  if (!connection) return ok({ updated: false, reason: 'Unknown connection' });

  const previousStatus = connection.status;
  const nextStatus = payload.state;

  const worker = payload.workerName
    ? await prisma.worker.findUnique({ where: { name: payload.workerName } })
    : null;

  const isReady = nextStatus === 'READY';
  const wasReady = previousStatus === 'READY';

  await prisma.whatsAppConnection.update({
    where: { id: connection.id },
    data: {
      status: nextStatus,
      phoneNumber: payload.phoneNumber ?? connection.phoneNumber,
      displayName: payload.displayName ?? connection.displayName,
      qrCode: nextStatus === 'QR_REQUIRED' ? (payload.qrCode ?? null) : null,
      qrExpiresAt: nextStatus === 'QR_REQUIRED' ? new Date(Date.now() + 60_000) : null,
      lastErrorMessage: payload.lastError ?? null,
      lastHeartbeatAt: new Date(),
      workerId: worker?.id ?? connection.workerId,
      connectedAt: isReady && !wasReady ? new Date() : connection.connectedAt,
      disconnectedAt: !isReady && wasReady ? new Date() : connection.disconnectedAt,
    },
  });

  if (previousStatus !== nextStatus) {
    await prisma.connectionEvent.create({
      data: {
        tenantId: payload.tenantId,
        connectionId: connection.id,
        eventType: nextStatus,
        fromStatus: previousStatus,
        toStatus: nextStatus,
        message: payload.lastError ?? null,
      },
    });

    const lostConnection = wasReady && ['DISCONNECTED', 'ERROR', 'LOGGED_OUT'].includes(nextStatus);

    if (lostConnection) {
      await prisma.notification.create({
        data: {
          tenantId: payload.tenantId,
          severity: 'ERROR',
          code: 'WHATSAPP_CONNECTION_LOST',
          title: 'WhatsApp connection lost',
          body: `"${connection.name}" disconnected. Automation processing is paused until it reconnects.`,
          link: '/dashboard/whatsapp',
        },
      });
      // Trim any unread duplicates this flap may have piled up, keeping the newest.
      const lostDupes = await prisma.notification.findMany({
        where: { tenantId: payload.tenantId, code: 'WHATSAPP_CONNECTION_LOST', readAt: null },
        orderBy: { createdAt: 'desc' },
        skip: 1,
        select: { id: true },
      });
      if (lostDupes.length > 0) {
        await prisma.notification.deleteMany({ where: { id: { in: lostDupes.map((d) => d.id) } } });
      }
    } else if (isReady && !wasReady) {
      // A worker restart or tunnel blip produces a reconnect, and a notification
      // per reconnect is spam — seven identical "WhatsApp connected" rows tell
      // the user nothing six of the first one didn't. Only notify when the user
      // has no unread copy of the same event.
      const unreadDuplicate = await prisma.notification.findFirst({
        where: {
          tenantId: payload.tenantId,
          code: 'WHATSAPP_CONNECTED',
          readAt: null,
        },
      });
      if (!unreadDuplicate) {
        await prisma.notification.create({
          data: {
            tenantId: payload.tenantId,
            severity: 'SUCCESS',
            code: 'WHATSAPP_CONNECTED',
            title: 'WhatsApp connected',
            body: `"${connection.name}" is ready and listening.`,
            link: '/dashboard/whatsapp',
          },
        });
      }
    }

    log.info('Connection state changed', {
      connectionId: connection.id,
      from: previousStatus,
      to: nextStatus,
    });
  }

  return ok({ updated: true });
});

/** Group discovery results pushed by the worker. */
export const PUT = route(async (request: Request) => {
  requireWorkerAuth(request);
  const payload = groupSyncSchema.parse(await readJson(request));

  const connection = await prisma.whatsAppConnection.findFirst({
    where: { id: payload.connectionId, tenantId: payload.tenantId },
  });
  if (!connection) return ok({ synced: 0 });

  let synced = 0;
  for (const group of payload.groups) {
    await prisma.whatsAppGroup.upsert({
      where: { connectionId_externalId: { connectionId: connection.id, externalId: group.externalId } },
      create: {
        tenantId: payload.tenantId,
        connectionId: connection.id,
        externalId: group.externalId,
        name: group.name,
        description: group.description,
        participantCount: group.participantCount,
        isGroup: group.isGroup,
        // Monitoring is opt-in: discovering a group must never start ingesting
        // it without the user choosing to.
        isMonitored: false,
      },
      update: {
        name: group.name,
        description: group.description,
        participantCount: group.participantCount,
      },
    });
    synced++;
  }

  log.info('Groups synced', { connectionId: connection.id, synced });
  return ok({ synced });
});
