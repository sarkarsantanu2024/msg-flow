import { prisma } from '@msgflow/db';
import { ok, route } from '@/lib/api';
import { requireTenantApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = route(async () => {
  const context = await requireTenantApi();
  const result = await prisma.notification.updateMany({
    where: { tenantId: context.tenantId, readAt: null },
    data: { readAt: new Date() },
  });
  return ok({ marked: result.count });
});
