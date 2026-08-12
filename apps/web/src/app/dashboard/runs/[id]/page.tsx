import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from '@/components/icon';
import { prisma } from '@msgflow/db';
import { requireTenant } from '@/lib/auth';
import { PageHeader, StatTile } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrencyUsd, formatDateTime, formatDuration, formatNumber, humanize } from '@/lib/format';

export const metadata: Metadata = { title: 'Run' };
export const dynamic = 'force-dynamic';

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenant();
  const { id } = await params;

  const run = await prisma.workflowRun.findFirst({
    where: { id, tenantId: context.tenantId },
    include: {
      automation: { select: { id: true, name: true } },
      output: { select: { id: true, name: true } },
      steps: { orderBy: { order: 'asc' } },
    },
  });

  if (!run) notFound();

  const summary = (run.summary ?? {}) as {
    windowLabel?: string;
    outputs?: Array<{ name: string; status: string; created: number; updated: number; skipped: number; failed: number }>;
    warnings?: string[];
  };

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/dashboard/runs">
          <ArrowLeft className="h-4 w-4" /> Back to runs
        </Link>
      </Button>

      <PageHeader
        title={run.automation?.name ?? 'Workflow run'}
        description={`${humanize(run.trigger)} · ${formatDateTime(run.queuedAt, context.timezone)}${summary.windowLabel ? ` · ${summary.windowLabel}` : ''}`}
        actions={<StatusBadge status={run.status} />}
      />

      {run.errorMessage ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {run.errorMessage}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Scanned" value={formatNumber(run.messagesScanned)} />
        <StatTile label="Processed" value={formatNumber(run.messagesProcessed)} />
        <StatTile label="Created" value={formatNumber(run.recordsCreated)} tone="success" />
        <StatTile label="Updated" value={formatNumber(run.recordsUpdated)} tone="success" />
        <StatTile label="Skipped" value={formatNumber(run.recordsSkipped)} />
        <StatTile
          label="Failed"
          value={formatNumber(run.recordsFailed)}
          tone={run.recordsFailed > 0 ? 'destructive' : 'default'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Steps</CardTitle>
            <CardDescription>Each action in the workflow and how it ended</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {run.steps.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No output steps ran — this run only processed messages.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Step</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Attempt</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.steps.map((step) => (
                    <TableRow key={step.id}>
                      <TableCell>
                        <div className="font-medium">{step.name}</div>
                        {step.errorMessage ? (
                          <div className="text-xs text-destructive">{step.errorMessage}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{humanize(step.type)}</TableCell>
                      <TableCell className="text-right tabular">
                        {step.attempt}/{step.maxAttempts}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatDuration(step.durationMs)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={step.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                {[
                  ['Window start', run.windowStart ? formatDateTime(run.windowStart, context.timezone) : '—'],
                  ['Window end', run.windowEnd ? formatDateTime(run.windowEnd, context.timezone) : '—'],
                  ['Started by', run.startedBy ?? 'system'],
                  [
                    'Duration',
                    run.startedAt && run.finishedAt
                      ? formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())
                      : '—',
                  ],
                  ['Rows created', formatNumber(run.rowsCreated)],
                  ['Rows updated', formatNumber(run.rowsUpdated)],
                  ['Rows skipped', formatNumber(run.rowsSkipped)],
                  ['Rows failed', formatNumber(run.rowsFailed)],
                  ['AI cost', formatCurrencyUsd(Number(run.costUsd))],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          {summary.outputs && summary.outputs.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Outputs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary.outputs.map((output, i) => (
                  <div key={i} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{output.name}</span>
                      <StatusBadge status={output.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground tabular">
                      {output.created} created · {output.updated} updated · {output.skipped} skipped
                      {output.failed ? ` · ${output.failed} failed` : ''}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {summary.warnings && summary.warnings.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Warnings</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {summary.warnings.map((warning, i) => (
                    <li key={i}>· {warning}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
