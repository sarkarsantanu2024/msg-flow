'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Plus, Sparkles, Trash2, Wand2 } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox, Switch } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { humanize } from '@/lib/format';

interface FieldDraft {
  key: string;
  label: string;
  type: string;
  required: boolean;
  isKeyField: boolean;
  description?: string;
}

const FIELD_TYPES = [
  'STRING',
  'TEXT',
  'NUMBER',
  'INTEGER',
  'DECIMAL',
  'CURRENCY',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'ENUM',
  'EMAIL',
  'PHONE',
];

const PROCESSING_MODES = ['REAL_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM', 'MANUAL'];

const DATE_RANGES = [
  'CURRENT_MESSAGE',
  'TODAY',
  'YESTERDAY',
  'THIS_WEEK',
  'LAST_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'LAST_7_DAYS',
  'CUSTOM',
  'SINCE_LAST_SUCCESSFUL_RUN',
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function AutomationBuilder({
  groups,
  schemas,
  timezone,
  aiProvider,
  usingFallback,
}: {
  groups: Array<{ id: string; name: string; isMonitored: boolean }>;
  schemas: Array<{ id: string; name: string; fields: Array<{ key: string; label: string; type: string; required: boolean }> }>;
  outputs: Array<{ id: string; name: string; type: string }>;
  timezone: string;
  aiProvider: string;
  usingFallback: boolean;
}) {
  const router = useRouter();

  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [useExistingSchema, setUseExistingSchema] = useState(false);
  const [schemaId, setSchemaId] = useState<string>('');
  const [schemaName, setSchemaName] = useState('');
  const [fields, setFields] = useState<FieldDraft[]>([
    { key: 'date', label: 'Date', type: 'DATE', required: true, isKeyField: true },
    { key: 'customerName', label: 'Customer', type: 'STRING', required: true, isKeyField: true },
  ]);

  const [processingMode, setProcessingMode] = useState('REAL_TIME');
  const [dateRangeMode, setDateRangeMode] = useState('SINCE_LAST_SUCCESSFUL_RUN');
  const [scheduleHour, setScheduleHour] = useState(23);
  const [scheduleMinute, setScheduleMinute] = useState(0);
  const [scheduleWeekday, setScheduleWeekday] = useState(1);
  const [scheduleDay, setScheduleDay] = useState(1);
  const [cronExpression, setCronExpression] = useState('');
  const [requireImportant, setRequireImportant] = useState(true);
  const [minConfidence, setMinConfidence] = useState(0.7);

  async function generate() {
    if (prompt.trim().length < 15) {
      toast.error('Describe it in a little more detail', {
        description: 'A sentence or two about what to extract and where it should go.',
      });
      return;
    }
    setGenerating(true);
    try {
      const response = await fetch('/api/automations/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not generate a draft.');

      const draft = body.data.draft;
      setName(draft.name);
      setDescription(draft.description);
      setSchemaName(draft.schema.name);
      setUseExistingSchema(false);
      setFields(
        draft.schema.fields.map((f: FieldDraft) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          isKeyField: (draft.output.keyFields ?? []).includes(f.key),
          description: f.description,
        })),
      );
      setProcessingMode(draft.processingMode);
      setDateRangeMode(draft.dateRangeMode);
      if (draft.suggestedGroupIds?.length) setSelectedGroups(draft.suggestedGroupIds);
      setAiReasoning(draft.reasoning);

      toast.success('Draft ready for review', {
        description: 'Nothing has been created yet. Check every field, then create the automation.',
      });
    } catch (err) {
      toast.error('Could not generate a draft', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      toast.error('Give the automation a name');
      return;
    }
    if (selectedGroups.length === 0) {
      toast.error('Select at least one WhatsApp group');
      return;
    }
    if (!useExistingSchema && fields.length === 0) {
      toast.error('Add at least one field to extract');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        description: description || undefined,
        groupIds: selectedGroups,
        processingMode,
        dateRangeMode,
        scheduleHour,
        scheduleMinute,
        scheduleWeekday,
        scheduleDay,
        cronExpression: processingMode === 'CUSTOM' ? cronExpression : undefined,
        timezone,
        requireImportant,
        minConfidence,
      };

      if (useExistingSchema && schemaId) {
        payload.schemaId = schemaId;
      } else {
        payload.schema = {
          name: schemaName || `${name} data`,
          confidenceThreshold: minConfidence,
          fields: fields.map((f, index) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
            isKeyField: f.isKeyField,
            description: f.description,
            enumValues: [],
            validation: {},
            order: index,
          })),
        };
      }

      const response = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not create the automation.');

      toast.success('Automation created as a draft', {
        description: 'Connect an output, then activate it.',
      });
      router.push(`/dashboard/automations/${body.data.id}`);
    } catch (err) {
      toast.error('Could not create automation', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  }

  const monitoredGroups = groups.filter((g) => g.isMonitored);
  const keyFields = fields.filter((f) => f.isKeyField);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Describe what you want to automate
          </CardTitle>
          <CardDescription>
            For example: “Extract sales enquiries from the Sales group and update my master Excel every evening.”
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Extract sales enquiries from the Sales group and update my master Excel…"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={generate} loading={generating}>
              <Wand2 className="h-4 w-4" /> Generate draft
            </Button>
            {usingFallback ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                No AI key configured — using the built-in rule-based drafter.
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Using {aiProvider}</span>
            )}
          </div>
          {aiReasoning ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Review this draft before creating
              </p>
              <p className="text-muted-foreground">{aiReasoning}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Tabs defaultValue="basics">
        <TabsList>
          <TabsTrigger value="basics">Basics</TabsTrigger>
          <TabsTrigger value="schema">Data to extract</TabsTrigger>
          <TabsTrigger value="schedule">Processing</TabsTrigger>
        </TabsList>

        <TabsContent value="basics">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Automation name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sales Enquiry Extraction" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What this automation is for"
                  />
                </div>
              </div>

              <div>
                <Label>Source groups</Label>
                <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
                  Only monitored groups can be selected — enable monitoring on the Groups page first.
                </p>
                {monitoredGroups.length === 0 ? (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    No groups are being monitored yet. Enable monitoring on the Groups page to continue.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {monitoredGroups.map((group) => (
                      <label
                        key={group.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 text-sm hover:bg-accent"
                      >
                        <Checkbox
                          checked={selectedGroups.includes(group.id)}
                          onCheckedChange={(checked) =>
                            setSelectedGroups((prev) =>
                              checked ? [...prev, group.id] : prev.filter((id) => id !== group.id),
                            )
                          }
                        />
                        <span className="truncate">{group.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schema">
          <Card>
            <CardContent className="space-y-4 p-5">
              {schemas.length > 0 ? (
                <div className="flex items-center gap-3">
                  <Switch checked={useExistingSchema} onCheckedChange={setUseExistingSchema} id="use-existing" />
                  <Label htmlFor="use-existing">Reuse an existing data schema</Label>
                </div>
              ) : null}

              {useExistingSchema ? (
                <div className="space-y-1.5">
                  <Label>Data schema</Label>
                  <Select value={schemaId} onValueChange={setSchemaId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a schema" />
                    </SelectTrigger>
                    <SelectContent>
                      {schemas.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} ({s.fields.length} fields)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="schemaName">Schema name</Label>
                    <Input
                      id="schemaName"
                      value={schemaName}
                      onChange={(e) => setSchemaName(e.target.value)}
                      placeholder="Sales Enquiry"
                    />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <Label>Fields to extract</Label>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setFields((prev) => [
                            ...prev,
                            { key: `field${prev.length + 1}`, label: '', type: 'STRING', required: false, isKeyField: false },
                          ])
                        }
                      >
                        <Plus className="h-3.5 w-3.5" /> Add field
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {fields.map((field, index) => (
                        <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_9rem_auto]">
                          <Input
                            value={field.key}
                            onChange={(e) =>
                              setFields((prev) =>
                                prev.map((f, i) => (i === index ? { ...f, key: e.target.value } : f)),
                              )
                            }
                            placeholder="fieldKey"
                            aria-label="Field key"
                          />
                          <Input
                            value={field.label}
                            onChange={(e) =>
                              setFields((prev) =>
                                prev.map((f, i) => (i === index ? { ...f, label: e.target.value } : f)),
                              )
                            }
                            placeholder="Display label"
                            aria-label="Field label"
                          />
                          <Select
                            value={field.type}
                            onValueChange={(v) =>
                              setFields((prev) => prev.map((f, i) => (i === index ? { ...f, type: v } : f)))
                            }
                          >
                            <SelectTrigger aria-label="Field type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FIELD_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {humanize(t)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-xs">
                              <Checkbox
                                checked={field.required}
                                onCheckedChange={(checked) =>
                                  setFields((prev) =>
                                    prev.map((f, i) => (i === index ? { ...f, required: Boolean(checked) } : f)),
                                  )
                                }
                              />
                              Required
                            </label>
                            <label className="flex items-center gap-1.5 text-xs" title="Part of the unique key">
                              <Checkbox
                                checked={field.isKeyField}
                                onCheckedChange={(checked) =>
                                  setFields((prev) =>
                                    prev.map((f, i) => (i === index ? { ...f, isKeyField: Boolean(checked) } : f)),
                                  )
                                }
                              />
                              Key
                            </label>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setFields((prev) => prev.filter((_, i) => i !== index))}
                              aria-label="Remove field"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 rounded-md border bg-muted/40 p-3 text-xs">
                      <p className="font-medium">How should we identify an existing record?</p>
                      <p className="mt-1 text-muted-foreground">
                        {keyFields.length === 0
                          ? 'No key fields selected. Without a key, every message creates a new record instead of updating an existing one.'
                          : `Records are matched on: ${keyFields.map((f) => f.label || f.key).join(' + ')}.`}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Processing mode</Label>
                  <Select value={processingMode} onValueChange={setProcessingMode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROCESSING_MODES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {humanize(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Which messages to process</Label>
                  <Select value={dateRangeMode} onValueChange={setDateRangeMode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_RANGES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {humanize(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {dateRangeMode === 'SINCE_LAST_SUCCESSFUL_RUN' ? (
                    <p className="text-xs text-muted-foreground">
                      Recommended. Only new messages are processed, so the same message is never sent to the AI twice.
                    </p>
                  ) : null}
                </div>
              </div>

              {['DAILY', 'WEEKLY', 'MONTHLY'].includes(processingMode) ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  {processingMode === 'WEEKLY' ? (
                    <div className="space-y-1.5">
                      <Label>Day of week</Label>
                      <Select value={String(scheduleWeekday)} onValueChange={(v) => setScheduleWeekday(Number(v))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEEKDAYS.map((d, i) => (
                            <SelectItem key={d} value={String(i)}>
                              {d}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  {processingMode === 'MONTHLY' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="scheduleDay">Day of month</Label>
                      <Input
                        id="scheduleDay"
                        type="number"
                        min={1}
                        max={28}
                        value={scheduleDay}
                        onChange={(e) => setScheduleDay(Number(e.target.value))}
                      />
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label htmlFor="hour">Hour</Label>
                    <Input
                      id="hour"
                      type="number"
                      min={0}
                      max={23}
                      value={scheduleHour}
                      onChange={(e) => setScheduleHour(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="minute">Minute</Label>
                    <Input
                      id="minute"
                      type="number"
                      min={0}
                      max={59}
                      value={scheduleMinute}
                      onChange={(e) => setScheduleMinute(Number(e.target.value))}
                    />
                  </div>
                </div>
              ) : null}

              {processingMode === 'CUSTOM' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="cron">Cron expression</Label>
                  <Input
                    id="cron"
                    value={cronExpression}
                    onChange={(e) => setCronExpression(e.target.value)}
                    placeholder="0 23 * * *"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">Evaluated in {timezone}.</p>
                </div>
              ) : null}

              <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
                <div className="flex items-start gap-3">
                  <Switch checked={requireImportant} onCheckedChange={setRequireImportant} id="require-important" />
                  <div>
                    <Label htmlFor="require-important">Only process important messages</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Skips greetings and chatter before spending AI tokens on extraction.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confidence">Minimum confidence</Label>
                  <Input
                    id="confidence"
                    type="number"
                    step={0.05}
                    min={0}
                    max={1}
                    value={minConfidence}
                    onChange={(e) => setMinConfidence(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Below this, records go to the review queue instead of your outputs.
                  </p>
                </div>
              </div>

              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Before you activate
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{humanize(processingMode)}</Badge>
                  <Badge variant="secondary">{humanize(dateRangeMode)}</Badge>
                  <Badge variant="secondary">{selectedGroups.length} group(s)</Badge>
                  <Badge variant="secondary">
                    {useExistingSchema ? 'Existing schema' : `${fields.length} field(s)`}
                  </Badge>
                  <Badge variant="warning">Output connected after creation</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => router.push('/dashboard/automations')} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} loading={saving}>
          Create automation
        </Button>
      </div>
    </div>
  );
}
