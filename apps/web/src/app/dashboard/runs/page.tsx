import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@msgflow/db';
import { DEFAULT_PAGE_SIZE } from '@msgflow/config';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/dashboard/pagination';
import { formatDateTime, formatDuration, humanize } from '@/lib/format';

export const metadata: Metadata = { title: 'Workflow Runs' };
export const dynamic = 'force-dynamic';

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const context = await requireTenant();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1));

  const [runs, total] = await Promise.all([
    prisma.workflowRun.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { queuedAt: 'desc' },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
      include: { automation: { select: { id: true, name: true } }, _count: { select: { steps: true } } },
    }),
    prisma.workflowRun.count({ where: { tenantId: context.tenantId } }),
  ]);

  return (
    <div>
      <PageHeader
        title="Workflow Runs"
        description="Every execution, what it processed, and what it wrote."
      />

      <Card>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <EmptyState
              title="Nothing has run yet"
              description="Runs appear when an automation processes messages — on a schedule, in real time, or when you press Run now."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Automation</TableHead>
                  <TableHead className="hidden sm:table-cell">Trigger</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="hidden md:table-cell">Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Link href={`/dashboard/runs/${run.id}`} className="font-medium hover:underline">
                        {formatDateTime(run.queuedAt, context.timezone)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {run.automation ? (
                        <Link href={`/dashboard/automations/${run.automation.id}`} className="hover:underline">
                          {run.automation.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {humanize(run.trigger)}
                    </TableCell>
                    <TableCell className="text-right tabular">{run.messagesProcessed}</TableCell>
                    <TableCell className="text-right tabular">{run.recordsCreated}</TableCell>
                    <TableCell className="text-right tabular">{run.recordsUpdated}</TableCell>
                    <TableCell className="text-right tabular">{run.recordsFailed}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {run.startedAt && run.finishedAt
                        ? formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())
                        : '—'}
                    </TableCell>
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

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} />
    </div>
  );
}
