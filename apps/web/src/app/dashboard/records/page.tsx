import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { DEFAULT_PAGE_SIZE } from '@msgflow/config';
import { requireTenant } from '@/lib/auth';
import { PageHeader, StatTile } from '@/components/dashboard/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/dashboard/pagination';
import { RecordFilters } from './record-filters';
import { formatPercent, formatRelativeTime, renderFieldValue, truncate } from '@/lib/format';

export const metadata: Metadata = { title: 'Extracted Data' };
export const dynamic = 'force-dynamic';

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await requireTenant();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1));

  const where: Prisma.ExtractedRecordWhereInput = { tenantId: context.tenantId };
  if (params.search) where.naturalKey = { contains: params.search, mode: 'insensitive' };
  if (params.status) where.status = params.status as Prisma.ExtractedRecordWhereInput['status'];
  if (params.schemaId) where.schemaId = params.schemaId;
  if (params.automationId) where.automationId = params.automationId;

  const sort = (params.sort ?? 'updatedAt') as 'createdAt' | 'updatedAt' | 'confidence' | 'naturalKey';
  const direction = params.direction === 'asc' ? 'asc' : 'desc';

  const [records, total, schemas, automations, counts] = await Promise.all([
    prisma.extractedRecord.findMany({
      where,
      orderBy: { [sort]: direction },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
      include: {
        schema: { select: { name: true, fields: { orderBy: { order: 'asc' }, take: 5 } } },
        automation: { select: { id: true, name: true } },
        _count: { select: { sources: true, syncRecords: true } },
      },
    }),
    prisma.extractedRecord.count({ where }),
    prisma.extractionSchema.findMany({
      where: { tenantId: context.tenantId },
      select: { id: true, name: true },
    }),
    prisma.automation.findMany({
      where: { tenantId: context.tenantId, status: { not: 'ARCHIVED' } },
      select: { id: true, name: true },
    }),
    prisma.extractedRecord.groupBy({
      by: ['status'],
      where: { tenantId: context.tenantId },
      _count: { status: true },
    }),
  ]);

  const countOf = (status: string) => counts.find((c) => c.status === status)?._count.status ?? 0;
  const columns = records[0]?.schema.fields.map((f) => ({ key: f.key, label: f.label })) ?? [];

  return (
    <div>
      <PageHeader
        title="Extracted Data"
        description="The structured business records built from your messages. This is the source of truth your outputs are synchronized from."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/exports">Export</Link>
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatTile label="Total records" value={total} />
        <StatTile label="Validated" value={countOf('VALIDATED') + countOf('APPROVED')} tone="success" />
        <StatTile
          label="Needs review"
          value={countOf('NEEDS_REVIEW')}
          tone={countOf('NEEDS_REVIEW') > 0 ? 'warning' : 'default'}
        />
        <StatTile label="Rejected" value={countOf('REJECTED')} />
      </div>

      <RecordFilters schemas={schemas} automations={automations} />

      <Card className="mt-4">
        <CardContent className="p-0">
          {records.length === 0 ? (
            <EmptyState
              title="No records yet"
              description="Records appear once an automation extracts structured data from your messages. Try Demo Mode to see it work without WhatsApp."
              action={
                <Button asChild>
                  <Link href="/dashboard/demo">Try Demo Mode</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Record</TableHead>
                  {columns.slice(0, 4).map((c) => (
                    <TableHead key={c.key} className="hidden lg:table-cell">
                      {c.label}
                    </TableHead>
                  ))}
                  <TableHead className="hidden sm:table-cell">Confidence</TableHead>
                  <TableHead className="hidden md:table-cell">Synced</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => {
                  const data = (record.data ?? {}) as Record<string, unknown>;
                  return (
                    <TableRow key={record.id}>
                      <TableCell>
                        <Link href={`/dashboard/records/${record.id}`} className="font-medium hover:underline">
                          {truncate(record.naturalKey.replace(/\|/g, ' · '), 40)}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {record.schema.name}
                          {record.automation ? ` · ${record.automation.name}` : ''}
                        </div>
                      </TableCell>
                      {columns.slice(0, 4).map((c) => (
                        <TableCell key={c.key} className="hidden lg:table-cell text-sm">
                          {truncate(renderFieldValue(data[c.key]), 24)}
                        </TableCell>
                      ))}
                      <TableCell className="hidden sm:table-cell tabular text-sm">
                        {formatPercent(record.confidence)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {record._count.syncRecords > 0 ? `${record._count.syncRecords} output(s)` : '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={record.status} />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {formatRelativeTime(record.updatedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} />
    </div>
  );
}
