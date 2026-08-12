import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ArrowRight, MessageSquare, Plus, Sparkles } from '@/components/icon';
import { requireTenant } from '@/lib/auth';
import {
  getAutomationHealth,
  getDashboardMetrics,
  getRecentActivity,
  getTimeSeries,
  resolvePreset,
} from '@/lib/queries';
import { PageHeader, StatTile } from '@/components/dashboard/page-header';
import { DateFilter, parseDateParams } from '@/components/dashboard/date-filter';
import { TrendChart, BarsChart } from '@/components/charts';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSkeleton, EmptyState } from '@/components/ui/states';
import { formatNumber, formatRelativeTime, humanize } from '@/lib/format';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const context = await requireTenant();
  const params = await searchParams;
  const { preset, from, to } = parseDateParams(params);
  const range = resolvePreset(preset, context.timezone, new Date(), { from, to });

  const [metrics, series, automations, activity] = await Promise.all([
    getDashboardMetrics(context.tenantId, range.start, range.end),
    getTimeSeries(context.tenantId, range.start, range.end, context.timezone),
    getAutomationHealth(context.tenantId),
    getRecentActivity(context.tenantId),
  ]);

  const isEmpty = metrics.messages === 0 && automations.length === 0;

  return (
    <div>
      <PageHeader
        title={`Welcome back${context.name ? `, ${context.name.split(' ')[0]}` : ''}`}
        description={`${range.label} · ${context.tenantName}`}
        actions={<DateFilter compact />}
      />

      {isEmpty ? (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="Let's get your first messages flowing"
            description="Connect WhatsApp, choose which groups to monitor, and create an automation that turns those messages into structured business data. You can also try Demo Mode without connecting anything."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild>
                  <Link href="/dashboard/whatsapp">
                    Connect WhatsApp <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard/demo">
                    <Sparkles className="h-4 w-4" /> Try Demo Mode
                  </Link>
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <Suspense fallback={<CardSkeleton count={5} />}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <StatTile label="Messages" value={formatNumber(metrics.messages)} hint={range.label} />
              <StatTile label="Important" value={formatNumber(metrics.important)} hint="High or medium" />
              <StatTile label="Records created" value={formatNumber(metrics.recordsCreated)} tone="success" />
              <StatTile label="Records updated" value={formatNumber(metrics.recordsUpdated)} tone="success" />
              <StatTile
                label="Needs review"
                value={formatNumber(metrics.reviewRequired)}
                tone={metrics.reviewRequired > 0 ? 'warning' : 'default'}
                hint={metrics.reviewRequired > 0 ? 'Waiting on you' : 'All clear'}
              />
            </div>
          </Suspense>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile label="AI extracted" value={formatNumber(metrics.extracted)} />
            <StatTile label="Skipped" value={formatNumber(metrics.recordsSkipped)} />
            <StatTile
              label="Failed"
              value={formatNumber(metrics.recordsFailed)}
              tone={metrics.recordsFailed > 0 ? 'destructive' : 'default'}
            />
            <StatTile label="Workflow success" value={formatNumber(metrics.workflowSuccess)} tone="success" />
            <StatTile
              label="Workflow failures"
              value={formatNumber(metrics.workflowFailed)}
              tone={metrics.workflowFailed > 0 ? 'destructive' : 'default'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Messages by day</CardTitle>
                <CardDescription>Total captured versus flagged as important</CardDescription>
              </CardHeader>
              <CardContent>
                <TrendChart
                  data={series}
                  series={[
                    { key: 'messages', name: 'Messages' },
                    { key: 'important', name: 'Important' },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Records &amp; automation runs</CardTitle>
                <CardDescription>Structured records extracted and workflow executions</CardDescription>
              </CardHeader>
              <CardContent>
                <BarsChart
                  data={series}
                  series={[
                    { key: 'records', name: 'Records' },
                    { key: 'runs', name: 'Runs' },
                  ]}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Automations</CardTitle>
                  <CardDescription>Health, last sync and what runs next</CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard/automations">
                    <Plus className="h-3.5 w-3.5" /> New
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {automations.length === 0 ? (
                  <EmptyState
                    title="No automations yet"
                    description="An automation decides which messages to read, what to extract from them, and where the result goes."
                    action={
                      <Button asChild size="sm">
                        <Link href="/dashboard/automations/new">Create automation</Link>
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-y">
                    {automations.slice(0, 6).map((automation) => (
                      <li key={automation.id} className="flex items-center gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/dashboard/automations/${automation.id}`}
                            className="truncate font-medium hover:underline"
                          >
                            {automation.name}
                          </Link>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {humanize(automation.processingMode)}
                            {automation.outputs.length > 0
                              ? ` → ${automation.outputs.map((o) => o.name).join(', ')}`
                              : ' · no output configured'}
                          </p>
                        </div>
                        <div className="hidden text-right text-xs text-muted-foreground sm:block">
                          {automation.status === 'ACTIVE' && automation.nextRunAt ? (
                            <>Next {formatRelativeTime(automation.nextRunAt)}</>
                          ) : (
                            <>Last sync {formatRelativeTime(automation.lastSuccessfulRunAt)}</>
                          )}
                        </div>
                        <StatusBadge status={automation.errors > 0 ? 'FAILED' : automation.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent activity</CardTitle>
                <CardDescription>Latest workflow runs</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {activity.length === 0 ? (
                  <EmptyState icon={MessageSquare} title="Nothing has run yet" />
                ) : (
                  <ul className="divide-y">
                    {activity.map((run) => (
                      <li key={run.id} className="px-5 py-2.5">
                        <Link href={`/dashboard/runs/${run.id}`} className="block hover:underline">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">
                              {run.automation?.name ?? run.output?.name ?? 'Manual run'}
                            </span>
                            <StatusBadge status={run.status} />
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatNumber(run.recordsCreated)} created · {formatNumber(run.recordsUpdated)} updated
                            {' · '}
                            {formatRelativeTime(run.queuedAt)}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
