'use client';

import { useState } from 'react';
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
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Field {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
}

export function IntegrationsPanel({
  type,
  name,
  credentialType,
  fields,
}: {
  type: string;
  name: string;
  credentialType: string;
  fields: Field[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState(name);
  const [values, setValues] = useState<Record<string, string>>({});

  async function save() {
    setSaving(true);
    try {
      const credentials = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));

      const response = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type,
          name: displayName,
          config: {},
          credentialType,
          credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not save the integration.');

      toast.success(`${displayName} connected`, {
        description:
          Object.keys(credentials).length === 0
            ? 'Saved without credentials — it will run in mock mode until you add them.'
            : 'Credentials are encrypted at rest and never displayed again.',
      });
      setValues({});
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error('Could not save integration', {
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
          <Plug className="h-3.5 w-3.5" /> Configure
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {name}</DialogTitle>
          <DialogDescription>
            Credentials are encrypted with AES-256-GCM before storage and are never returned by the API.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="integration-name">Display name</Label>
            <Input
              id="integration-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          {fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
              {field.type === 'textarea' ? (
                <Textarea
                  id={`field-${field.key}`}
                  rows={4}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  className="font-mono text-xs"
                />
              ) : (
                <Input
                  id={`field-${field.key}`}
                  type={field.type}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              )}
            </div>
          ))}

          {fields.length === 0 ? (
            <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              This connector needs no stored credentials — the destination URL is set on each output.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save integration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
