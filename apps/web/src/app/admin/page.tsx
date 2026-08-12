import type { Metadata } from 'next';
import Link from 'next/link';
import { WORKER_STALE_MS } from '@msgflow/config';
import { prisma } from '@msgflow/db';
import { requireSuperAdmin } from '@/lib/auth';
import { PageHeader, StatTile } from '@/components/dashboard/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrencyUsd, formatNumber, formatRelativeTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Platform admin' };
export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  await requireSuperAdmin();

  const dayAgo = new Date(Date.now() - 86_400_000);
  const monthStart = new Date(Date.now() - 30 * 86_400_000);

  const [
    tenantCount,
    activeTenants,
    paidTenants,
    messageCount,
    messagesToday,
    automationCount,
    connections,
    workers,
    failures,
    aiTotals,
    topTenants,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { status: 'ACTIVE' } }),
    prisma.subscription.count({ where: { status: 'ACTIVE' } }),
    prisma.message.count(),
    prisma.message.count({ where: { receivedAt: { gte: dayAgo } } }),
    prisma.automation.count({ where: { status: 'ACTIVE' } }),
    prisma.whatsAppConnection.findMany({
      include: { tenant: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    prisma.worker.findMany({ orderBy: { lastHeartbeatAt: 'desc' } }),
    prisma.workflowRun.count({ where: { status: 'FAILED', queuedAt: { gte: dayAgo } } }),
    prisma.aIUsage.aggregate({
      where: { createdAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
    prisma.usage.groupBy({
      by: ['tenantId'],
      where: { periodStart: { gte: monthStart } },
      _sum: { messages: true, aiCalls: true, costUsd: true },
      orderBy: { _sum: { messages: 'desc' } },
      take: 10,
    }),
  ]);

  const tenantNames = new Map(
    (
      await prisma.tenant.findMany({
        where: { id: { in: topTenants.map((t) => t.tenantId) } },
        select: { id: true, name: true },
      })
    ).map((t) => [t.id, t.name]),
  );

  const liveWorkers = workers.filter(
    (w) => w.lastHeartbeatAt && Date.now() - w.lastHeartbeatAt.getTime() < WORKER_STALE_MS,
  );
  const readyConnections = connections.filter((c) => c.status === 'READY').length;

  return (
    <div>
      <PageHeader title="Platform overview" description="Every tenant, worker and connection on this deployment." />

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Tenants" value={formatNumber(tenantCount)} />
        <StatTile label="Active" value={formatNumber(activeTenants)} tone="success" />
        <StatTile label="Paid" value={formatNumber(paidTenants)} />
        <StatTile label="Messages (total)" value={formatNumber(messageCount)} />
        <StatTile label="Messages (24h)" value={formatNumber(messagesToday)} />
        <StatTile
          label="Failed runs (24h)"
          value={formatNumber(failures)}
          tone={failures > 0 ? 'destructive' : 'default'}
        />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatTile label="Active automations" value={formatNumber(automationCount)} />
        <StatTile
          label="Workers online"
          value={`${liveWorkers.length} / ${workers.length}`}
          tone={liveWorkers.length === 0 && workers.length > 0 ? 'destructive' : 'default'}
        />
        <StatTile
          label="WhatsApp ready"
          value={`${readyConnections} / ${connections.length}`}
          tone={readyConnections === 0 && connections.length > 0 ? 'warning' : 'default'}
        />
        <StatTile
          label="AI spend (30d, est.)"
          value={formatCurrencyUsd(Number(aiTotals._sum.costUsd ?? 0))}
          hint={`${formatNumber(aiTotals._count._all)} calls`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">WhatsApp connections</CardTitle>
            <CardDescription>Across all tenants</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>Last heartbeat</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      No connections yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  connections.map((connection) => (
                    <TableRow key={connection.id}>
                      <TableCell className="font-medium">{connection.tenant.name}</TableCell>
                      <TableCell>{connection.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatRelativeTime(connection.lastHeartbeatAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={connection.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Busiest tenants (30 days)</CardTitle>
            <CardDescription>By message volume</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">AI calls</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topTenants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      No usage recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  topTenants.map((row) => (
                    <TableRow key={row.tenantId}>
                      <TableCell>
                        <Link href={`/admin/tenants`} className="font-medium hover:underline">
                          {tenantNames.get(row.tenantId) ?? row.tenantId}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular">{formatNumber(row._sum.messages ?? 0)}</TableCell>
                      <TableCell className="text-right tabular">{formatNumber(row._sum.aiCalls ?? 0)}</TableCell>
                      <TableCell className="text-right tabular">
                        {formatCurrencyUsd(Number(row._sum.costUsd ?? 0))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
