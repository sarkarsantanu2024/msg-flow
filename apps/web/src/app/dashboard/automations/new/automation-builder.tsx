'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageSquare,
  Plus,
  Table2,
  Trash2,
  Upload,
} from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox, Switch } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Automation builder.
 *
 * Built as a three-step wizard rather than one long form: an automation is
 * three separate decisions — where the messages come from, what to pull out of
 * them, and when that runs — and asking them one at a time is the difference
 * between a form someone completes and one they abandon. Every choice is the
 * user's own; nothing is drafted for them.
 */

interface FieldDraft {
  key: string;
  label: string;
  type: string;
  required: boolean;
  isKeyField: boolean;
  description?: string;
}

/** Plain-English names for the storage types. The enum values go to the API. */
const FIELD_TYPES: Array<{ value: string; label: string }> = [
  { value: 'STRING', label: 'Short text' },
  { value: 'TEXT', label: 'Long text' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'INTEGER', label: 'Whole number' },
  { value: 'DECIMAL', label: 'Decimal' },
  { value: 'CURRENCY', label: 'Money' },
  { value: 'BOOLEAN', label: 'Yes / No' },
  { value: 'DATE', label: 'Date' },
  { value: 'DATETIME', label: 'Date & time' },
  { value: 'ENUM', label: 'Fixed choices' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'PHONE', label: 'Phone number' },
];

const PROCESSING_MODES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'REAL_TIME', label: 'As messages arrive', hint: 'Each message is processed the moment it lands.' },
  { value: 'DAILY', label: 'Once a day', hint: 'One batch at a time you choose.' },
  { value: 'WEEKLY', label: 'Once a week', hint: 'One batch on a chosen weekday.' },
  { value: 'MONTHLY', label: 'Once a month', hint: 'One batch on a chosen date.' },
  { value: 'CUSTOM', label: 'Custom schedule', hint: 'Your own cron expression.' },
  { value: 'MANUAL', label: 'Only when I run it', hint: 'Nothing happens until you press Run.' },
];

const DATE_RANGES: Array<{ value: string; label: string }> = [
  { value: 'SINCE_LAST_SUCCESSFUL_RUN', label: 'Everything new since the last run' },
  { value: 'CURRENT_MESSAGE', label: 'Only the message that triggered it' },
  { value: 'TODAY', label: "Today's messages" },
  { value: 'YESTERDAY', label: "Yesterday's messages" },
  { value: 'THIS_WEEK', label: 'This week' },
  { value: 'LAST_WEEK', label: 'Last week' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'LAST_MONTH', label: 'Last month' },
  { value: 'LAST_7_DAYS', label: 'The last 7 days' },
  { value: 'CUSTOM', label: 'A custom range' },
];

