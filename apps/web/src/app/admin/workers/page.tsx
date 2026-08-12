import type { Metadata } from 'next';
import { Server } from '@/components/icon';
import { WORKER_STALE_MS } from '@msgflow/config';
import { prisma } from '@msgflow/db';
import { requireSuperAdmin } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { EmptyState } from '@/components/ui/states';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatDuration, formatNumber, formatRelativeTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Workers' };
export const dynamic = 'force-dynamic';

export default async function AdminWorkersPage() {
  await requireSuperAdmin();

  const workers = await prisma.worker.findMany({
    orderBy: { lastHeartbeatAt: 'desc' },
    include: {
      heartbeats: { orderBy: { createdAt: 'desc' }, take: 12 },
      connections: { include: { tenant: { select: { name: true } } } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Workers"
        description="Persistent Node services running WhatsApp Web. A worker without a recent heartbeat is treated as offline regardless of its last reported status."
      />

      {workers.length === 0 ? (
        <Card>
          <EmptyState
            icon={Server}
            title="No worker has registered"
            description="Start one with `pnpm worker:dev`, or deploy it to Railway, Render, Fly.io or a Docker host. Workers register themselves on their first heartbeat."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {workers.map((worker) => {
            const latest = worker.heartbeats[0];
            const alive =
              worker.lastHeartbeatAt && Date.now() - worker.lastHeartbeatAt.getTime() < WORKER_STALE_MS;

            return (
              <Card key={worker.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {worker.name}
                      <StatusBadge status={alive ? worker.status : 'OFFLINE'} />
                      {!alive && worker.lastHeartbeatAt ? (
                        <Badge variant="destructive">No heartbeat</Badge>
                      ) : null}
                    </CardTitle>
                    <CardDescription>
                      {worker.hostname}
                      {worker.pid ? ` · pid ${worker.pid}` : ''}
                      {worker.version ? ` · v${worker.version}` : ''}
                      {worker.capabilities.length > 0 ? ` · ${worker.capabilities.join(', ')}` : ''}
                    </CardDescription>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>Last heartbeat {formatRelativeTime(worker.lastHeartbeatAt)}</div>
                    <div>Started {formatDateTime(worker.startedAt)}</div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    {[
                      ['CPU', latest?.cpuPercent != null ? `${latest.cpuPercent.toFixed(1)}%` : '—'],
                      ['Memory', latest?.memoryMb != null ? `${Math.round(latest.memoryMb)} MB` : '—'],
                      ['Uptime', latest?.uptimeSec ? formatDuration(latest.uptimeSec * 1000) : '—'],
                      ['Connections', formatNumber(latest?.connections ?? worker.connections.length)],
                      ['Messages seen', formatNumber(latest?.messagesSeen ?? 0)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                        <dd className="mt-0.5 text-sm font-medium tabular">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  {worker.connections.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tenant</TableHead>
                          <TableHead>Connection</TableHead>
                          <TableHead>Last message</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {worker.connections.map((connection) => (
                          <TableRow key={connection.id}>
                            <TableCell className="font-medium">{connection.tenant.name}</TableCell>
                            <TableCell>{connection.name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatRelativeTime(connection.lastMessageAt)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={connection.status} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This worker owns no WhatsApp connections right now.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
