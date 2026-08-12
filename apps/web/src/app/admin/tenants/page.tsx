import type { Metadata } from 'next';
import { prisma } from '@msgflow/db';
import { requireSuperAdmin } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { TenantsTable } from './tenants-table';

export const metadata: Metadata = { title: 'Tenants' };
export const dynamic = 'force-dynamic';

export default async function AdminTenantsPage() {
  await requireSuperAdmin();

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      subscription: { include: { plan: { select: { name: true } } } },
      _count: {
        select: { memberships: true, messages: true, automations: true, outputs: true, records: true },
      },
    },
  });

  return (
    <div>
      <PageHeader title="Tenants" description="Every workspace on this deployment." />

      <Card>
        <CardContent className="p-0">
          <TenantsTable
            tenants={tenants.map((t) => ({
              id: t.id,
              name: t.name,
              slug: t.slug,
              status: t.status,
              timezone: t.timezone,
              plan: t.subscription?.plan.name ?? null,
              members: t._count.memberships,
              messages: t._count.messages,
              automations: t._count.automations,
              outputs: t._count.outputs,
              records: t._count.records,
              createdAt: t.createdAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
