import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Workflow } from '@/components/icon';
import { prisma } from '@msgflow/db';
import { describeSchedule, formatRelative } from '@msgflow/workflow';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { AutomationCard } from './automation-card';

export const metadata: Metadata = { title: 'Automations' };
export const dynamic = 'force-dynamic';

export default async function AutomationsPage() {
  const context = await requireTenant();

  const automations = await prisma.automation.findMany({
    where: { tenantId: context.tenantId, status: { not: 'ARCHIVED' } },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    include: {
      schema: { select: { name: true, _count: { select: { fields: true } } } },
      triggers: { include: { group: { select: { name: true } } } },
      outputTargets: { include: { output: { select: { id: true, name: true, type: true, status: true } } } },
      runs: { orderBy: { queuedAt: 'desc' }, take: 1 },
      _count: { select: { records: true, runs: true } },
    },
  });

  const canManage = ['OWNER', 'ADMIN', 'OPERATOR'].includes(context.role);

  return (
    <div>
      <PageHeader
        title="Automations"
        description="An automation decides which messages to read, what to extract, and where the result goes."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/dashboard/automations/new">
                <Plus className="h-4 w-4" /> New automation
              </Link>
            </Button>
          ) : null
        }
      />

      {automations.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Workflow}
              title="No automations yet"
              description="Describe what you want in plain English and MsgFlow will draft the extraction schema, schedule and output for you to review."
              action={
                canManage ? (
                  <Button asChild>
                    <Link href="/dashboard/automations/new">Create your first automation</Link>
                  </Button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {automations.map((automation) => (
            <AutomationCard
              key={automation.id}
              canManage={canManage}
              automation={{
                id: automation.id,
                name: automation.name,
                description: automation.description,
                status: automation.status,
                schemaName: automation.schema.name,
                fieldCount: automation.schema._count.fields,
                schedule: describeSchedule({
                  processingMode: automation.processingMode,
                  scheduleHour: automation.scheduleHour,
                  scheduleMinute: automation.scheduleMinute,
                  scheduleWeekday: automation.scheduleWeekday,
                  scheduleDay: automation.scheduleDay,
                  cronExpression: automation.cronExpression,
                }),
                groups: automation.triggers.map((t) => t.group?.name ?? 'Unknown').filter(Boolean),
                outputs: automation.outputTargets.map((t) => ({
                  id: t.output.id,
                  name: t.output.name,
                  type: t.output.type,
                  operation: t.operation,
                  status: t.output.status,
                })),
                recordCount: automation._count.records,
                runCount: automation._count.runs,
                lastRunStatus: automation.runs[0]?.status ?? null,
                lastRunLabel: formatRelative(automation.lastRunAt),
                nextRunLabel: automation.nextRunAt ? formatRelative(automation.nextRunAt) : null,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
