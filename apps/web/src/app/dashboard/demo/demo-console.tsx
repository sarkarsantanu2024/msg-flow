'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, CheckCircle2, Play, Save, XCircle } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { formatDuration, formatPercent, humanize, renderFieldValue } from '@/lib/format';

const SAMPLES = [
  'ABC Traders need 50 kg Product X at ₹250/kg. Delivery by 15 Aug.',
  'Stock update: Product ABC is now 75 units in the main godown.',
  'Order ORD-1042 from Sunrise Enterprises — 120 pcs Product Y, rate 180, dispatch tomorrow.',
  'Customer Metro Supplies complained the last consignment arrived damaged. Please arrange replacement.',
  'Meeting with Kumar Industries scheduled 14/08 at 11:00 to discuss the annual contract.',
];

interface DemoResult {
  provider: string;
  usingFallback: boolean;
  schema: { id: string; name: string; fields: Array<{ key: string; label: string; type: string; required: boolean }> };
  classification: { category: string; importance: string; confidence: number; reasoning: string; entities: Record<string, unknown> };
  extraction: {
    reasoning: string;
    confidence: number;
    records: Array<{
      data: Record<string, unknown>;
      valid: boolean;
      belowThreshold: boolean;
      confidence: number;
      errors: Array<{ field: string; message: string }>;
    }>;
  };
  outputPreviews: Array<{
    outputName: string;
    outputType: string;
    operation: string;
    keyFields: string[];
    rows: Array<Record<string, unknown>>;
  }>;
  persisted: boolean;
  persistedRecordIds: string[];
  timings: { classifyMs: number; extractMs: number };
}

const NONE = '__none__';

export function DemoConsole({
  schemas,
  automations,
  provider,
  usingFallback,
}: {
  schemas: Array<{ id: string; name: string; fieldCount: number }>;
  automations: Array<{ id: string; name: string; outputCount: number }>;
  provider: string;
  usingFallback: boolean;
}) {
  const [text, setText] = useState(SAMPLES[0]);
  const [automationId, setAutomationId] = useState(automations[0]?.id ?? NONE);
  const [schemaId, setSchemaId] = useState(schemas[0]?.id ?? NONE);
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DemoResult | null>(null);

  async function run() {
    if (text.trim().length < 3) {
      toast.error('Type a message first');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          automationId: automationId === NONE ? undefined : automationId,
          schemaId: schemaId === NONE ? undefined : schemaId,
          persist,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Demo failed.');

      setResult(body.data as DemoResult);
      toast.success('Pipeline complete', {
        description: persist ? 'Records were saved to your workspace.' : 'Preview only — nothing was saved.',
      });
    } catch (err) {
      toast.error('Could not process the message', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setBusy(false);
    }
  }

  const noSchema = schemas.length === 0 && automations.length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message</CardTitle>
            <CardDescription>
              Write it the way your team actually would — shorthand, units and Indian date formats are all handled.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />

            <div className="flex flex-wrap gap-1.5">
              {SAMPLES.map((sample, i) => (
                <Button key={i} size="sm" variant="outline" className="h-7 text-xs" onClick={() => setText(sample)}>
                  Sample {i + 1}
                </Button>
              ))}
            </div>

            {noSchema ? (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                Create an automation or data schema first so Demo Mode knows what to extract.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Run as automation</Label>
                  <Select value={automationId} onValueChange={setAutomationId}>
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Schema only</SelectItem>
                      {automations.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} ({a.outputCount} output)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Or pick a schema</Label>
                  <Select value={schemaId} onValueChange={setSchemaId} disabled={automationId !== NONE}>
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>First available</SelectItem>
                      {schemas.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} ({s.fieldCount} fields)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <label className="flex items-center gap-2.5 text-sm">
                <Switch checked={persist} onCheckedChange={setPersist} />
                <span>
                  <Save className="mr-1 inline h-3.5 w-3.5" />
                  Save the result to my workspace
                </span>
              </label>
              <Button onClick={run} loading={busy} disabled={noSchema}>
                <Play className="h-4 w-4" /> Run pipeline
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {usingFallback
                ? 'No AI key configured — using the built-in rule-based provider. Results are real, just not model-driven.'
                : `Using ${provider}.`}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {!result ? (
          <Card>
            <CardContent className="flex min-h-[20rem] flex-col items-center justify-center p-8 text-center">
              <ArrowRight className="h-6 w-6 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                Run the pipeline to see classification, extraction and the exact output row that would be written.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">1 · Classification</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {formatDuration(result.timings.classifyMs)}
                </span>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={result.classification.importance} label={humanize(result.classification.category)} />
                  <Badge variant="muted">Confidence {formatPercent(result.classification.confidence)}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{result.classification.reasoning}</p>
                {Object.keys(result.classification.entities).length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(result.classification.entities).map(([key, value]) => (
                      <Badge key={key} variant="secondary">
                        {key}: {renderFieldValue(value)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">2 · Extraction &amp; validation</CardTitle>
                  <CardDescription>{result.schema.name}</CardDescription>
                </div>
                <span className="text-xs text-muted-foreground">{formatDuration(result.timings.extractMs)}</span>
              </CardHeader>
              <CardContent>
                {result.extraction.records.length === 0 ? (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    <p className="font-medium">No records extracted</p>
                    <p className="mt-1 text-muted-foreground">{result.extraction.reasoning}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {result.extraction.records.map((record, i) => (
                      <div key={i} className="rounded-md border p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          {record.valid ? (
                            <Badge variant="success">
                              <CheckCircle2 className="h-3 w-3" /> Valid
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              <XCircle className="h-3 w-3" /> Failed validation
                            </Badge>
                          )}
                          {record.belowThreshold ? (
                            <Badge variant="warning">
                              <AlertTriangle className="h-3 w-3" /> Below threshold — would go to review
                            </Badge>
                          ) : null}
                          <Badge variant="muted">{formatPercent(record.confidence)}</Badge>
                        </div>

                        <dl className="grid gap-2 sm:grid-cols-2">
                          {result.schema.fields.map((field) => (
                            <div key={field.key}>
                              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                {field.label}
                              </dt>
                              <dd className="text-sm">{renderFieldValue(record.data[field.key])}</dd>
                            </div>
                          ))}
                        </dl>

                        {record.errors.length > 0 ? (
                          <ul className="mt-2 space-y-0.5 text-xs text-destructive">
                            {record.errors.map((error, j) => (
                              <li key={j}>
                                {error.field}: {error.message}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {result.outputPreviews.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">3 · Output preview</CardTitle>
                  <CardDescription>Exactly what would be written, using your real mapping</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {result.outputPreviews.map((preview, i) => (
                    <div key={i}>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{preview.outputName}</span>
                        <Badge variant="default">{humanize(preview.operation)}</Badge>
                        <Badge variant="muted">{humanize(preview.outputType)}</Badge>
                        {preview.keyFields.length > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            matched on {preview.keyFields.join(' + ')}
                          </span>
                        ) : null}
                      </div>
                      {preview.rows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No rows would be written.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {Object.keys(preview.rows[0]).map((column) => (
                                <TableHead key={column}>{column}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {preview.rows.map((row, j) => (
                              <TableRow key={j}>
                                {Object.keys(preview.rows[0]).map((column) => (
                                  <TableCell key={column}>{renderFieldValue(row[column])}</TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {result.persisted && result.persistedRecordIds.length > 0 ? (
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <p className="text-sm">
                    {result.persistedRecordIds.length} record(s) saved to your workspace.
                  </p>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/records/${result.persistedRecordIds[0]}`}>View record</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
