import { getAIProvider } from '@msgflow/ai';
import { prisma } from '@msgflow/db';
import { nlAutomationSchema } from '@msgflow/validation';
import { ok, enforceRateLimit, readJson, route } from '@/lib/api';
import { requirePermission } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Natural-language automation drafting.
 *
 * Returns a *draft only*. Nothing is written to the database and nothing is
 * activated — the user reviews every field on the confirmation screen and
 * presses Activate. An AI that could silently switch on a live data pipeline
 * would be a liability, not a feature.
 */
export const POST = route(async (request: Request) => {
  const context = await requirePermission('automations:manage');
  enforceRateLimit(`ai-generate:${context.tenantId}`, 'ai');

  const { prompt } = nlAutomationSchema.parse(await readJson(request));

  const groups = await prisma.whatsAppGroup.findMany({
    where: { tenantId: context.tenantId, isMonitored: true },
    select: { id: true, name: true },
    take: 50,
  });

  const provider = getAIProvider();
  const response = await provider.generateAutomation({
    prompt,
    availableGroups: groups.map((g) => ({ id: g.id, name: g.name })),
  });

  await prisma.aIUsage.create({
    data: {
      tenantId: context.tenantId,
      provider: response.meta.provider,
      model: response.meta.model,
      operation: 'generate_automation',
      inputTokens: response.meta.inputTokens,
      outputTokens: response.meta.outputTokens,
      costUsd: response.meta.costUsd,
      durationMs: response.meta.durationMs,
      success: true,
    },
  });

  return ok({
    draft: response.data,
    provider: response.meta.provider,
    usingFallback: provider.name === 'mock',
    availableGroups: groups,
  });
});
