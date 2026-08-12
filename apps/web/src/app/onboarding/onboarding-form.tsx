'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'];

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [saving, setSaving] = useState(false);

  async function create() {
    if (name.trim().length < 2) {
      toast.error('Enter a workspace name');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/tenant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, timezone }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not create the workspace.');

      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      toast.error('Could not create workspace', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
      setSaving(false);
    }
  }

  return (
    <div className="mt-7 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="workspace-name">Workspace name</Label>
        <Input
          id="workspace-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Trading Co."
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="workspace-tz">Timezone</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger id="workspace-tz">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={create} loading={saving} className="w-full">
        Create workspace
      </Button>
    </div>
  );
}
