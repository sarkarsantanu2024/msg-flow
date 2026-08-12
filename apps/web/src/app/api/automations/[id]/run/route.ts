import { assertTenantOwned, prisma } from '@msgflow/db';
import { runAutomationSchema } from '@msgflow/validation';
import { runAutomation } from '@msgflow/workflow';
import { recordAudit } from '@msgflow/db';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Run an automation now.
 *
 * This is what "Sync Now" and "Run" call. It resolves the configured window,
 * processes messages, and pushes results to every connected output — the full
 * pipeline, not a simulation.
 */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('automations:manage');
  const { id } = await params;

  const body = await readJson(request).catch(() => ({}));
  const input = runAutomationSchema.parse(body ?? {});

  const automation = assertTenantOwned(
    await prisma.automation.findUnique({ where: { id } }),
    context.tenantId,
    'Automation',
  );

  const result = await runAutomation({
    tenantId: context.tenantId,
    automationId: automation.id,
    trigger: input.trigger,
    startedBy: context.userId,
    from: input.from ? new Date(input.from) : null,
    to: input.to ? new Date(input.to) : null,
    force: input.force,
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'automation.run_triggered',
    entityType: 'Automation',
    entityId: automation.id,
    after: { runId: result.runId, status: result.status },
    ...(await requestMeta()),
  });

  return ok(result);
});
