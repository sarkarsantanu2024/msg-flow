import { isGoogleConfigured } from '@msgflow/config';
import { encryptJson, prisma, recordAudit } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { integrationSchema } from '@msgflow/validation';
import { created, ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Integrations.
 *
 * Credentials are encrypted at rest (AES-256-GCM) and are never returned by
 * this API — responses expose only name, type and validity. An integration
 * without credentials is reported as MOCK rather than hidden, so the feature
 * stays visible and configurable before the keys exist.
 */
export const GET = route(async () => {
  const context = await requirePermission('integrations:manage');

  const integrations = await prisma.integration.findMany({
    where: { tenantId: context.tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      credentials: { select: { id: true, type: true, isValid: true, expiresAt: true, lastUsedAt: true } },
      _count: { select: { outputs: true } },
    },
  });

  return ok({
    integrations,
    capabilities: {
      googleConfigured: isGoogleConfigured(),
      // Surfaced so the UI can say plainly which integrations are live and
      // which need credentials before they can be activated.
      notes: isGoogleConfigured()
        ? []
        : ['Google Sheets runs in mock mode. Credentials required to activate this integration.'],
    },
  });
});

export const POST = route(async (request: Request) => {
  const context = await requirePermission('integrations:manage');
  const input = integrationSchema.parse(await readJson(request));

  const hasCredentials = input.credentials && Object.keys(input.credentials).length > 0;

  const integration = await prisma.integration.create({
    data: {
      tenantId: context.tenantId,
      type: input.type,
      name: input.name,
      config: input.config as Prisma.InputJsonValue,
      status: hasCredentials ? 'CONNECTED' : 'MOCK',
      credentials: hasCredentials
        ? {
            create: {
              tenantId: context.tenantId,
              type: input.credentialType,
              encryptedPayload: encryptJson(input.credentials),
            },
          }
        : undefined,
    },
    include: { credentials: { select: { id: true, type: true, isValid: true } } },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'integration.connected',
    entityType: 'Integration',
    entityId: integration.id,
    after: { name: input.name, type: input.type, hasCredentials },
    ...(await requestMeta()),
  });

  return created(integration);
});

export const DELETE = route(async (request: Request) => {
  const context = await requirePermission('integrations:manage');
  const id = new URL(request.url).searchParams.get('id');
  if (!id) throw new AppError('VALIDATION_FAILED', 'An integration id is required.');

  const integration = await prisma.integration.findFirst({
    where: { id, tenantId: context.tenantId },
    include: { _count: { select: { outputs: true } } },
  });
  if (!integration) throw new AppError('NOT_FOUND', 'That integration does not exist.');

  if (integration._count.outputs > 0) {
    throw new AppError(
      'CONFLICT',
      `${integration._count.outputs} output(s) still use this integration. Disconnect them first.`,
    );
  }

  await prisma.integration.delete({ where: { id: integration.id } });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'integration.disconnected',
    entityType: 'Integration',
    entityId: integration.id,
    ...(await requestMeta()),
  });

  return ok({ deleted: true });
});
