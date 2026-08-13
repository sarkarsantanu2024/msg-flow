import type { Metadata } from 'next';
import { prisma } from '@msgflow/db';
import { getProviderStatus } from '@msgflow/ai';
import { requireTenant } from '@/lib/auth';
import { resolvePreset } from '@/lib/queries';
import { PageHeader, StatTile } from '@/components/dashboard/page-header';
import { DateFilter } from '@/components/dashboard/date-filter';
import { parseDateParams } from '@/lib/date-params';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarsChart } from '@/components/charts';
import { EmptyState } from '@/components/ui/states';
import { formatCurrencyUsd, formatDate, formatNumber, humanize } from '@/lib/format';

export const metadata: Metadata = { title: 'Usage' };
export const dynamic = 'force-dynamic';

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const context = await requireTenant();
  const params = await searchParams;
  const { preset, from, to } = parseDateParams(params);
  const range = resolvePreset(preset === 'last7' ? 'last30' : preset, context.timezone, new Date(), { from, to });

  const [usage, aiByProvider, totals] = await Promise.all([
    prisma.usage.findMany({
      where: { tenantId: context.tenantId, periodStart: { gte: range.start, lt: range.end } },
      orderBy: { periodStart: 'desc' },
    }),
    prisma.aIUsage.groupBy({
      by: ['provider', 'model', 'operation'],
      where: { tenantId: context.tenantId, createdAt: { gte: range.start, lt: range.end } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
    prisma.usage.aggregate({
      where: { tenantId: context.tenantId, periodStart: { gte: range.start, lt: range.end } },
      _sum: {
        messages: true,
        aiCalls: true,
        inputTokens: true,
        outputTokens: true,
        costUsd: true,
        workflowRuns: true,
        recordsCreated: true,
        recordsUpdated: true,
        exports: true,
        apiCalls: true,
      },
    }),
  ]);

  const provider = getProviderStatus();
  const sum = totals._sum;

  const chartData = [...usage]
    .reverse()
    .map((u) => ({
      label: formatDate(u.periodStart, context.timezone).slice(0, 6),
      messages: u.messages,
      aiCalls: u.aiCalls,
      records: u.recordsCreated + u.recordsUpdated,
    }));

  return (
    <div>
      <PageHeader
        title="Usage"
        description={`${range.label} · costs are estimates for internal tracking, not an invoice`}
        actions={<DateFilter compact />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Messages" value={formatNumber(sum.messages ?? 0)} />
        <StatTile label="AI calls" value={formatNumber(sum.aiCalls ?? 0)} />
        <StatTile label="Input tokens" value={formatNumber(sum.inputTokens ?? 0)} />
        <StatTile label="Output tokens" value={formatNumber(sum.outputTokens ?? 0)} />
        <StatTile label="Estimated AI cost" value={formatCurrencyUsd(Number(sum.costUsd ?? 0))} />
        <StatTile label="Workflow runs" value={formatNumber(sum.workflowRuns ?? 0)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Daily usage</CardTitle>
            <CardDescription>Messages captured, AI calls made and records written</CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No usage recorded in this range.</p>
            ) : (
              <BarsChart
                data={chartData}
                series={[
                  { key: 'messages', name: 'Messages' },
                  { key: 'aiCalls', name: 'AI calls' },
                  { key: 'records', name: 'Records' },
                ]}
                height={280}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI provider</CardTitle>
            <CardDescription>
              {provider.usingFallback
                ? 'No API key configured — the rule-based provider is being used, at zero cost.'
                : `Active: ${provider.active} · ${provider.model}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {provider.available.map((p) => (
                <li key={p.name} className="flex items-center justify-between">
                  <span>{humanize(p.name)}</span>
                  <span className={p.configured ? 'text-success' : 'text-muted-foreground'}>
                    {p.configured ? 'Configured' : 'No key'}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI calls by operation</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {aiByProvider.length === 0 ? (
              <EmptyState title="No AI calls yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operation</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aiByProvider.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{humanize(row.operation)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.model}</TableCell>
                      <TableCell className="text-right tabular">{formatNumber(row._count._all)}</TableCell>
                      <TableCell className="text-right tabular">
                        {formatNumber((row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0))}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {formatCurrencyUsd(Number(row._sum.costUsd ?? 0))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {usage.length === 0 ? (
              <EmptyState title="No usage recorded" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Messages</TableHead>
                    <TableHead className="text-right">AI calls</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{formatDate(row.periodStart, context.timezone)}</TableCell>
                      <TableCell className="text-right tabular">{formatNumber(row.messages)}</TableCell>
                      <TableCell className="text-right tabular">{formatNumber(row.aiCalls)}</TableCell>
                      <TableCell className="text-right tabular">{formatNumber(row.recordsCreated)}</TableCell>
                      <TableCell className="text-right tabular">{formatNumber(row.recordsUpdated)}</TableCell>
                      <TableCell className="text-right tabular">
                        {formatCurrencyUsd(Number(row.costUsd))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
