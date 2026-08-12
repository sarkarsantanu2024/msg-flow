'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Globe,
  Presentation,
  Table2,
  Upload,
  Webhook,
} from '@/components/icon';
import { EXCEL_AT_RISK_FEATURES, EXCEL_PRESERVED_FEATURES } from '@msgflow/config';
import type { WorkbookPreview } from '@msgflow/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatBytes, formatNumber } from '@/lib/format';

const OUTPUT_TYPES = [
  { value: 'EXCEL', label: 'Excel workbook', icon: FileSpreadsheet, hint: 'Create new, or update a file you already use' },
  { value: 'CSV', label: 'CSV file', icon: Table2, hint: 'Plain delimited data' },
  { value: 'GOOGLE_SHEETS', label: 'Google Sheets', icon: Table2, hint: 'Keep a live spreadsheet in step' },
  { value: 'REST_API', label: 'REST API', icon: Globe, hint: "Push records into your own system" },
  { value: 'CLIENT_WEBSITE', label: 'Client website', icon: Globe, hint: 'Update an existing site or admin panel' },
  { value: 'WEBHOOK', label: 'Webhook', icon: Webhook, hint: 'Notify an endpoint on every batch' },
  { value: 'PDF', label: 'PDF report', icon: FileText, hint: 'Rendered report, regenerated each run' },
  { value: 'POWERPOINT', label: 'PowerPoint deck', icon: Presentation, hint: 'Slide report, regenerated each run' },
];

