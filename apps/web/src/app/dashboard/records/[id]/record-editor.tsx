'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Pencil, RefreshCw, Trash2, X } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { renderFieldValue } from '@/lib/format';

interface FieldSpec {
  key: string;
  label: string;
  type: string;
  required: boolean;
  enumValues: string[];
}

export function RecordEditor({
  recordId,
  status,
  data,
  fields,
  canEdit,
}: {
  recordId: string;
  status: string;
  data: Record<string, unknown>;
  fields: FieldSpec[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, data[f.key] === null || data[f.key] === undefined ? '' : String(data[f.key])])),
  );

  async function save() {
    setBusy('save');
    try {
      const payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
      const response = await fetch(`/api/records/${recordId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: payload }),
      });
      const body = await response.json();
      if (!response.ok) {
        const detail = Array.isArray(body?.error?.detail)
          ? (body.error.detail as Array<{ field: string; message: string }>)
              .map((d) => `${d.field}: ${d.message}`)
              .join('; ')
          : undefined;
        throw new Error(detail ?? body?.error?.message ?? 'Could not save.');
      }
      toast.success('Record updated', {
        description: 'Connected outputs are marked stale and will be refreshed on the next sync.',
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      toast.error('Could not save record', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setBusy(null);
    }
  }

  async function review(action: 'approve' | 'reject' | 'reprocess') {
    setBusy(action);
    try {
      const response = await fetch(`/api/records/${recordId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Action failed.');
      toast.success(
        action === 'approve' ? 'Record approved' : action === 'reject' ? 'Record rejected' : 'Record reprocessed',
      );
      router.refresh();
    } catch (err) {
      toast.error('Action failed', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm('Delete this record? Rows already written to an output are not removed.')) return;
    setBusy('delete');
    try {
      const response = await fetch(`/api/records/${recordId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed.');
      toast.success('Record deleted');
      router.push('/dashboard/records');
    } catch (err) {
      toast.error('Could not delete', { description: err instanceof Error ? err.message : 'Unknown error' });
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Record data</CardTitle>
          <CardDescription>The structured values extracted from your messages</CardDescription>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button size="sm" onClick={save} loading={busy === 'save'}>
                  <Check className="h-3.5 w-3.5" /> Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy !== null}>
                  <X className="h-3.5 w-3.5" /> Cancel
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                {status === 'NEEDS_REVIEW' ? (
                  <Button size="sm" variant="success" onClick={() => review('approve')} loading={busy === 'approve'}>
                    <Check className="h-3.5 w-3.5" /> Approve
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => review('reprocess')} loading={busy === 'reprocess'}>
                  <RefreshCw className="h-3.5 w-3.5" /> Reprocess
                </Button>
                <Button size="sm" variant="ghost" onClick={remove} loading={busy === 'delete'}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  <span className="sr-only">Delete</span>
                </Button>
              </>
            )}
          </div>
        ) : null}
      </CardHeader>

      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key}>
              <dt>
                <Label htmlFor={`field-${field.key}`} className="text-xs uppercase tracking-wide text-muted-foreground">
                  {field.label}
                  {field.required ? <span className="ml-1 text-destructive">*</span> : null}
                </Label>
              </dt>
              <dd className="mt-1">
                {editing ? (
                  field.type === 'ENUM' && field.enumValues.length > 0 ? (
                    <Select
                      value={values[field.key] || ''}
                      onValueChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                    >
                      <SelectTrigger id={`field-${field.key}`}>
                        <SelectValue placeholder="Not set" />
                      </SelectTrigger>
                      <SelectContent>
                        {field.enumValues.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`field-${field.key}`}
                      type={
                        ['NUMBER', 'INTEGER', 'DECIMAL', 'CURRENCY'].includes(field.type)
                          ? 'number'
                          : field.type === 'DATE'
                            ? 'date'
                            : 'text'
                      }
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  )
                ) : (
                  <span className="text-sm">{renderFieldValue(data[field.key])}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
