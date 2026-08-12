import type { Metadata } from 'next';
import { prisma } from '@msgflow/db';
import { requireTenant } from '@/lib/auth';
import { getWhatsAppSummary } from '@/lib/queries';
import { PageHeader } from '@/components/dashboard/page-header';
import { WhatsAppPanel } from './whatsapp-panel';

export const metadata: Metadata = { title: 'WhatsApp' };
export const dynamic = 'force-dynamic';

export default async function WhatsAppPage() {
  const context = await requireTenant();

  const [summary, connection, events, worker] = await Promise.all([
    getWhatsAppSummary(context.tenantId, context.timezone),
    prisma.whatsAppConnection.findFirst({
      where: { tenantId: context.tenantId },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.connectionEvent.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    }),
    prisma.worker.findFirst({
      orderBy: { lastHeartbeatAt: 'desc' },
      include: { heartbeats: { orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="WhatsApp"
        description="Connect the WhatsApp account that receives your business messages, and see exactly what state it is in."
      />

      <WhatsAppPanel
        initialSummary={summary}
        connectionId={connection?.id ?? null}
        provider={connection?.provider ?? 'WHATSAPP_WEB'}
        canManage={['OWNER', 'ADMIN', 'OPERATOR'].includes(context.role)}
        events={events.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          message: e.message,
          occurredAt: e.occurredAt.toISOString(),
        }))}
        worker={
          worker
            ? {
                name: worker.name,
                hostname: worker.hostname,
                status: worker.status,
                version: worker.version,
                lastHeartbeatAt: worker.lastHeartbeatAt?.toISOString() ?? null,
                memoryMb: worker.heartbeats[0]?.memoryMb ?? null,
                uptimeSec: worker.heartbeats[0]?.uptimeSec ?? null,
              }
            : null
        }
        timezone={context.timezone}
      />
    </div>
  );
}
