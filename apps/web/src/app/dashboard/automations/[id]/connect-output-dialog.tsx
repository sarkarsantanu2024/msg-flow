'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plug } from '@/components/icon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MappingEditor, type MappingDraft } from '@/components/dashboard/mapping-editor';
import { humanize } from '@/lib/format';

const OPERATIONS_BY_TYPE: Record<string, string[]> = {
  EXCEL: ['UPSERT', 'APPEND', 'UPDATE_EXISTING', 'CREATE_NEW', 'REPLACE', 'GENERATE_NEW_VERSION'],
  CSV: ['UPSERT', 'APPEND', 'UPDATE_EXISTING', 'CREATE_NEW', 'REPLACE', 'GENERATE_NEW_VERSION'],
  GOOGLE_SHEETS: ['UPSERT', 'APPEND', 'UPDATE_EXISTING', 'CREATE_NEW', 'REPLACE'],
  REST_API: ['UPSERT', 'APPEND', 'UPDATE_EXISTING', 'CREATE_NEW'],
  CLIENT_WEBSITE: ['UPSERT', 'APPEND', 'UPDATE_EXISTING', 'CREATE_NEW'],
  CLIENT_ADMIN: ['UPSERT', 'APPEND', 'UPDATE_EXISTING', 'CREATE_NEW'],
  WEBHOOK: ['APPEND', 'CREATE_NEW'],
  PDF: ['CREATE_NEW', 'GENERATE_NEW_VERSION', 'REPLACE'],
  POWERPOINT: ['CREATE_NEW', 'GENERATE_NEW_VERSION', 'REPLACE'],
};

export function ConnectOutputDialog({
  automationId,
  sourceFields,
  outputs,
  existing,
}: {
  automationId: string;
  sourceFields: Array<{ key: string; label: string; type: string }>;
  outputs: Array<{ id: string; name: string; type: string; columns: string[] }>;
  existing: Array<{ outputId: string; operation: string; mappings: MappingDraft[] }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outputId, setOutputId] = useState('');
  const [operation, setOperation] = useState('UPSERT');
  const [mappings, setMappings] = useState<MappingDraft[]>([]);

  const output = outputs.find((o) => o.id === outputId);
  const operations = output ? (OPERATIONS_BY_TYPE[output.type] ?? ['CREATE_NEW']) : [];

  function selectOutput(id: string) {
    setOutputId(id);
    const previous = existing.find((e) => e.outputId === id);
    const target = outputs.find((o) => o.id === id);

    if (previous) {
      setOperation(previous.operation);
      setMappings(previous.mappings);
      return;
    }

    const allowed = target ? (OPERATIONS_BY_TYPE[target.type] ?? ['CREATE_NEW']) : ['CREATE_NEW'];
    setOperation(allowed[0]);

    // Pre-map by name similarity — the columns usually already correspond, and
    // starting from a sensible guess beats an empty grid.
    const columns = target?.columns ?? [];
    setMappings(
      sourceFields
        .map((field, index) => {
          const match = columns.find(
            (c) =>
              c.toLowerCase() === field.key.toLowerCase() ||
              c.toLowerCase() === field.label.toLowerCase() ||
              c.toLowerCase().replace(/\s/g, '') === field.key.toLowerCase(),
          );
          return {
            sourceField: field.key,
            targetField: match ?? field.label,
            updateStrategy: 'ALWAYS_UPDATE',
            isKeyPart: index === 0,
            keyOrder: index === 0 ? 0 : null,
          };
        })
        .filter((m) => m.targetField),
    );
  }

  async function save() {
    const mapped = mappings.filter((m) => m.targetField);
    if (!outputId) {
      toast.error('Choose an output');
      return;
    }
    if (mapped.length === 0) {
      toast.error('Map at least one field');
      return;
    }
    if (['UPDATE_EXISTING', 'UPSERT'].includes(operation) && !mapped.some((m) => m.isKeyPart)) {
      toast.error('A unique key is required', {
        description: `${humanize(operation)} needs at least one field marked as part of the unique key.`,
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/output-targets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          automationId,
          outputId,
          operation,
          enabled: true,
          order: 0,
          config: {},
          mappings: mapped.map((m, index) => ({
            sourceField: m.sourceField,
            targetField: m.targetField,
            updateStrategy: m.updateStrategy,
            transform: {},
            isKeyPart: m.isKeyPart,
            keyOrder: m.isKeyPart ? (m.keyOrder ?? index) : null,
            order: index,
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not connect the output.');

      toast.success('Output connected', {
        description: `${humanize(operation)} into ${output?.name}.`,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error('Could not connect output', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plug className="h-3.5 w-3.5" /> Connect output
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Connect an output</DialogTitle>
          <DialogDescription>
            Choose the destination, decide whether rows are created or updated, and map each extracted field to a
            column.
          </DialogDescription>
        </DialogHeader>

        {outputs.length === 0 ? (
          <div className="rounded-md border bg-muted/40 p-4 text-sm">
            <p>You have no outputs yet.</p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/dashboard/outputs/new">Create an output</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Output</Label>
                <Select value={outputId} onValueChange={selectOutput}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an output" />
                  </SelectTrigger>
                  <SelectContent>
                    {outputs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name} · {humanize(o.type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Operation</Label>
                <Select value={operation} onValueChange={setOperation} disabled={!outputId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {operations.map((op) => (
                      <SelectItem key={op} value={op}>
                        {humanize(op)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {operation === 'UPSERT'
                    ? 'Update the matching row, or insert it if there is none.'
                    : operation === 'UPDATE_EXISTING'
                      ? 'Only update rows that already exist — never insert.'
                      : operation === 'APPEND'
                        ? 'Always add a new row.'
                        : operation === 'REPLACE'
                          ? 'Clear the existing data rows and rewrite them.'
                          : operation === 'GENERATE_NEW_VERSION'
                            ? 'Keep the previous file and write a new version.'
                            : 'Create a brand new file each run.'}
                </p>
              </div>
            </div>

            {outputId ? (
              <div className="max-h-[50vh] overflow-y-auto pr-1 scrollbar-thin">
                <MappingEditor
                  sourceFields={sourceFields}
                  targetColumns={output?.columns ?? []}
                  value={mappings}
                  onChange={setMappings}
                  operation={operation}
                />
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!outputId}>
            Save connection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
