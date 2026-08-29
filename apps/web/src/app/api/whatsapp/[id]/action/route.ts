import { assertTenantOwned, prisma, recordAudit } from '@msgflow/db';
import { connectionActionSchema } from '@msgflow/validation';
import { AppError } from '@msgflow/types';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';
import { callWorker } from '@/lib/worker-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Connection control: connect, reconnect, disconnect, logout, refresh QR,
 * sync groups. Each one calls the worker for real — none of these buttons is
 * decorative.
 */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('whatsapp:manage');
  const { id } = await params;
  const { action } = connectionActionSchema.parse(await readJson(request));

  const connection = assertTenantOwned(
    await prisma.whatsAppConnection.findUnique({ where: { id } }),
    context.tenantId,
    'WhatsApp connection',
  );

  const auditAction =
    action === 'disconnect'
      ? 'whatsapp.disconnected'
      : action === 'logout'
        ? 'whatsapp.logout'
        : action === 'reconnect'
          ? 'whatsapp.reconnect_requested'
          : 'whatsapp.connected';

  // Reflect intent immediately so the UI is honest while the worker works.
  if (['connect', 'reconnect'].includes(action)) {
    await prisma.whatsAppConnection.update({
      where: { id: connection.id },
      data: { status: 'CONNECTING', lastErrorMessage: null },
    });
  }

  // Disconnect and logout are the way out of a bad state, so they must not be
  // blocked by the very thing that is broken. If the worker cannot be reached
  // we still tear down our own side: the session it holds is already lost to
  // us, and leaving someone stuck in ERROR with no working button is worse
  // than a local-only teardown they can see and understand.
  const teardown = action === 'disconnect' || action === 'logout';

  let workerResponse: unknown;
  let workerReachable = true;
  try {
    workerResponse = await callWorker(`/connections/${connection.id}/${action}`, {
      method: 'POST',
      body: { tenantId: context.tenantId, provider: connection.provider },
      timeoutMs: action === 'sync-groups' ? 45_000 : 20_000,
    });
  } catch (err) {
    if (!teardown) {
      // The worker being unreachable is a real, reportable state — not a silent
      // no-op that leaves the UI claiming "connecting" forever.
      await prisma.whatsAppConnection.update({
        where: { id: connection.id },
        data: {
          status: 'ERROR',
          lastErrorMessage: err instanceof AppError ? err.message : 'Worker unreachable',
        },
      });
      throw err;
    }
    workerReachable = false;
    workerResponse = { error: err instanceof AppError ? err.message : 'Worker unreachable' };
  }

  // A teardown the worker never heard about may leave a session running there;
  // say so on the connection rather than reporting a clean stop we did not get.
  const teardownNote = workerReachable
    ? null
    : 'Stopped in MsgFlow only — the WhatsApp service could not be reached, so it may still hold the session.';

  if (action === 'disconnect') {
    await prisma.whatsAppConnection.update({
      where: { id: connection.id },
      data: { status: 'DISCONNECTED', disconnectedAt: new Date(), qrCode: null, lastErrorMessage: teardownNote },
    });
  }

  if (action === 'logout') {
    await prisma.whatsAppConnection.update({
      where: { id: connection.id },
      data: {
        status: 'LOGGED_OUT',
        disconnectedAt: new Date(),
        qrCode: null,
        sessionRef: null,
        phoneNumber: null,
        lastErrorMessage: teardownNote,
      },
    });
  }

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: auditAction,
    entityType: 'WhatsAppConnection',
    entityId: connection.id,
    after: { action, workerReachable },
    ...(await requestMeta()),
  });

  return ok({ action, workerReachable, warning: teardownNote, worker: workerResponse });
});
