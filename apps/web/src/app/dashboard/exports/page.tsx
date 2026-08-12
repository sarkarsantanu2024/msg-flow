import type { Metadata } from 'next';
import { prisma } from '@msgflow/db';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { ExportsPanel } from './exports-panel';

export const metadata: Metadata = { title: 'Exports' };
export const dynamic = 'force-dynamic';

export default async function ExportsPage() {
  const context = await requireTenant();

  const exports_ = await prisma.export.findMany({
    where: { tenantId: context.tenantId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div>
      <PageHeader
        title="Exports"
        description="One-off downloads of your data. For files you want kept continuously up to date, use Outputs instead."
      />

      <ExportsPanel
        timezone={context.timezone}
        exports={exports_.map((e) => ({
          id: e.id,
          entity: e.entity,
          format: e.format,
          fileName: e.fileName,
          status: e.status,
          recordCount: e.recordCount,
          sizeBytes: e.sizeBytes,
          createdAt: e.createdAt.toISOString(),
          expiresAt: e.expiresAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
