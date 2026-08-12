import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from '@/components/icon';
import { prisma } from '@msgflow/db';
import { describeSchedule } from '@msgflow/workflow';
import { requireTenant } from '@/lib/auth';
import { PageHeader, StatTile } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { formatDateTime, formatNumber, formatRelativeTime, humanize } from '@/lib/format';
import { AutomationControls } from './automation-controls';
import { ConnectOutputDialog } from './connect-output-dialog';

export const metadata: Metadata = { title: 'Automation' };
export const dynamic = 'force-dynamic';

export default async function AutomationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenant();
  const { id } = await params;

  const automation = await prisma.automation.findFirst({
    where: { id, tenantId: context.tenantId },
    include: {
      schema: { include: { fields: { orderBy: { order: 'asc' } } } },
      triggers: { include: { group: true } },
      outputTargets: { include: { output: true, mappings: { orderBy: { order: 'asc' } } } },
      runs: { orderBy: { queuedAt: 'desc' }, take: 15 },
      _count: { select: { records: true, runs: true } },
    },
  });

  if (!automation) notFound();

  const outputs = await prisma.output.findMany({
    where: { tenantId: context.tenantId },
    select: { id: true, name: true, type: true, config: true },
    orderBy: { createdAt: 'desc' },
  });

  const canManage = ['OWNER', 'ADMIN', 'OPERATOR'].includes(context.role);
  const schedule = describeSchedule({
    processingMode: automation.processingMode,
    scheduleHour: automation.scheduleHour,
    scheduleMinute: automation.scheduleMinute,
    scheduleWeekday: automation.scheduleWeekday,
    scheduleDay: automation.scheduleDay,
    cronExpression: automation.cronExpression,
  });

  const keyFields = automation.schema.fields.filter((f) => f.isKeyField);

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/dashboard/automations">
          <ArrowLeft className="h-4 w-4" /> Back to automations
        </Link>
      </Button>

      <PageHeader
        title={automation.name}
        description={automation.description ?? undefined}
        actions={
          canManage ? (
            <AutomationControls
              automationId={automation.id}
              status={automation.status}
              hasOutputs={automation.outputTargets.length > 0}
              hasGroups={automation.triggers.some((t) => t.groupId)}
            />
          ) : (
            <StatusBadge status={automation.status} />
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatTile label="Records" value={formatNumber(automation._count.records)} />
        <StatTile label="Runs" value={formatNumber(automation._count.runs)} />
        <StatTile
          label="Last successful run"
          value={formatRelativeTime(automation.lastSuccessfulRunAt)}
          hint={automation.lastSuccessfulRunAt ? formatDateTime(automation.lastSuccessfulRunAt, context.timezone) : undefined}
        />
        <StatTile
          label="Next run"
          value={automation.nextRunAt ? formatRelativeTime(automation.nextRunAt) : '—'}
          hint={automation.status === 'ACTIVE' ? schedule : 'Not scheduled'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Outputs</CardTitle>
                <CardDescription>Where this automation writes its structured data</CardDescription>
              </div>
              {canManage ? (
                <ConnectOutputDialog
                  automationId={automation.id}
                  sourceFields={automation.schema.fields.map((f) => ({
                    key: f.key,
                    label: f.label,
                    type: f.type,
                  }))}
                  outputs={outputs.map((o) => ({
                    id: o.id,
                    name: o.name,
                    type: o.type,
                    columns: ((o.config ?? {}) as { columns?: string[] }).columns ?? [],
                  }))}
                  existing={automation.outputTargets.map((t) => ({
                    outputId: t.outputId,
                    operation: t.operation,
                    mappings: t.mappings.map((m) => ({
                      sourceField: m.sourceField,
                      targetField: m.targetField,
                      updateStrategy: m.updateStrategy,
                      isKeyPart: m.isKeyPart,
                      keyOrder: m.keyOrder,
                    })),
                  }))}
                />
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {automation.outputTargets.length === 0 ? (
                <EmptyState
                  title="No output connected"
                  description="Extracted data needs a destination — an Excel file, a Google Sheet, or your own API. An automation cannot be activated without one."
                />
              ) : (
                <ul className="divide-y">
                  {automation.outputTargets.map((target) => (
                    <li key={target.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={`/dashboard/outputs/${target.outputId}`}
                          className="font-medium hover:underline"
                        >
                          {target.output.name}
                        </Link>
                        <div className="flex items-center gap-2">
                          <Badge variant="default">{humanize(target.operation)}</Badge>
                          <StatusBadge status={target.output.status} />
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {humanize(target.output.type)} · {target.mappings.length} field(s) mapped
                        {target.mappings.some((m) => m.isKeyPart)
                          ? ` · key: ${target.mappings
                              .filter((m) => m.isKeyPart)
                              .sort((a, b) => (a.keyOrder ?? 0) - (b.keyOrder ?? 0))
                              .map((m) => m.targetField)
                              .join(' + ')}`
                          : ' · no unique key'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent runs</CardTitle>
              <CardDescription>What each execution actually did</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {automation.runs.length === 0 ? (
                <EmptyState title="No runs yet" description="Use “Run now” to process messages immediately." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead className="text-right">Messages</TableHead>
                      <TableHead className="text-right">Created</TableHead>
                      <TableHead className="text-right">Updated</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {automation.runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>
                          <Link href={`/dashboard/runs/${run.id}`} className="hover:underline">
                            {formatDateTime(run.queuedAt, context.timezone)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{humanize(run.trigger)}</TableCell>
                        <TableCell className="text-right tabular">{run.messagesProcessed}</TableCell>
                        <TableCell className="text-right tabular">{run.recordsCreated}</TableCell>
                        <TableCell className="text-right tabular">{run.recordsUpdated}</TableCell>
                        <TableCell className="text-right tabular">{run.recordsFailed}</TableCell>
                        <TableCell>
                          <StatusBadge status={run.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                {[
                  ['Processing', schedule],
                  ['Date range', humanize(automation.dateRangeMode)],
                  ['Timezone', automation.timezone || context.timezone],
                  ['Only important messages', automation.requireImportant ? 'Yes' : 'No'],
                  ['Minimum confidence', `${Math.round(automation.minConfidence * 100)}%`],
                  ['Keyword filter', automation.keywordFilter || 'None'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Source groups</CardTitle>
            </CardHeader>
            <CardContent>
              {automation.triggers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No groups selected.</p>
              ) : (
                <ul className="space-y-2">
                  {automation.triggers.map((trigger) => (
                    <li key={trigger.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{trigger.group?.name ?? 'Unknown group'}</span>
                      {trigger.group?.isMonitored ? (
                        <Badge variant="success">Monitored</Badge>
                      ) : (
                        <Badge variant="warning">Not monitored</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{automation.schema.name}</CardTitle>
              <CardDescription>
                {keyFields.length > 0
                  ? `Records identified by ${keyFields.map((f) => f.label).join(' + ')}`
                  : 'No key fields declared'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm">
                {automation.schema.fields.map((field) => (
                  <li key={field.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {field.label}
                      {field.required ? <span className="ml-1 text-destructive">*</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{humanize(field.type)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
