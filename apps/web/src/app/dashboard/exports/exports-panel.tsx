'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, FileDown } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { EmptyState } from '@/components/ui/states';
import { formatBytes, formatDateTime, formatNumber, humanize } from '@/lib/format';

interface ExportRow {
  id: string;
  entity: string;
  format: string;
  fileName: string;
  status: string;
  recordCount: number;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string | null;
}

export function ExportsPanel({ exports: rows, timezone }: { exports: ExportRow[]; timezone: string }) {
  const router = useRouter();
  const [entity, setEntity] = useState('records');
  const [format, setFormat] = useState('xlsx');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Specific-days mode: a comma-separated list of picked dates. When any are
  // picked they replace the from/to range — listing days is the more specific
  // intent, and the API applies the same precedence.
  const [dates, setDates] = useState<string[]>([]);
  const [datePick, setDatePick] = useState('');
  const [busy, setBusy] = useState(false);

  function addDate(value: string) {
    if (!value) return;
    setDates((prev) => (prev.includes(value) ? prev : [...prev, value].sort()));
    setDatePick('');
  }

  async function generate() {
    setBusy(true);
    try {
      const response = await fetch('/api/exports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entity,
          format,
          from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
          dates: dates.length > 0 ? dates : undefined,
          filters: {},
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Export failed.');

      toast.success('Export ready', {
        description: body.data.note ?? `${formatNumber(body.data.recordCount)} row(s) exported.`,
        action: {
          label: 'Download',
          onClick: () => window.open(`/api/exports/${body.data.id}`, '_blank'),
        },
      });
      router.refresh();
    } catch (err) {
      toast.error('Export failed', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New export</CardTitle>
          <CardDescription>Capped at 10,000 rows per export — narrow the dates for larger datasets.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Select value={entity} onValueChange={setEntity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="records">Extracted records</SelectItem>
                  <SelectItem value="messages">Messages</SelectItem>
                  <SelectItem value="runs">Workflow runs</SelectItem>
                  <SelectItem value="analytics">Usage &amp; analytics</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Format</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="pdf">PDF (A4)</SelectItem>
                  <SelectItem value="docx">Word (.docx, A4)</SelectItem>
                  <SelectItem value="pptx">PowerPoint</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="export-from">From</Label>
              <Input id="export-from" type="date" value={from} disabled={dates.length > 0} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="export-to">To</Label>
              <Input id="export-to" type="date" value={to} disabled={dates.length > 0} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="export-days">Specific days</Label>
              <Input
                id="export-days"
                type="date"
                value={datePick}
                onChange={(e) => addDate(e.target.value)}
              />
              {dates.length > 0 ? (
                <div className="flex flex-wrap gap-1 pt-1">
                  {dates.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-destructive/10"
                      title="Remove this day"
                      onClick={() => setDates((prev) => prev.filter((x) => x !== d))}
                    >
                      {d} ×
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Pick one or more days instead of a range.</p>
              )}
            </div>
            <div className="flex items-end">
              <Button onClick={generate} loading={busy} className="w-full">
                <FileDown className="h-4 w-4" /> Generate
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState title="No exports yet" description="Generated files appear here and stay available for 7 days." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="hidden sm:table-cell">Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.fileName}</TableCell>
                    <TableCell className="text-muted-foreground">{humanize(row.entity)}</TableCell>
                    <TableCell className="text-right tabular">{formatNumber(row.recordCount)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatBytes(row.sizeBytes)}</TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                      {formatDateTime(row.createdAt, timezone)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {row.status === 'READY' ? (
                        <Button asChild size="sm" variant="ghost">
                          <a href={`/api/exports/${row.id}`}>
                            <Download className="h-3.5 w-3.5" />
                            <span className="sr-only">Download {row.fileName}</span>
                          </a>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
