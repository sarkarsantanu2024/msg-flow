import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { DEFAULT_PAGE_SIZE } from '@msgflow/config';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Button } from '@/components/ui/button';
import { MessageFilters } from './message-filters';
import { MessageRow } from './message-row';
import { Pagination } from '@/components/dashboard/pagination';

export const metadata: Metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await requireTenant();
  const params = await searchParams;

  const page = Math.max(1, Number(params.page ?? 1));
  const pageSize = DEFAULT_PAGE_SIZE;

  const where: Prisma.MessageWhereInput = { tenantId: context.tenantId };

  if (params.search) {
    where.OR = [
      { text: { contains: params.search, mode: 'insensitive' } },
      { senderName: { contains: params.search, mode: 'insensitive' } },
    ];
  }
  if (params.groupId) where.groupId = params.groupId;
  if (params.status) where.status = params.status as Prisma.MessageWhereInput['status'];
  if (params.from || params.to) {
    where.timestamp = {
      ...(params.from ? { gte: new Date(`${params.from}T00:00:00`) } : {}),
      ...(params.to ? { lte: new Date(`${params.to}T23:59:59`) } : {}),
    };
  }
  if (params.category || params.importance) {
    where.classification = {
      ...(params.category ? { category: params.category as never } : {}),
      ...(params.importance ? { importance: params.importance as never } : {}),
    };
  }

  const [messages, total, groups, automations] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        group: { select: { id: true, name: true } },
        classification: true,
        recordSources: { select: { recordId: true } },
      },
    }),
    prisma.message.count({ where }),
    prisma.whatsAppGroup.findMany({
      where: { tenantId: context.tenantId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.automation.findMany({
      where: { tenantId: context.tenantId, status: { not: 'ARCHIVED' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Messages"
        description="Every captured message, with what the AI made of it and what it produced."
      />

      <MessageFilters groups={groups} />

      <Card className="mt-4">
        <CardContent className="p-0">
          {messages.length === 0 ? (
            <EmptyState
              title="No messages match"
              description={
                total === 0 && Object.keys(params).length === 0
                  ? 'Once WhatsApp is connected and you monitor a group, messages will appear here within seconds.'
                  : 'Try widening the filters or the date range.'
              }
              action={
                total === 0 ? (
                  <Button asChild>
                    <Link href="/dashboard/whatsapp">Connect WhatsApp</Link>
                  </Button>
                ) : null
              }
            />
          ) : (
            <ul className="divide-y">
              {messages.map((message) => (
                <MessageRow
                  key={message.id}
                  canReprocess={['OWNER', 'ADMIN', 'OPERATOR'].includes(context.role)}
                  automations={automations}
                  timezone={context.timezone}
                  message={{
                    id: message.id,
                    text: message.text,
                    senderName: message.senderName,
                    senderPhone: message.senderPhone,
                    groupName: message.group?.name ?? null,
                    timestamp: message.timestamp.toISOString(),
                    status: message.status,
                    ingestSource: message.ingestSource,
                    errorMessage: message.errorMessage,
                    category: message.classification?.category ?? null,
                    importance: message.classification?.importance ?? null,
                    confidence: message.classification?.confidence ?? null,
                    reasoning: message.classification?.reasoning ?? null,
                    recordCount: message.recordSources.length,
                    recordId: message.recordSources[0]?.recordId ?? null,
                  }}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
