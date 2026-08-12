import type { Metadata } from 'next';
import { prisma } from '@msgflow/db';
import { getProviderStatus } from '@msgflow/ai';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { DemoConsole } from './demo-console';

export const metadata: Metadata = { title: 'Demo Mode' };
export const dynamic = 'force-dynamic';

export default async function DemoPage() {
  const context = await requireTenant();

  const [schemas, automations] = await Promise.all([
    prisma.extractionSchema.findMany({
      where: { tenantId: context.tenantId },
      select: { id: true, name: true, _count: { select: { fields: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.automation.findMany({
      where: { tenantId: context.tenantId, status: { not: 'ARCHIVED' } },
      select: { id: true, name: true, _count: { select: { outputTargets: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const provider = getProviderStatus();

  return (
    <div>
      <PageHeader
        title="Demo Mode"
        description="Type a message and watch it travel the full pipeline — classification, extraction, validation and the output row it would produce. No WhatsApp connection needed."
      />

      <DemoConsole
        schemas={schemas.map((s) => ({ id: s.id, name: s.name, fieldCount: s._count.fields }))}
        automations={automations.map((a) => ({
          id: a.id,
          name: a.name,
          outputCount: a._count.outputTargets,
        }))}
        provider={provider.active}
        usingFallback={provider.usingFallback}
      />
    </div>
  );
}
