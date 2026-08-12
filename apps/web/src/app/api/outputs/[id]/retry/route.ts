import { assertTenantOwned, prisma } from '@msgflow/db';
import { retryFailedRows } from '@msgflow/workflow';
import { ok, route } from '@/lib/api';
import { requirePermission } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Retry only the rows that previously failed against this output. */
export const POST = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('outputs:sync');
  const { id } = await params;

  const output = assertTenantOwned(
    await prisma.output.findUnique({ where: { id } }),
    context.tenantId,
    'Output',
  );

  const results = await retryFailedRows(context.tenantId, output.id, context.userId);

  return ok({
    attempted: results.length,
    created: results.reduce((sum, r) => sum + r.created, 0),
    updated: results.reduce((sum, r) => sum + r.updated, 0),
    failed: results.reduce((sum, r) => sum + r.failed, 0),
    warnings: results.flatMap((r) => r.warnings),
  });
});
