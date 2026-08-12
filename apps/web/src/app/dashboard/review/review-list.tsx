'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, MessageSquare, PencilLine, RefreshCw, X } from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime, formatPercent, renderFieldValue } from '@/lib/format';

interface ReviewField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  enumValues: string[];
}

interface ReviewRecord {
  id: string;
  naturalKey: string;
  confidence: number;
  updatedAt: string;
  schemaName: string;
  automationName: string | null;
  data: Record<string, unknown>;
  fields: ReviewField[];
  sourceText: string | null;
  sourceSender: string | null;
  sourceGroup: string | null;
  sourceAt: string | null;
}

export function ReviewList({
  records,
  canReview,
  timezone,
}: {
  records: ReviewRecord[];
  canReview: boolean;
  timezone: string;
}) {
  return (
    <div className="space-y-3">
      {records.map((record) => (
        <ReviewCard key={record.id} record={record} canReview={canReview} timezone={timezone} />
      ))}
    </div>
  );
}

function ReviewCard({
  record,
  canReview,
  timezone,
}: {
  record: ReviewRecord;
  canReview: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      record.fields.map((f) => [
        f.key,
        record.data[f.key] === null || record.data[f.key] === undefined ? '' : String(record.data[f.key]),
      ]),
    ),
  );

  async function act(action: 'approve' | 'edit_approve' | 'reject' | 'reprocess') {
    setBusy(action);
    try {
      const payload: Record<string, unknown> = { action };
      if (action === 'edit_approve') {
        payload.data = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
      }

      const response = await fetch(`/api/records/${record.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        const detail = Array.isArray(body?.error?.detail)
          ? (body.error.detail as Array<{ field: string; message: string }>)
              .map((d) => `${d.field}: ${d.message}`)
              .join('; ')
          : undefined;
        throw new Error(detail ?? body?.error?.message ?? 'Action failed.');
      }

      toast.success(
        action === 'reject'
          ? 'Record rejected'
          : action === 'reprocess'
            ? 'Sent back through the AI'
            : 'Record approved',
        { description: action === 'reject' ? 'It will not be written to any output.' : undefined },
      );
      router.refresh();
    } catch (err) {
      toast.error('Action failed', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  }

  const missingRequired = record.fields.filter((f) => f.required && !record.data[f.key]);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/dashboard/records/${record.id}`} className="font-medium hover:underline">
              {record.naturalKey.replace(/\|/g, ' · ')}
            </Link>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {record.schemaName}
              {record.automationName ? ` · ${record.automationName}` : ''} ·{' '}
              {formatDateTime(record.updatedAt, timezone)}
            </p>
          </div>
          <Badge variant={record.confidence < 0.5 ? 'destructive' : 'warning'}>
            Confidence {formatPercent(record.confidence)}
          </Badge>
        </div>

        {missingRequired.length > 0 ? (
          <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
            Missing required field{missingRequired.length > 1 ? 's' : ''}:{' '}
            {missingRequired.map((f) => f.label).join(', ')}
          </p>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Extracted data
            </p>
            <dl className="grid gap-2.5 sm:grid-cols-2">
              {record.fields.map((field) => (
                <div key={field.key}>
                  <dt>
                    <Label
                      htmlFor={`${record.id}-${field.key}`}
                      className="text-xs uppercase tracking-wide text-muted-foreground"
                    >
                      {field.label}
                      {field.required ? <span className="ml-1 text-destructive">*</span> : null}
                    </Label>
                  </dt>
                  <dd className="mt-0.5">
                    {editing ? (
                      <Input
                        id={`${record.id}-${field.key}`}
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        className="h-8"
                      />
                    ) : (
                      <span className="text-sm">{renderFieldValue(record.data[field.key])}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Original message
            </p>
            {record.sourceText ? (
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground">{record.sourceSender ?? 'Unknown'}</span>
                  {record.sourceGroup ? <Badge variant="secondary">{record.sourceGroup}</Badge> : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{record.sourceText}</p>
                {record.sourceAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">{formatDateTime(record.sourceAt, timezone)}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">The source message is no longer available.</p>
            )}
          </div>
        </div>

        {canReview ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            {editing ? (
              <>
                <Button size="sm" variant="success" onClick={() => act('edit_approve')} loading={busy === 'edit_approve'}>
                  <Check className="h-3.5 w-3.5" /> Save &amp; approve
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy !== null}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="success" onClick={() => act('approve')} loading={busy === 'approve'}>
                  <Check className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <PencilLine className="h-3.5 w-3.5" /> Edit &amp; approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => act('reprocess')} loading={busy === 'reprocess'}>
                  <RefreshCw className="h-3.5 w-3.5" /> Reprocess
                </Button>
                <Button size="sm" variant="ghost" onClick={() => act('reject')} loading={busy === 'reject'}>
                  <X className="h-3.5 w-3.5 text-destructive" /> Reject
                </Button>
              </>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