export function OutputWizard({ googleConfigured }: { googleConfigured: boolean }) {
  const router = useRouter();
  const [type, setType] = useState('EXCEL');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<(WorkbookPreview & { storageRef: string }) | null>(null);
  const [worksheet, setWorksheet] = useState('');

  // Type-specific configuration
  const [fileName, setFileName] = useState('output.xlsx');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [worksheetTitle, setWorksheetTitle] = useState('Sheet1');
  const [baseUrl, setBaseUrl] = useState('');
  const [createPath, setCreatePath] = useState('/');
  const [updatePath, setUpdatePath] = useState('/{id}');
  const [webhookUrl, setWebhookUrl] = useState('');

  async function upload(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/outputs/preview', { method: 'POST', body: formData });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not read that file.');

      const data = body.data as WorkbookPreview & { storageRef: string };
      setPreview(data);
      setWorksheet(data.worksheets[0]?.name ?? '');
      setFileName(data.fileName);
      if (!name) setName(data.fileName.replace(/\.(xlsx|csv)$/i, ''));

      toast.success('File read successfully', {
        description: `${data.worksheets.length} worksheet(s) found. Choose which one to maintain.`,
      });
    } catch (err) {
      toast.error('Could not read that file', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      toast.error('Give the output a name');
      return;
    }

    const sheet = preview?.worksheets.find((w) => w.name === worksheet);
    let config: Record<string, unknown> = {};

    if (type === 'EXCEL' || type === 'CSV') {
      config = {
        fileName: fileName || (type === 'EXCEL' ? 'output.xlsx' : 'output.csv'),
        worksheet: worksheet || 'Sheet1',
        headerRow: 1,
        storageRef: preview?.storageRef,
        columns: sheet?.columns.map((c) => c.header) ?? [],
      };
    } else if (type === 'GOOGLE_SHEETS') {
      if (!spreadsheetId.trim()) {
        toast.error('Enter the Google spreadsheet ID');
        return;
      }
      config = { spreadsheetId: spreadsheetId.trim(), worksheetTitle, headerRow: 1, columns: [] };
    } else if (type === 'REST_API' || type === 'CLIENT_WEBSITE' || type === 'CLIENT_ADMIN') {
      if (!baseUrl.trim()) {
        toast.error('Enter the API base URL');
        return;
      }
      config = {
        baseUrl: baseUrl.trim(),
        createPath,
        updatePath,
        createMethod: 'POST',
        updateMethod: 'PUT',
        headers: {},
        idPath: 'id',
        columns: [],
      };
    } else if (type === 'WEBHOOK') {
      if (!webhookUrl.trim()) {
        toast.error('Enter the webhook URL');
        return;
      }
      config = { url: webhookUrl.trim(), method: 'POST', batch: true, signPayload: true, columns: [] };
    } else {
      config = { fileName: name.replace(/\W+/g, '-').toLowerCase(), title: name, columns: [] };
    }

    setSaving(true);
    try {
      const response = await fetch('/api/outputs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, type, config, allowDelete: false }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not create the output.');

      toast.success('Output created', {
        description: 'Now connect it to an automation and map your fields.',
      });
      router.push(`/dashboard/outputs/${body.data.id}`);
    } catch (err) {
      toast.error('Could not create output', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  }

  const selectedSheet = preview?.worksheets.find((w) => w.name === worksheet);
  const isFileType = type === 'EXCEL' || type === 'CSV';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What kind of output?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {OUTPUT_TYPES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(option.value)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                  type === option.value && 'border-primary bg-primary/5 ring-1 ring-primary',
                )}
              >
                <option.icon className="h-5 w-5 text-primary" />
                <p className="mt-2 text-sm font-medium">{option.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{option.hint}</p>
                {option.value === 'GOOGLE_SHEETS' && !googleConfigured ? (
                  <Badge variant="warning" className="mt-2">
                    Credentials required
                  </Badge>
                ) : null}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
          <CardDescription>Give it a name and tell MsgFlow where it lives</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="output-name">Output name</Label>
            <Input
              id="output-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Master Sales"
            />
          </div>

          {isFileType ? (
            <>
              <div className="rounded-lg border border-dashed p-5 text-center">
                <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">Have a file already? Upload it.</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  MsgFlow reads its real columns and updates rows in place, rather than replacing your work.
                </p>
                <input
                  id="file-upload"
                  type="file"
                  accept={type === 'EXCEL' ? '.xlsx' : '.csv'}
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload(file);
                  }}
                />
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={uploading}
                >
                  <label htmlFor="file-upload" className="cursor-pointer">
                    {uploading ? 'Reading file…' : `Choose ${type === 'EXCEL' ? '.xlsx' : '.csv'} file`}
                  </label>
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Or skip this to create a brand new file.
                </p>
              </div>

              {!preview ? (
                <div className="space-y-1.5">
                  <Label htmlFor="file-name">New file name</Label>
                  <Input
                    id="file-name"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder={type === 'EXCEL' ? 'Master Sales.xlsx' : 'sales.csv'}
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {type === 'GOOGLE_SHEETS' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="spreadsheet-id">Spreadsheet ID</Label>
                <Input
                  id="spreadsheet-id"
                  value={spreadsheetId}
                  onChange={(e) => setSpreadsheetId(e.target.value)}
                  placeholder="1AbC...xyz"
                />
                <p className="text-xs text-muted-foreground">
                  The long id in the sheet URL between /d/ and /edit.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="worksheet-title">Worksheet name</Label>
                <Input
                  id="worksheet-title"
                  value={worksheetTitle}
                  onChange={(e) => setWorksheetTitle(e.target.value)}
                />
              </div>
              {!googleConfigured ? (
                <div className="sm:col-span-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-4 w-4" /> Credentials required to activate this integration
                  </p>
                  <p className="mt-1">
                    Without GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET the connector runs in mock mode: mapping,
                    key matching and update strategies all execute and report what they would do, but nothing is
                    written to Google.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {['REST_API', 'CLIENT_WEBSITE', 'CLIENT_ADMIN'].includes(type) ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="base-url">API base URL</Label>
                <Input
                  id="base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://client-website.com/api/products"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-path">Create path</Label>
                <Input id="create-path" value={createPath} onChange={(e) => setCreatePath(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="update-path">Update path</Label>
                <Input id="update-path" value={updatePath} onChange={(e) => setUpdatePath(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  Use {'{id}'} for the record id, or {'{fieldName}'} for a mapped value.
                </p>
              </div>
              <div className="sm:col-span-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                Deletes are never issued from an automation. Destructive operations against your systems require
                explicit configuration by a person.
              </div>
            </div>
          ) : null}

          {type === 'WEBHOOK' ? (
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url">Webhook URL</Label>
              <Input
                id="webhook-url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/hooks/msgflow"
              />
              <p className="text-xs text-muted-foreground">
                Every payload is signed with HMAC-SHA256 in the X-MsgFlow-Signature header.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{preview.fileName}</CardTitle>
            <CardDescription>
              {formatBytes(preview.sizeBytes)} · {preview.worksheets.length} worksheet(s)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Worksheet to maintain</Label>
              <Select value={worksheet} onValueChange={setWorksheet}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {preview.worksheets.map((sheet) => (
                    <SelectItem key={sheet.name} value={sheet.name}>
                      {sheet.name} ({formatNumber(sheet.rowCount)} rows, {sheet.columnCount} columns)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedSheet ? (
              <>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Columns detected
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Column</TableHead>
                        <TableHead>Header</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Sample values</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedSheet.columns.map((column) => (
                        <TableRow key={column.index}>
                          <TableCell className="font-mono text-xs">{column.letter}</TableCell>
                          <TableCell className="font-medium">{column.header}</TableCell>
                          <TableCell>
                            <Badge variant="muted">{column.inferredType}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {column.sampleValues.slice(0, 3).join(' · ') || '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-success/30 bg-success/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-success">Preserved on write</p>
                    <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      {EXCEL_PRESERVED_FEATURES.slice(0, 6).map((f) => (
                        <li key={f}>· {f}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-warning">
                      Not guaranteed
                    </p>
                    <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      {EXCEL_AT_RISK_FEATURES.map((f) => (
                        <li key={f}>· {f}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {selectedSheet.warnings.length > 0 ? (
                  <div className="rounded-md border bg-muted/40 p-3 text-xs">
                    <p className="font-semibold">About this worksheet</p>
                    <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                      {selectedSheet.warnings.map((w, i) => (
                        <li key={i}>· {w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push('/dashboard/outputs')} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} loading={saving}>
          Create output
        </Button>
      </div>
    </div>
  );
}
