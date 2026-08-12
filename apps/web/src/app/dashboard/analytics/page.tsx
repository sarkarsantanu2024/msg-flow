import type { Metadata } from 'next';
import { prisma } from '@msgflow/db';
import { enumerateHours, startOfLocalDay } from '@msgflow/workflow';
import { requireTenant } from '@/lib/auth';
import { getCategoryBreakdown, getDashboardMetrics, getTimeSeries, resolvePreset } from '@/lib/queries';
import { PageHeader, StatTile } from '@/components/dashboard/page-header';
import { DateFilter, parseDateParams } from '@/components/dashboard/date-filter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarsChart, CategoryChart, LinesChart, TrendChart } from '@/components/charts';
import { formatNumber, humanize } from '@/lib/format';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const context = await requireTenant();
  const params = await searchParams;
  const { preset, from, to } = parseDateParams(params);
  const range = resolvePreset(preset, context.timezone, new Date(), { from, to });

  const todayStart = startOfLocalDay(new Date(), context.timezone);
  const hourBuckets = enumerateHours(todayStart, context.timezone);

  const [metrics, series, categories, todayMessages, groupBreakdown, automationBreakdown] = await Promise.all([
    getDashboardMetrics(context.tenantId, range.start, range.end),
    getTimeSeries(context.tenantId, range.start, range.end, context.timezone),
    getCategoryBreakdown(context.tenantId, range.start, range.end),
    prisma.message.findMany({
      where: { tenantId: context.tenantId, timestamp: { gte: todayStart } },
      select: { timestamp: true },
    }),
    prisma.message.groupBy({
      by: ['groupId'],
      where: { tenantId: context.tenantId, timestamp: { gte: range.start, lt: range.end } },
      _count: { groupId: true },
      orderBy: { _count: { groupId: 'desc' } },
      take: 8,
    }),
    prisma.workflowRun.groupBy({
      by: ['automationId'],
      where: { tenantId: context.tenantId, queuedAt: { gte: range.start, lt: range.end } },
      _count: { automationId: true },
      _sum: { recordsCreated: true, recordsUpdated: true },
      orderBy: { _count: { automationId: 'desc' } },
      take: 8,
    }),
  ]);

  const groups = await prisma.whatsAppGroup.findMany({
    where: { id: { in: groupBreakdown.map((g) => g.groupId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, name: true },
  });
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  const automations = await prisma.automation.findMany({
    where: {
      id: { in: automationBreakdown.map((a) => a.automationId).filter((id): id is string => Boolean(id)) },
    },
    select: { id: true, name: true },
  });
  const automationName = new Map(automations.map((a) => [a.id, a.name]));

  // Hourly buckets for the Day tab.
  const hourly = hourBuckets.map((bucket) => ({
    label: bucket.label,
    messages: todayMessages.filter((m) => m.timestamp >= bucket.start && m.timestamp < bucket.end).length,
  }));

  // Weekly rollup for the Week tab: sum each Mon–Sun window inside the range.
  const weekly = series.reduce<Array<{ label: string; messages: number; records: number }>>((acc, point, index) => {
    const weekIndex = Math.floor(index / 7);
    if (!acc[weekIndex]) acc[weekIndex] = { label: `Week ${weekIndex + 1}`, messages: 0, records: 0 };
    acc[weekIndex].messages += point.messages;
    acc[weekIndex].records += point.records;
    return acc;
  }, []);

  return (
    <div>
      <PageHeader
        title="Analytics"
        description={`${range.label} · times shown in ${context.timezone}`}
        actions={<DateFilter />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Messages" value={formatNumber(metrics.messages)} />
        <StatTile label="Important" value={formatNumber(metrics.important)} />
        <StatTile label="AI processed" value={formatNumber(metrics.extracted)} />
        <StatTile label="Created" value={formatNumber(metrics.recordsCreated)} tone="success" />
        <StatTile label="Updated" value={formatNumber(metrics.recordsUpdated)} tone="success" />
        <StatTile
          label="Failed"
          value={formatNumber(metrics.recordsFailed + metrics.workflowFailed)}
          tone={metrics.recordsFailed + metrics.workflowFailed > 0 ? 'destructive' : 'default'}
        />
      </div>

      <Tabs defaultValue="day">
        <TabsList>
          <TabsTrigger value="day">Day</TabsTrigger>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="month">Month</TabsTrigger>
        </TabsList>

        <TabsContent value="day">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Today, hour by hour</CardTitle>
              <CardDescription>Message volume across the current local day</CardDescription>
            </CardHeader>
            <CardContent>
              <BarsChart data={hourly} series={[{ key: 'messages', name: 'Messages' }]} height={280} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="week">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">By week</CardTitle>
              <CardDescription>Weeks run Monday to Sunday</CardDescription>
            </CardHeader>
            <CardContent>
              <BarsChart
                data={weekly}
                series={[
                  { key: 'messages', name: 'Messages' },
                  { key: 'records', name: 'Records' },
                ]}
                height={280}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="month">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily trend</CardTitle>
              <CardDescription>{range.label}</CardDescription>
            </CardHeader>
            <CardContent>
              <TrendChart
                data={series}
                series={[
                  { key: 'messages', name: 'Messages' },
                  { key: 'important', name: 'Important' },
                  { key: 'records', name: 'Records' },
                ]}
                height={300}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Messages by category</CardTitle>
            <CardDescription>What the AI classified messages as</CardDescription>
          </CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No classified messages in this range.</p>
            ) : (
              <CategoryChart
                data={categories.slice(0, 10).map((c) => ({ label: humanize(c.category), value: c.count }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Messages by group</CardTitle>
            <CardDescription>Which groups produce the most traffic</CardDescription>
          </CardHeader>
          <CardContent>
            {groupBreakdown.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No messages in this range.</p>
            ) : (
              <CategoryChart
                data={groupBreakdown.map((g) => ({
                  label: g.groupId ? (groupName.get(g.groupId) ?? 'Unknown') : 'Direct',
                  value: g._count.groupId,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Automation output</CardTitle>
            <CardDescription>Records created and updated per automation</CardDescription>
          </CardHeader>
          <CardContent>
            {automationBreakdown.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No automation runs in this range.</p>
            ) : (
              <LinesChart
                data={automationBreakdown.map((a) => ({
                  label: a.automationId ? (automationName.get(a.automationId) ?? 'Unknown') : 'Manual',
                  created: a._sum.recordsCreated ?? 0,
                  updated: a._sum.recordsUpdated ?? 0,
                }))}
                series={[
                  { key: 'created', name: 'Created' },
                  { key: 'updated', name: 'Updated' },
                ]}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
