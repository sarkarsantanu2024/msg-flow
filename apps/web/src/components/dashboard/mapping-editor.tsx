'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, KeyRound } from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { humanize } from '@/lib/format';

export interface MappingDraft {
  sourceField: string;
  targetField: string;
  updateStrategy: string;
  isKeyPart: boolean;
  keyOrder: number | null;
}

const NONE = '__none__';

const UPDATE_STRATEGIES = [
  { value: 'ALWAYS_UPDATE', label: 'Always update', hint: 'Overwrite with the newest extracted value' },
  { value: 'UPDATE_IF_EMPTY', label: 'Only if empty', hint: 'Never overwrite a value that already exists' },
  { value: 'NEVER_UPDATE', label: 'Never update', hint: 'Write once on insert, then leave alone' },
  { value: 'UPDATE_IF_NEWER', label: 'Only if newer', hint: 'Update when the message is newer than the row' },
];

/**
 * Field mapping UI.
 *
 * Extracted fields on the left, destination columns on the right — the shape the
 * specification asks for. The unique-key question is asked in plain words,
 * because a mapping without a key silently turns every UPSERT into an append.
 */
export function MappingEditor({
  sourceFields,
  targetColumns,
  value,
  onChange,
  operation,
}: {
  sourceFields: Array<{ key: string; label: string; type: string }>;
  targetColumns: string[];
  value: MappingDraft[];
  onChange: (next: MappingDraft[]) => void;
  operation: string;
}) {
  const [customColumn, setCustomColumn] = useState('');

  const mappingBySource = useMemo(
    () => new Map(value.map((m) => [m.sourceField, m])),
    [value],
  );

  const needsKey = ['UPDATE_EXISTING', 'UPSERT'].includes(operation);
  const keyParts = value.filter((m) => m.isKeyPart).sort((a, b) => (a.keyOrder ?? 0) - (b.keyOrder ?? 0));

  function update(sourceField: string, patch: Partial<MappingDraft>) {
    const existing = mappingBySource.get(sourceField);
    if (!existing) {
      onChange([
        ...value,
        {
          sourceField,
          targetField: '',
          updateStrategy: 'ALWAYS_UPDATE',
          isKeyPart: false,
          keyOrder: null,
          ...patch,
        },
      ]);
      return;
    }
    onChange(value.map((m) => (m.sourceField === sourceField ? { ...m, ...patch } : m)));
  }

  function remove(sourceField: string) {
    onChange(value.filter((m) => m.sourceField !== sourceField));
  }

  const availableColumns = [...new Set([...targetColumns, ...value.map((m) => m.targetField)])].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Extracted data</span>
        <span />
        <span>Destination column</span>
      </div>

      <div className="space-y-2">
        {sourceFields.map((field) => {
          const mapping = mappingBySource.get(field.key);
          return (
            <div key={field.key} className="rounded-md border p-3">
              <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{field.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {field.key} · {humanize(field.type)}
                  </p>
                </div>

                <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />

                <div className="flex items-center gap-2">
                  <Select
                    value={mapping?.targetField || NONE}
                    onValueChange={(v) => (v === NONE ? remove(field.key) : update(field.key, { targetField: v }))}
                  >
                    <SelectTrigger aria-label={`Destination for ${field.label}`}>
                      <SelectValue placeholder="Not mapped" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not mapped</SelectItem>
                      {availableColumns.map((column) => (
                        <SelectItem key={column} value={column}>
                          {column}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {mapping?.targetField ? (
                <div className="mt-3 flex flex-wrap items-center gap-4 border-t pt-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">When it changes</Label>
                    <Select
                      value={mapping.updateStrategy}
                      onValueChange={(v) => update(field.key, { updateStrategy: v })}
                    >
                      <SelectTrigger className="h-8 w-auto min-w-[10rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UPDATE_STRATEGIES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox
                      checked={mapping.isKeyPart}
                      onCheckedChange={(checked) =>
                        update(field.key, {
                          isKeyPart: Boolean(checked),
                          keyOrder: checked ? keyParts.length : null,
                        })
                      }
                    />
                    <KeyRound className="h-3.5 w-3.5" />
                    Part of the unique key
                  </label>

                  <span className="text-xs text-muted-foreground">
                    {UPDATE_STRATEGIES.find((s) => s.value === mapping.updateStrategy)?.hint}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="custom-column" className="text-xs">
            Destination column not listed?
          </Label>
          <Input
            id="custom-column"
            value={customColumn}
            onChange={(e) => setCustomColumn(e.target.value)}
            placeholder="Add a column name"
            className="h-8"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!customColumn.trim()}
          onClick={() => {
            const name = customColumn.trim();
            const firstUnmapped = sourceFields.find((f) => !mappingBySource.get(f.key)?.targetField);
            if (firstUnmapped) update(firstUnmapped.key, { targetField: name });
            setCustomColumn('');
          }}
        >
          Add column
        </Button>
      </div>

      <div
        className={
          needsKey && keyParts.length === 0
            ? 'rounded-md border border-destructive/30 bg-destructive/10 p-3'
            : 'rounded-md border bg-muted/40 p-3'
        }
      >
        <p className="text-sm font-medium">How should we find an existing record?</p>
        {keyParts.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {needsKey
              ? `${humanize(operation)} needs a unique key. Without one we cannot tell an update from a new row, and every message would append a duplicate.`
              : 'No unique key set. Rows will always be appended.'}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {keyParts.map((part, index) => (
              <span key={part.sourceField} className="flex items-center gap-1.5">
                {index > 0 ? <span className="text-muted-foreground">+</span> : null}
                <Badge variant="default">{part.targetField}</Badge>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
