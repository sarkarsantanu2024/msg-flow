import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from '@/components/icon';
import { prisma } from '@msgflow/db';
import { getProviderStatus } from '@msgflow/ai';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { AutomationBuilder } from './automation-builder';

export const metadata: Metadata = { title: 'New automation' };
export const dynamic = 'force-dynamic';

export default async function NewAutomationPage() {
  const context = await requireTenant();

  const [groups, schemas, outputs] = await Promise.all([
    prisma.whatsAppGroup.findMany({
      where: { tenantId: context.tenantId },
      select: { id: true, name: true, isMonitored: true },
      orderBy: [{ isMonitored: 'desc' }, { name: 'asc' }],
    }),
    prisma.extractionSchema.findMany({
      where: { tenantId: context.tenantId },
      include: { fields: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.output.findMany({
      where: { tenantId: context.tenantId },
      select: { id: true, name: true, type: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const providerStatus = getProviderStatus();

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/dashboard/automations">
          <ArrowLeft className="h-4 w-4" /> Back to automations
        </Link>
      </Button>

      <PageHeader
        title="New automation"
        description="Describe what you want in plain English, or configure every field yourself. Nothing runs until you activate it."
      />

      <AutomationBuilder
        groups={groups}
        schemas={schemas.map((s) => ({
          id: s.id,
          name: s.name,
          fields: s.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required })),
        }))}
        outputs={outputs}
        timezone={context.timezone}
        aiProvider={providerStatus.active}
        usingFallback={providerStatus.usingFallback}
      />
    </div>
  );
}
