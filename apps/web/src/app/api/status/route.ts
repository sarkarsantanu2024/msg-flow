import { ok, route } from '@/lib/api';
import { requireTenantApi } from '@/lib/auth';
import { getStatusPayload } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Live status for the dashboard status bar. Polled every 10 seconds. */
export const GET = route(async () => {
  const context = await requireTenantApi();
  const payload = await getStatusPayload(context.tenantId, context.timezone);
  return ok(payload);
});
