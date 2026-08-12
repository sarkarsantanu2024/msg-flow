import type { Metadata } from 'next';
import Link from 'next/link';
import { FileOutput, Plus } from '@/components/icon';
import { prisma } from '@msgflow/db';
import { requireTenant } from '@/lib/auth';
import { PageHeader, StatTile } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/states';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber, formatRelativeTime, humanize } from '@/lib/format';
import { SyncNowButton } from './sync-now-button';

export const metadata: Metadata = { title: 'Outputs' };
export const dynamic = 'force-dynamic';

export default async function OutputsPage() {
  const context = await requireTenant();

  const outputs = await prisma.output.findMany({
    where: { tenantId: context.tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      targets: { include: { automation: { select: { id: true, name: true } } } },
      _count: { select: { versions: true, syncRecords: true } },
    },
  });

  const conflicts = outputs.filter((o) => o.status === 'CONFLICT').length;
  const failing = outputs.filter((o) => o.status === 'FAILED').length;
  const canManage = ['OWNER', 'ADMIN', 'OPERATOR'].includes(context.role);

  return (
    <div>
      <PageHeader
        title="Outputs"
        description="The files and systems MsgFlow keeps up to date. Create a new one, or connect a file you already use."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/dashboard/outputs/new">
                <Plus className="h-4 w-4" /> New output
              </Link>
            </Button>
          ) : null
        }
      />

      {outputs.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileOutput}
            title="No outputs yet"
            description="Create a new Excel file, or upload the workbook you already maintain and MsgFlow will keep updating it in place — formulas and formatting intact."
            action={
              canManage ? (
                <Button asChild>
                  <Link href="/dashboard/outputs/new">Create your first output</Link>
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile label="Outputs" value={outputs.length} />
            <StatTile
              label="Records synchronized"
              value={formatNumber(outputs.reduce((s, o) => s + o._count.syncRecords, 0))}
            />
            <StatTile label="Conflicts" value={conflicts} tone={conflicts > 0 ? 'destructive' : 'default'} />
            <StatTile label="Failing" value={failing} tone={failing > 0 ? 'destructive' : 'default'} />
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Output</TableHead>
                    <TableHead className="hidden lg:table-cell">Automation</TableHead>
                    <TableHead className="hidden sm:table-cell">Operation</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    <TableHead className="hidden md:table-cell">Last sync</TableHead>
                    <TableHead className="hidden md:table-cell">Next sync</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outputs.map((output) => (
                    <TableRow key={output.id}>
                      <TableCell>
                        <Link href={`/dashboard/outputs/${output.id}`} className="font-medium hover:underline">
                          {output.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {humanize(output.type)}
                          {output.currentVersion > 0 ? ` · v${output.currentVersion}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {output.targets.length === 0 ? (
                          <span className="text-xs text-warning">Not connected</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {output.targets.slice(0, 2).map((t) => (
                              <Link key={t.id} href={`/dashboard/automations/${t.automationId}`}>
                                <Badge variant="secondary">{t.automation.name}</Badge>
                              </Link>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {output.targets[0] ? (
                          <Badge variant="default">{humanize(output.targets[0].operation)}</Badge>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular">{formatNumber(output.recordCount)}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {formatRelativeTime(output.lastSyncAt)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {output.nextSyncAt ? formatRelativeTime(output.nextSyncAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={output.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage ? <SyncNowButton outputId={output.id} compact /> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
