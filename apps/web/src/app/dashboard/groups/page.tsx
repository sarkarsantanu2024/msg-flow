import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@msgflow/db';
import { requireTenant } from '@/lib/auth';
import { PageHeader, StatTile } from '@/components/dashboard/page-header';
import { GroupsTable } from './groups-table';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Groups' };
export const dynamic = 'force-dynamic';

export default async function GroupsPage() {
  const context = await requireTenant();

  const groups = await prisma.whatsAppGroup.findMany({
    where: { tenantId: context.tenantId },
    orderBy: [{ isMonitored: 'desc' }, { lastMessageAt: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { messages: true, triggers: true } },
      triggers: { include: { automation: { select: { id: true, name: true, status: true } } } },
    },
  });

  const monitored = groups.filter((g) => g.isMonitored).length;
  const totalMessages = groups.reduce((sum, g) => sum + g._count.messages, 0);

  return (
    <div>
      <PageHeader
        title="Groups"
        description="Only monitored groups enter the processing pipeline. Everything else is ignored entirely."
      />

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            title="No groups discovered yet"
            description="Connect WhatsApp, then run a group sync to discover the groups this account belongs to."
            action={
              <Button asChild>
                <Link href="/dashboard/whatsapp">Go to WhatsApp</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Groups discovered" value={groups.length} />
            <StatTile label="Monitored" value={monitored} tone={monitored > 0 ? 'success' : 'warning'} />
            <StatTile label="Messages captured" value={totalMessages} />
          </div>

          <GroupsTable
            canManage={['OWNER', 'ADMIN', 'OPERATOR'].includes(context.role)}
            timezone={context.timezone}
            groups={groups.map((g) => ({
              id: g.id,
              name: g.name,
              externalId: g.externalId,
              participantCount: g.participantCount,
              isMonitored: g.isMonitored,
              messageCount: g._count.messages,
              lastMessageAt: g.lastMessageAt?.toISOString() ?? null,
              automations: g.triggers.map((t) => ({
                id: t.automation.id,
                name: t.automation.name,
                status: t.automation.status,
              })),
            }))}
          />
        </div>
      )}
    </div>
  );
}