const CONFIDENCE_LEVELS: Array<{ value: string; label: string; hint: string }> = [
  { value: '0.5', label: 'Lenient', hint: 'Accept most extractions; fewer land in review.' },
  { value: '0.7', label: 'Balanced', hint: 'Recommended for most workspaces.' },
  { value: '0.85', label: 'Strict', hint: 'Only very confident extractions go straight through.' },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Ready-made column sets, so nobody has to build a common register from scratch. */
const TEMPLATES: Array<{ id: string; name: string; summary: string; schemaName: string; fields: FieldDraft[] }> = [
  {
    id: 'sales',
    name: 'Sales enquiries',
    summary: 'Who asked, for what, and how much it is worth.',
    schemaName: 'Sales Enquiry',
    fields: [
      { key: 'date', label: 'Date', type: 'DATE', required: true, isKeyField: true },
      { key: 'customerName', label: 'Customer', type: 'STRING', required: true, isKeyField: true },
      { key: 'phone', label: 'Phone', type: 'PHONE', required: false, isKeyField: false },
      { key: 'product', label: 'Product', type: 'STRING', required: false, isKeyField: false },
      { key: 'quantity', label: 'Quantity', type: 'NUMBER', required: false, isKeyField: false },
      { key: 'value', label: 'Value', type: 'CURRENCY', required: false, isKeyField: false },
    ],
  },
  {
    id: 'orders',
    name: 'Orders',
    summary: 'Order number, items, amount and delivery date.',
    schemaName: 'Order',
    fields: [
      { key: 'orderDate', label: 'Order date', type: 'DATE', required: true, isKeyField: false },
      { key: 'orderNumber', label: 'Order number', type: 'STRING', required: true, isKeyField: true },
      { key: 'customerName', label: 'Customer', type: 'STRING', required: true, isKeyField: false },
      { key: 'item', label: 'Item', type: 'STRING', required: true, isKeyField: false },
      { key: 'quantity', label: 'Quantity', type: 'INTEGER', required: true, isKeyField: false },
      { key: 'amount', label: 'Amount', type: 'CURRENCY', required: false, isKeyField: false },
      { key: 'deliveryDate', label: 'Delivery date', type: 'DATE', required: false, isKeyField: false },
    ],
  },
  {
    id: 'payments',
    name: 'Payments received',
    summary: 'Who paid, how much, by which method.',
    schemaName: 'Payment',
    fields: [
      { key: 'date', label: 'Date', type: 'DATE', required: true, isKeyField: true },
      { key: 'payerName', label: 'Paid by', type: 'STRING', required: true, isKeyField: true },
      { key: 'amount', label: 'Amount', type: 'CURRENCY', required: true, isKeyField: false },
      { key: 'method', label: 'Method', type: 'STRING', required: false, isKeyField: false },
      { key: 'reference', label: 'Reference', type: 'STRING', required: false, isKeyField: false },
    ],
  },
  {
    id: 'attendance',
    name: 'Attendance',
    summary: 'Who was present on which day.',
    schemaName: 'Attendance',
    fields: [
      { key: 'date', label: 'Date', type: 'DATE', required: true, isKeyField: true },
      { key: 'personName', label: 'Name', type: 'STRING', required: true, isKeyField: true },
      { key: 'status', label: 'Status', type: 'STRING', required: true, isKeyField: false },
      { key: 'checkIn', label: 'Check in', type: 'DATETIME', required: false, isKeyField: false },
      { key: 'checkOut', label: 'Check out', type: 'DATETIME', required: false, isKeyField: false },
    ],
  },
  {
    id: 'support',
    name: 'Support requests',
    summary: 'Issues raised, with priority and status.',
    schemaName: 'Support Request',
    fields: [
      { key: 'date', label: 'Date', type: 'DATE', required: true, isKeyField: false },
      { key: 'ticketRef', label: 'Reference', type: 'STRING', required: true, isKeyField: true },
      { key: 'customerName', label: 'Customer', type: 'STRING', required: true, isKeyField: false },
      { key: 'issue', label: 'Issue', type: 'TEXT', required: true, isKeyField: false },
      { key: 'priority', label: 'Priority', type: 'STRING', required: false, isKeyField: false },
      { key: 'status', label: 'Status', type: 'STRING', required: false, isKeyField: false },
    ],
  },
  {
    id: 'blank',
    name: 'Start from scratch',
    summary: 'An empty list — add exactly the columns you need.',
    schemaName: '',
    fields: [],
  },
];

const STEPS = [
  { id: 1, title: 'Source', hint: 'Which groups to read', icon: MessageSquare },
  { id: 2, title: 'Data to capture', hint: 'The columns you want', icon: Table2 },
  { id: 3, title: 'When it runs', hint: 'Schedule and quality', icon: Clock },
];

/** Turn a human label into a stable field key: "Order date" → "orderDate". */
function toKey(label: string): string {
  const words = label.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return '';
  return words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

export function AutomationBuilder({
  groups,
  schemas,
  timezone,
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

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [showKeys, setShowKeys] = useState(false);

  // Step 1
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);

  // Step 2
  const [templateId, setTemplateId] = useState<string>('sales');
  const [useExistingSchema, setUseExistingSchema] = useState(false);
  const [schemaId, setSchemaId] = useState<string>('');
  const [schemaName, setSchemaName] = useState('Sales Enquiry');
  const [fields, setFields] = useState<FieldDraft[]>(TEMPLATES[0].fields);

  // Step 3
  const [processingMode, setProcessingMode] = useState('REAL_TIME');
  const [dateRangeMode, setDateRangeMode] = useState('SINCE_LAST_SUCCESSFUL_RUN');
  const [scheduleHour, setScheduleHour] = useState(23);
  const [scheduleMinute, setScheduleMinute] = useState(0);
  const [scheduleWeekday, setScheduleWeekday] = useState(1);
  const [scheduleDay, setScheduleDay] = useState(1);
  const [cronExpression, setCronExpression] = useState('');
  const [requireImportant, setRequireImportant] = useState(true);
  const [minConfidence, setMinConfidence] = useState('0.7');

  const monitoredGroups = useMemo(() => groups.filter((g) => g.isMonitored), [groups]);
  const keyFields = fields.filter((f) => f.isKeyField);

  function applyTemplate(id: string) {
    const template = TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    setTemplateId(id);
    setUseExistingSchema(false);
    setFields(template.fields.map((f) => ({ ...f })));
    setSchemaName(template.schemaName);
  }

  function updateField(index: number, patch: Partial<FieldDraft>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  /** Photo of an existing register → proposed columns, all of them editable below. */
  async function proposeFromImage(file: File) {
    setProposing(true);
    try {
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(file);
      });
      const response = await fetch('/api/schemas/propose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mediaType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'The image could not be read.');
      const proposal = body.data.proposal as { name: string; fields: FieldDraft[] };
      if (!proposal.fields?.length) throw new Error('No columns were recognised in the image.');
      setUseExistingSchema(false);
      setTemplateId('');
      setSchemaName(proposal.name);
      setFields(proposal.fields);
      toast.success(`${proposal.fields.length} column(s) read from the image`, {
        description: 'Edit anything that is not right before you continue.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The image could not be read.');
    } finally {
      setProposing(false);
    }
  }

  const stepErrors: Record<number, string | null> = {
    1: !name.trim()
      ? 'Give the automation a name.'
      : selectedGroups.length === 0
        ? 'Choose at least one group to read from.'
        : null,
    2: useExistingSchema
      ? schemaId
        ? null
        : 'Choose the saved data set to reuse.'
      : fields.length === 0
        ? 'Add at least one column to capture.'
        : fields.some((f) => !f.label.trim())
          ? 'Every column needs a name.'
          : null,
    3: processingMode === 'CUSTOM' && !cronExpression.trim() ? 'Enter a cron expression for the custom schedule.' : null,
  };

  function goNext() {
    const error = stepErrors[step];
    if (error) {
      toast.error(error);
      return;
    }
    setStep((s) => Math.min(3, s + 1));
  }

  function goToStep(target: number) {
    // Forward navigation has to pass the steps it skips; going back never does.
    if (target > step) {
      for (let s = step; s < target; s++) {
        if (stepErrors[s]) {
          toast.error(stepErrors[s] as string);
          setStep(s);
          return;
        }
      }
    }
    setStep(target);
  }

  const scheduleSummary =
    processingMode === 'REAL_TIME'
      ? 'as each message arrives'
      : processingMode === 'MANUAL'
        ? 'only when you run it'
        : processingMode === 'CUSTOM'
          ? `on the schedule ${cronExpression || '…'}`
          : processingMode === 'DAILY'
            ? `every day at ${String(scheduleHour).padStart(2, '0')}:${String(scheduleMinute).padStart(2, '0')}`
            : processingMode === 'WEEKLY'
              ? `every ${WEEKDAYS[scheduleWeekday]} at ${String(scheduleHour).padStart(2, '0')}:${String(scheduleMinute).padStart(2, '0')}`
              : `on day ${scheduleDay} of each month at ${String(scheduleHour).padStart(2, '0')}:${String(scheduleMinute).padStart(2, '0')}`;

  async function save() {
    for (const s of [1, 2, 3]) {
      if (stepErrors[s]) {
        toast.error(stepErrors[s] as string);
        setStep(s);
        return;
      }
    }

    setSaving(true);
    try {
      const confidence = Number(minConfidence);
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
        minConfidence: confidence,
      };

      if (useExistingSchema && schemaId) {
        payload.schemaId = schemaId;
      } else {
        payload.schema = {
          name: schemaName || `${name} data`,
          confidenceThreshold: confidence,
          fields: fields.map((f, index) => ({
            key: f.key || toKey(f.label) || `field${index + 1}`,
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

  return (
    <div className="space-y-5">
      {/* --- Stepper ------------------------------------------------------ */}
      <ol className="grid gap-2 sm:grid-cols-3">
        {STEPS.map((s) => {
          const done = s.id < step && !stepErrors[s.id];
          const active = s.id === step;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => goToStep(s.id)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                  active ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : done
                        ? 'bg-success/15 text-success'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {done ? <Check className="h-4 w-4" /> : s.id}
                </span>
                <span className="min-w-0">
                  <span className={cn('block truncate text-sm font-medium', !active && !done && 'text-muted-foreground')}>
                    {s.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{s.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* --- Step 1: source ----------------------------------------------- */}
      {step === 1 ? (
        <Card>
          <CardContent className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Automation name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Daily sales register"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">Only you and your team see this.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description (optional)</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this is for"
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label>Read messages from</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {monitoredGroups.length > 0
                      ? `${selectedGroups.length} of ${monitoredGroups.length} group(s) selected.`
                      : 'Groups must be monitored before they can be used here.'}
                  </p>
                </div>
                {monitoredGroups.length > 1 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSelectedGroups((prev) =>
                        prev.length === monitoredGroups.length ? [] : monitoredGroups.map((g) => g.id),
                      )
                    }
                  >
                    {selectedGroups.length === monitoredGroups.length ? 'Clear all' : 'Select all'}
                  </Button>
                ) : null}
              </div>

              {monitoredGroups.length === 0 ? (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
                  No groups are being monitored yet. Turn monitoring on for a group on the Groups page, then come back.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {monitoredGroups.map((group) => {
                    const checked = selectedGroups.includes(group.id);
                    return (
                      <label
                        key={group.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-md border p-3 text-sm transition-colors',
                          checked ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) =>
                            setSelectedGroups((prev) =>
                              value ? [...prev, group.id] : prev.filter((id) => id !== group.id),
                            )
                          }
                        />
                        <span className="truncate">{group.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* --- Step 2: what to capture -------------------------------------- */}
      {step === 2 ? (
        <div className="space-y-4">
          {schemas.length > 0 ? (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Switch checked={useExistingSchema} onCheckedChange={setUseExistingSchema} id="use-existing" />
                  <div>
                    <Label htmlFor="use-existing">Reuse a data set you already built</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Keeps both automations writing the same columns.
                    </p>
                  </div>
                </div>
                {useExistingSchema ? (
                  <Select value={schemaId} onValueChange={setSchemaId}>
                    <SelectTrigger className="w-full sm:w-72">
                      <SelectValue placeholder="Choose a data set" />
                    </SelectTrigger>
                    <SelectContent>
                      {schemas.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} · {s.fields.length} column(s)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {useExistingSchema ? null : (
            <>
              <Card>
                <CardContent className="space-y-3 p-5">
                  <div>
                    <Label>Start from</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Pick the closest match — every column stays editable below.
                    </p>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {TEMPLATES.map((template) => {
                      const selected = templateId === template.id;
                      return (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => applyTemplate(template.id)}
                          className={cn(
                            'rounded-md border p-3 text-left transition-colors',
                            selected ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{template.name}</span>
                            {selected ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{template.summary}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                    <Label
                      htmlFor="schemaImage"
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {proposing ? 'Reading the image…' : 'Read columns from a photo of my sheet'}
                    </Label>
                    <input
                      id="schemaImage"
                      type="file"
                      accept="image/jpeg,image/png"
                      className="sr-only"
                      disabled={proposing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void proposeFromImage(file);
                        e.target.value = '';
                      }}
                    />
                    <span className="text-xs text-muted-foreground">Optional. The image is not stored.</span>
                    {usingFallback ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        No AI key configured — photo reading is limited.
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-4 p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="schemaName">Name for this data set</Label>
                      <Input
                        id="schemaName"
                        value={schemaName}
                        onChange={(e) => setSchemaName(e.target.value)}
                        placeholder="Sales Enquiry"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Label>Columns to capture</Label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {fields.length} column(s). These become the columns of your sheet.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                          <Checkbox checked={showKeys} onCheckedChange={(v) => setShowKeys(Boolean(v))} />
                          Show field keys
                        </label>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setFields((prev) => [
                              ...prev,
                              { key: '', label: '', type: 'STRING', required: false, isKeyField: false },
                            ])
                          }
                        >
                          <Plus className="h-3.5 w-3.5" /> Add column
                        </Button>
                      </div>
                    </div>

                    {fields.length === 0 ? (
                      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                        No columns yet. Add the first one, or pick a starting point above.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {fields.map((field, index) => (
                          <div key={index} className="rounded-md border p-3">
                            <div className="grid gap-2 sm:grid-cols-[1fr_11rem_auto]">
                              <div className="space-y-1">
                                <Input
                                  value={field.label}
                                  onChange={(e) => {
                                    const label = e.target.value;
                                    // The key follows the label until someone
                                    // sets one by hand; then it stays put.
                                    const autoKey = !field.key || field.key === toKey(fields[index].label);
                                    updateField(index, autoKey ? { label, key: toKey(label) } : { label });
                                  }}
                                  placeholder="Column name, e.g. Customer"
                                  aria-label="Column name"
                                />
                                {showKeys ? (
                                  <Input
                                    value={field.key}
                                    onChange={(e) => updateField(index, { key: e.target.value })}
                                    placeholder="fieldKey"
                                    aria-label="Field key"
                                    className="h-8 font-mono text-xs"
                                  />
                                ) : null}
                              </div>

                              <Select value={field.type} onValueChange={(v) => updateField(index, { type: v })}>
                                <SelectTrigger aria-label="Column type">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {FIELD_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>
                                      {t.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              <div className="flex items-center gap-3">
                                <label className="flex cursor-pointer items-center gap-1.5 text-xs" title="The message is only accepted if this column has a value">
                                  <Checkbox
                                    checked={field.required}
                                    onCheckedChange={(v) => updateField(index, { required: Boolean(v) })}
                                  />
                                  Required
                                </label>
                                <label className="flex cursor-pointer items-center gap-1.5 text-xs" title="Used to recognise a row that already exists">
                                  <Checkbox
                                    checked={field.isKeyField}
                                    onCheckedChange={(v) => updateField(index, { isKeyField: Boolean(v) })}
                                  />
                                  Match on
                                </label>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setFields((prev) => prev.filter((_, i) => i !== index))}
                                  aria-label={`Remove ${field.label || 'column'}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div
                      className={cn(
                        'mt-3 rounded-md border p-3 text-xs',
                        keyFields.length === 0 ? 'border-warning/30 bg-warning/10' : 'bg-muted/40',
                      )}
                    >
                      <p className="font-medium">Updating rows instead of adding new ones</p>
                      <p className={cn('mt-1', keyFields.length === 0 ? 'text-warning' : 'text-muted-foreground')}>
                        {keyFields.length === 0
                          ? 'Nothing is ticked under “Match on”, so every message adds a new row. Tick the columns that identify a record to update rows in place instead.'
                          : `A row is treated as the same record when ${keyFields
                              .map((f) => f.label || f.key)
                              .join(' + ')} match.`}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      ) : null}

      {/* --- Step 3: when it runs ----------------------------------------- */}
      {step === 3 ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <Label>How often should this run?</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">You can change this at any time.</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {PROCESSING_MODES.map((mode) => {
                  const selected = processingMode === mode.value;
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => setProcessingMode(mode.value)}
                      className={cn(
                        'rounded-md border p-3 text-left transition-colors',
                        selected ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{mode.label}</span>
                        {selected ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{mode.hint}</span>
                    </button>
                  );
                })}
              </div>

              {['DAILY', 'WEEKLY', 'MONTHLY'].includes(processingMode) ? (
                <div className="grid gap-4 border-t pt-4 sm:grid-cols-3">
                  {processingMode === 'WEEKLY' ? (
                    <div className="space-y-1.5">
                      <Label>Day of the week</Label>
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
                      <Label htmlFor="scheduleDay">Day of the month</Label>
                      <Input
                        id="scheduleDay"
                        type="number"
                        min={1}
                        max={28}
                        value={scheduleDay}
                        onChange={(e) => setScheduleDay(Number(e.target.value))}
                      />
                      <p className="text-xs text-muted-foreground">1–28, so every month has that day.</p>
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label>Time</Label>
                    <div className="flex items-center gap-2">
                      <Select value={String(scheduleHour)} onValueChange={(v) => setScheduleHour(Number(v))}>
                        <SelectTrigger aria-label="Hour">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 24 }, (_, h) => (
                            <SelectItem key={h} value={String(h)}>
                              {String(h).padStart(2, '0')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground">:</span>
                      <Select value={String(scheduleMinute)} onValueChange={(v) => setScheduleMinute(Number(v))}>
                        <SelectTrigger aria-label="Minute">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[0, 15, 30, 45].map((m) => (
                            <SelectItem key={m} value={String(m)}>
                              {String(m).padStart(2, '0')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">In {timezone}.</p>
                  </div>
                </div>
              ) : null}

              {processingMode === 'CUSTOM' ? (
                <div className="space-y-1.5 border-t pt-4">
                  <Label htmlFor="cron">Cron expression</Label>
                  <Input
                    id="cron"
                    value={cronExpression}
                    onChange={(e) => setCronExpression(e.target.value)}
                    placeholder="0 23 * * *"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Minute, hour, day of month, month, day of week — evaluated in {timezone}.
                  </p>
                </div>
              ) : null}

              <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Which messages to include</Label>
                  <Select value={dateRangeMode} onValueChange={setDateRangeMode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_RANGES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {dateRangeMode === 'SINCE_LAST_SUCCESSFUL_RUN' ? (
                    <p className="text-xs text-muted-foreground">
                      Recommended — the same message is never processed, or paid for, twice.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label>How sure must the AI be?</Label>
                  <Select value={minConfidence} onValueChange={setMinConfidence}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONFIDENCE_LEVELS.map((level) => (
                        <SelectItem key={level.value} value={level.value}>
                          {level.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {CONFIDENCE_LEVELS.find((l) => l.value === minConfidence)?.hint} Anything below it waits in the
                    review queue.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 border-t pt-4">
                <Switch checked={requireImportant} onCheckedChange={setRequireImportant} id="require-important" />
                <div>
                  <Label htmlFor="require-important">Skip small talk</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Greetings and chatter are filtered out before anything is sent to the AI, which keeps the cost down.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Plain-language recap of everything chosen so far. */}
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review</p>
              <p className="text-sm">
                <span className="font-medium">{name || 'This automation'}</span> reads{' '}
                <span className="font-medium">{selectedGroups.length} group(s)</span>, captures{' '}
                <span className="font-medium">
                  {useExistingSchema
                    ? (schemas.find((s) => s.id === schemaId)?.fields.length ?? 0)
                    : fields.length}{' '}
                  column(s)
                </span>
                , and runs <span className="font-medium">{scheduleSummary}</span>.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{PROCESSING_MODES.find((m) => m.value === processingMode)?.label}</Badge>
                <Badge variant="secondary">{DATE_RANGES.find((r) => r.value === dateRangeMode)?.label}</Badge>
                <Badge variant="secondary">
                  {CONFIDENCE_LEVELS.find((l) => l.value === minConfidence)?.label} confidence
                </Badge>
                <Badge variant="warning">Created as a draft — connect an output, then activate</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* --- Footer navigation -------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          onClick={() => (step === 1 ? router.push('/dashboard/automations') : setStep(step - 1))}
          disabled={saving}
        >
          <ChevronLeft className="h-4 w-4" /> {step === 1 ? 'Cancel' : 'Back'}
        </Button>

        {step < 3 ? (
          <Button onClick={goNext}>
            Continue <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={save} loading={saving}>
            Create automation
          </Button>
        )}
      </div>
    </div>
  );
}
