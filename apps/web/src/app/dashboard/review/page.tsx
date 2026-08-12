import type { Metadata } from 'next';
import { CheckCircle2 } from '@/components/icon';
import { prisma } from '@msgflow/db';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { ReviewList } from './review-list';

export const metadata: Metadata = { title: 'Review Queue' };
export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const context = await requireTenant();

  // Low-confidence and failed extractions both land here: the queue exists so
  // uncertain data never reaches a customer's file unreviewed.
  const records = await prisma.extractedRecord.findMany({
    where: { tenantId: context.tenantId, status: 'NEEDS_REVIEW' },
    orderBy: [{ confidence: 'asc' }, { updatedAt: 'desc' }],
    take: 100,
    include: {
      schema: { include: { fields: { orderBy: { order: 'asc' } } } },
      automation: { select: { id: true, name: true } },
      originMessage: { include: { group: { select: { name: true } } } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Review Queue"
        description="Extractions the AI was not confident about, or that failed validation. Nothing here has been written to your outputs."
      />

      {records.length === 0 ? (
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title="Nothing needs review"
            description="Records land here when the AI's confidence falls below your threshold or a value fails schema validation."
          />
        </Card>
      ) : (
        <ReviewList
          canReview={['OWNER', 'ADMIN', 'OPERATOR'].includes(context.role)}
          timezone={context.timezone}
          records={records.map((record) => ({
            id: record.id,
            naturalKey: record.naturalKey,
            confidence: record.confidence,
            updatedAt: record.updatedAt.toISOString(),
            schemaName: record.schema.name,
            automationName: record.automation?.name ?? null,
            data: (record.data ?? {}) as Record<string, unknown>,
            fields: record.schema.fields.map((f) => ({
              key: f.key,
              label: f.label,
              type: f.type,
              required: f.required,
              enumValues: f.enumValues,
            })),
            sourceText: record.originMessage?.text ?? null,
            sourceSender: record.originMessage?.senderName ?? null,
            sourceGroup: record.originMessage?.group?.name ?? null,
            sourceAt: record.originMessage?.timestamp.toISOString() ?? null,
          }))}
        />
      )}
    </div>
  );
}
