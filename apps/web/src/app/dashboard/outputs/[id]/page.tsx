import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download } from '@/components/icon';
import { prisma } from '@msgflow/db';
import { requireTenant } from '@/lib/auth';
import { PageHeader, StatTile } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { formatBytes, formatDateTime, formatNumber, formatRelativeTime, humanize, renderFieldValue } from '@/lib/format';
import { SyncNowButton } from '../sync-now-button';
import { OutputActions } from './output-actions';
import { ConflictBanner } from './conflict-banner';

export const metadata: Metadata = { title: 'Output' };
export const dynamic = 'force-dynamic';

export default async function OutputDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenant();
  const { id } = await params;

  const output = await prisma.output.findFirst({
    where: { id, tenantId: context.tenantId },
    include: {
      targets: {
        include: { automation: { select: { id: true, name: true, status: true } }, mappings: { orderBy: { order: 'asc' } } },
      },
      versions: { orderBy: { version: 'desc' }, take: 25 },
      conflicts: { where: { resolution: 'PENDING' }, orderBy: { detectedAt: 'desc' }, take: 1 },
      integration: { select: { name: true, status: true } },
    },
  });

  if (!output) notFound();

  const [syncRecords, failedRecords, runs] = await Promise.all([
    prisma.outputSyncRecord.findMany({
      where: { outputId: output.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { record: { select: { id: true, naturalKey: true, data: true, status: true } } },
    }),
    prisma.outputSyncRecord.findMany({
      where: { outputId: output.id, syncStatus: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { record: { select: { id: true, naturalKey: true } } },
    }),
    prisma.workflowRun.findMany({
      where: { tenantId: context.tenantId, automationId: { in: output.targets.map((t) => t.automationId) } },
      orderBy: { queuedAt: 'desc' },
      take: 20,
      include: { automation: { select: { name: true } } },
    }),
  ]);

  const canManage = ['OWNER', 'ADMIN', 'OPERATOR'].includes(context.role);
  const primaryTarget = output.targets[0];
  const keyFields = primaryTarget?.mappings
    .filter((m) => m.isKeyPart)
    .sort((a, b) => (a.keyOrder ?? 0) - (b.keyOrder ?? 0))
    .map((m) => m.targetField) ?? [];
  const hasFile = Boolean(((output.config ?? {}) as { storageRef?: string }).storageRef);

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/dashboard/outputs">
          <ArrowLeft className="h-4 w-4" /> Back to outputs
        </Link>
      </Button>

      <PageHeader
        title={output.name}
        description={`${humanize(output.type)}${primaryTarget ? ` · ${humanize(primaryTarget.operation)}` : ''}${keyFields.length ? ` · key: ${keyFields.join(' + ')}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={output.status} />
            {hasFile ? (
              <Button asChild variant="outline">
                <a href={`/api/outputs/${output.id}/download`}>
                  <Download className="h-4 w-4" /> Download
                </a>
              </Button>
            ) : null}
            {canManage ? (
              <>
                <SyncNowButton outputId={output.id} />
                <OutputActions outputId={output.id} status={output.status} name={output.name} />
              </>
            ) : null}
          </div>
        }
      />

      {output.conflicts[0] ? (
        <ConflictBanner
          outputId={output.id}
          detectedAt={output.conflicts[0].detectedAt.toISOString()}
          canResolve={canManage}
        />
      ) : null}

      {output.lastError && output.status !== 'CONFLICT' ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <strong>Last sync failed:</strong> {output.lastError}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatTile label="Records synchronized" value={formatNumber(output.recordCount)} />
        <StatTile label="Version" value={output.currentVersion > 0 ? `v${output.currentVersion}` : '—'} />
        <StatTile label="Last sync" value={formatRelativeTime(output.lastSyncAt)} />
        <StatTile
          label="Failed rows"
          value={failedRecords.length}
          tone={failedRecords.length > 0 ? 'destructive' : 'default'}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="mapping">Mapping</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-sm">
                  {[
                    ['Type', humanize(output.type)],
                    ['Operation', primaryTarget ? humanize(primaryTarget.operation) : 'Not connected'],
                    ['Unique key', keyFields.length > 0 ? keyFields.join(' + ') : 'None'],
                    ['Last sync', output.lastSyncAt ? formatDateTime(output.lastSyncAt, context.timezone) : 'Never'],
                    ['Next sync', output.nextSyncAt ? formatDateTime(output.nextSyncAt, context.timezone) : 'On automation schedule'],
                    ['Integration', output.integration ? `${output.integration.name} (${humanize(output.integration.status)})` : 'None'],
                    ['Deletes allowed', output.allowDelete ? 'Yes' : 'No'],
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
                <CardTitle className="text-base">Connected automations</CardTitle>
                <CardDescription>What feeds this output</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {output.targets.length === 0 ? (
                  <EmptyState
                    title="Not connected yet"
                    description="Connect this output to an automation from the automation's page."
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link href="/dashboard/automations">Go to automations</Link>
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-y">
                    {output.targets.map((target) => (
                      <li key={target.id} className="flex items-center justify-between gap-2 px-5 py-3">
                        <div className="min-w-0">
                          <Link
                            href={`/dashboard/automations/${target.automationId}`}
                            className="truncate font-medium hover:underline"
                          >
                            {target.automation.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {target.mappings.length} field(s) mapped
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="default">{humanize(target.operation)}</Badge>
                          <StatusBadge status={target.automation.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="records">
          <Card>
            <CardContent className="p-0">
              {syncRecords.length === 0 ? (
                <EmptyState title="Nothing synchronized yet" description="Run a sync to populate this output." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Record</TableHead>
                      <TableHead>External row</TableHead>
                      <TableHead>Sync status</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Last synced</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {syncRecords.map((sync) => (
                      <TableRow key={sync.id}>
                        <TableCell>
                          <Link href={`/dashboard/records/${sync.recordId}`} className="font-medium hover:underline">
                            {sync.record.naturalKey.replace(/\|/g, ' · ')}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {sync.externalRowId ?? sync.externalRecordId ?? '—'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={sync.syncStatus} />
                        </TableCell>
                        <TableCell className="tabular">{sync.syncVersion}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatRelativeTime(sync.lastSyncedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mapping">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Field mapping</CardTitle>
              <CardDescription>
                {keyFields.length > 0
                  ? `Existing rows are found by matching ${keyFields.join(' + ')}.`
                  : 'No unique key configured — rows are always appended.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!primaryTarget ? (
                <EmptyState title="No mapping yet" description="Connect this output to an automation first." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Extracted field</TableHead>
                      <TableHead>Destination column</TableHead>
                      <TableHead>Update strategy</TableHead>
                      <TableHead>Unique key</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {primaryTarget.mappings.map((mapping) => (
                      <TableRow key={mapping.id}>
                        <TableCell className="font-medium">{mapping.sourceField}</TableCell>
                        <TableCell>{mapping.targetField}</TableCell>
                        <TableCell>
                          <Badge variant={mapping.updateStrategy === 'NEVER_UPDATE' ? 'muted' : 'secondary'}>
                            {humanize(mapping.updateStrategy)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {mapping.isKeyPart ? <Badge variant="default">Key {(mapping.keyOrder ?? 0) + 1}</Badge> : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Version history</CardTitle>
              <CardDescription>Every write is snapshotted, so any sync can be rolled back.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {output.versions.length === 0 ? (
                <EmptyState title="No versions yet" description="Versions are created when a file output is written." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Operation</TableHead>
                      <TableHead className="text-right">Records</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {output.versions.map((version) => (
                      <TableRow key={version.id}>
                        <TableCell className="font-medium">
                          v{version.version}
                          {version.version === output.currentVersion ? (
                            <Badge variant="success" className="ml-2">
                              Current
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(version.createdAt, context.timezone)}
                        </TableCell>
                        <TableCell>{version.note ?? humanize(version.operation ?? '')}</TableCell>
                        <TableCell className="text-right tabular">{formatNumber(version.recordCount)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {formatBytes(version.sizeBytes)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button asChild size="sm" variant="ghost">
                              <a href={`/api/outputs/${output.id}/download?version=${version.version}`}>
                                <Download className="h-3.5 w-3.5" />
                                <span className="sr-only">Download v{version.version}</span>
                              </a>
                            </Button>
                            {canManage && version.version !== output.currentVersion ? (
                              <OutputActions
                                outputId={output.id}
                                status={output.status}
                                name={output.name}
                                restoreVersion={version.version}
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs">
          <Card>
            <CardContent className="p-0">
              {runs.length === 0 ? (
                <EmptyState title="No runs yet" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Automation</TableHead>
                      <TableHead className="text-right">Rows created</TableHead>
                      <TableHead className="text-right">Rows updated</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>
                          <Link href={`/dashboard/runs/${run.id}`} className="hover:underline">
                            {formatDateTime(run.queuedAt, context.timezone)}
                          </Link>
                        </TableCell>
                        <TableCell>{run.automation?.name ?? '—'}</TableCell>
                        <TableCell className="text-right tabular">{run.rowsCreated}</TableCell>
                        <TableCell className="text-right tabular">{run.rowsUpdated}</TableCell>
                        <TableCell className="text-right tabular">{run.rowsFailed}</TableCell>
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
        </TabsContent>

        <TabsContent value="errors">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Failed rows</CardTitle>
                <CardDescription>Rows that could not be written, and why</CardDescription>
              </div>
              {canManage && failedRecords.length > 0 ? (
                <OutputActions outputId={output.id} status={output.status} name={output.name} retryOnly />
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {failedRecords.length === 0 ? (
                <EmptyState title="No failed rows" description="Everything written so far succeeded." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Record</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead className="text-right">Attempts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {failedRecords.map((sync) => (
                      <TableRow key={sync.id}>
                        <TableCell>
                          <Link href={`/dashboard/records/${sync.recordId}`} className="font-medium hover:underline">
                            {sync.record.naturalKey.replace(/\|/g, ' · ')}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-destructive">{sync.errorMessage ?? 'Unknown error'}</TableCell>
                        <TableCell className="text-right tabular">{sync.attempts}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Target configuration</CardTitle>
              <CardDescription>The raw settings this connector uses</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {Object.entries((output.config ?? {}) as Record<string, unknown>)
                  .filter(([key]) => key !== 'columns')
                  .map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3 border-b pb-2 last:border-0">
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="max-w-[60%] truncate text-right font-mono text-xs">
                        {renderFieldValue(value)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
