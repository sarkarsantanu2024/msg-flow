import { prisma, recordAudit } from '@msgflow/db';
import { createConnectionSchema } from '@msgflow/validation';
import { created, ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';
import { getWhatsAppSummary } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async () => {
  const context = await requirePermission('whatsapp:read');
  const summary = await getWhatsAppSummary(context.tenantId, context.timezone);
  return ok(summary);
});

/** Create a WhatsApp connection. One per tenant is the normal case. */
export const POST = route(async (request: Request) => {
  const context = await requirePermission('whatsapp:manage');
  const input = createConnectionSchema.parse(await readJson(request));

  const existing = await prisma.whatsAppConnection.findFirst({ where: { tenantId: context.tenantId } });
  if (existing) return ok({ connectionId: existing.id, alreadyExists: true });

  const connection = await prisma.whatsAppConnection.create({
    data: {
      tenantId: context.tenantId,
      name: input.name,
      provider: input.provider,
      status: 'DISCONNECTED',
    },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'whatsapp.connected',
    entityType: 'WhatsAppConnection',
    entityId: connection.id,
    after: { name: input.name, provider: input.provider },
    ...(await requestMeta()),
  });

  return created({ connectionId: connection.id });
});
