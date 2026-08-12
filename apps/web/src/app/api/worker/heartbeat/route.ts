import { prisma } from '@msgflow/db';
import { workerStatusReportSchema } from '@msgflow/validation';
import { ok, readJson, route } from '@/lib/api';
import { requireWorkerAuth } from '@/lib/worker-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Worker liveness. Absence of these is what marks a worker dead. */
export const POST = route(async (request: Request) => {
  requireWorkerAuth(request);
  const payload = workerStatusReportSchema.parse(await readJson(request));

  const worker = await prisma.worker.upsert({
    where: { name: payload.workerName },
    create: {
      name: payload.workerName,
      hostname: payload.hostname,
      pid: payload.pid ?? null,
      version: payload.version ?? null,
      status: payload.status,
      capabilities: payload.capabilities,
      lastHeartbeatAt: new Date(),
    },
    update: {
      hostname: payload.hostname,
      pid: payload.pid ?? null,
      version: payload.version ?? null,
      status: payload.status,
      capabilities: payload.capabilities,
      lastHeartbeatAt: new Date(),
    },
  });

  await prisma.workerHeartbeat.create({
    data: {
      workerId: worker.id,
      status: payload.status,
      cpuPercent: payload.cpuPercent ?? null,
      memoryMb: payload.memoryMb ?? null,
      uptimeSec: payload.uptimeSec ?? null,
      connections: payload.connections,
      messagesSeen: payload.messagesSeen,
      queueDepth: payload.queueDepth,
    },
  });

  // Keep the heartbeat table bounded — it is high-frequency and only the recent
  // window is ever displayed.
  await prisma.workerHeartbeat.deleteMany({
    where: { workerId: worker.id, createdAt: { lt: new Date(Date.now() - 6 * 3_600_000) } },
  });

  return ok({ workerId: worker.id });
});
