import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MessageSquare } from '@/components/icon';
import { getRecordLineage } from '@msgflow/workflow';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatPercent, humanize, renderFieldValue } from '@/lib/format';
import { RecordEditor } from './record-editor';

export const metadata: Metadata = { title: 'Record' };
export const dynamic = 'force-dynamic';

export default async function RecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenant();
  const { id } = await params;

  const record = await getRecordLineage(context.tenantId, id);
  if (!record) notFound();

  const data = (record.data ?? {}) as Record<string, unknown>;
  const origin = record.originMessage ?? record.sources[0]?.message ?? null;

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/dashboard/records">
          <ArrowLeft className="h-4 w-4" /> Back to records
        </Link>
      </Button>

      <PageHeader
        title={record.naturalKey.replace(/\|/g, ' · ')}
        description={`${record.schema.name} · version ${record.version}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={record.status} />
            <Badge variant="muted">Confidence {formatPercent(record.confidence)}</Badge>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <RecordEditor
            recordId={record.id}
            status={record.status}
            data={data}
            canEdit={['OWNER', 'ADMIN', 'OPERATOR'].includes(context.role)}
            fields={record.schema.fields.map((f) => ({
              key: f.key,
              label: f.label,
              type: f.type,
              required: f.required,
              enumValues: f.enumValues,
            }))}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Field history</CardTitle>
              <CardDescription>
                Every change, ordered by when the message was sent. Superseded values are kept, never deleted.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {record.fieldEvents.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">No field events recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Previous</TableHead>
                      <TableHead>New</TableHead>
                      <TableHead>Message sent</TableHead>
                      <TableHead>Applied</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {record.fieldEvents.map((event) => (
                      <TableRow key={event.id} className={event.applied ? undefined : 'opacity-60'}>
                        <TableCell className="font-medium">{event.fieldKey}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {renderFieldValue(event.previousValue)}
                        </TableCell>
                        <TableCell>{renderFieldValue(event.newValue)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(event.eventAt, context.timezone)}
                        </TableCell>
                        <TableCell>
                          {event.applied ? (
                            <Badge variant="success">Applied</Badge>
                          ) : (
                            <Badge variant="muted" title={event.skipReason ?? undefined}>
                              {event.skipReason ?? 'Skipped'}
                            </Badge>
                          )}
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
          {/* Data lineage — "Where did this data come from?" */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Where did this come from?</CardTitle>
              <CardDescription>The original message that produced this record</CardDescription>
            </CardHeader>
            <CardContent>
              {origin ? (
                <div className="space-y-3">
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground">{origin.senderName ?? 'Unknown sender'}</span>
                      {origin.group ? <Badge variant="secondary">{origin.group.name}</Badge> : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{origin.text}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatDateTime(origin.timestamp, context.timezone)}
                    </p>
                  </div>

                  {origin.classification ? (
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Category</dt>
                        <dd>{humanize(origin.classification.category)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">AI confidence</dt>
                        <dd>{formatPercent(origin.classification.confidence)}</dd>
                      </div>
                    </dl>
                  ) : null}

                  <Button asChild variant="outline" size="sm" className="w-full">
                    <Link href={`/dashboard/messages?search=${encodeURIComponent(origin.text?.slice(0, 30) ?? '')}`}>
                      View source message
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The source message is no longer available.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Output rows</CardTitle>
              <CardDescription>Where this record has been written</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {record.syncRecords.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  Not synchronized to any output yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {record.syncRecords.map((sync) => (
                    <li key={sync.id} className="flex items-center justify-between gap-2 px-5 py-3">
                      <div className="min-w-0">
                        <Link
                          href={`/dashboard/outputs/${sync.outputId}`}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {sync.output.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {humanize(sync.output.type)}
                          {sync.externalRowId ? ` · row ${sync.externalRowId}` : ''}
                        </p>
                      </div>
                      <StatusBadge status={sync.syncStatus} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contributing messages</CardTitle>
              <CardDescription>{record.sources.length} message(s) built this record</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="max-h-72 divide-y overflow-y-auto scrollbar-thin">
                {record.sources.map((source) => (
                  <li key={source.id} className="px-5 py-2.5">
                    <p className="line-clamp-2 text-sm">{source.message.text}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {source.message.senderName} · {formatDateTime(source.message.timestamp, context.timezone)}
                      {source.isOrigin ? ' · origin' : ''}
                    </p>
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
