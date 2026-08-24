'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/misc';
import { Label } from '@/components/ui/label';

/**
 * Show or hide demo data across the workspace.
 *
 * The switch writes to the workspace, not to the browser, so what a client sees
 * on a shared screen matches what the person driving the demo sees, and the
 * state survives a reload mid-presentation.
 */
export function DemoToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [pending, startTransition] = useTransition();

  async function toggle(next: boolean) {
    // Move the switch immediately; put it back if the write fails.
    setChecked(next);
    try {
      const response = await fetch('/api/tenant/demo-mode', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ demoMode: next }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Could not change the setting.');
      }
      startTransition(() => router.refresh());
      toast.success(next ? 'Demo data is now visible' : 'Demo data is hidden');
    } catch (err) {
      setChecked(!next);
      toast.error(err instanceof Error ? err.message : 'Could not change the setting.');
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
      <Switch id="demo-mode" checked={checked} disabled={pending} onCheckedChange={toggle} />
      <Label htmlFor="demo-mode" className="cursor-pointer whitespace-nowrap text-xs font-medium">
        Demo data
      </Label>
    </div>
  );
}
