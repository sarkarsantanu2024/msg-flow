'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { History, MoreVertical, Pause, Play, RotateCcw, Trash2 } from '@/components/icon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function OutputActions({
  outputId,
  status,
  name,
  restoreVersion,
  retryOnly = false,
}: {
  outputId: string;
  status: string;
  name: string;
  restoreVersion?: number;
  retryOnly?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(next: 'ACTIVE' | 'PAUSED') {
    setBusy('status');
    try {
      const response = await fetch(`/api/outputs/${outputId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) throw new Error((await response.json())?.error?.message ?? 'Update failed.');
      toast.success(next === 'PAUSED' ? 'Output paused' : 'Output resumed', {
        description: next === 'PAUSED' ? 'Syncs will skip this output until it is resumed.' : undefined,
      });
      router.refresh();
    } catch (err) {
      toast.error('Could not update output', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setBusy(null);
    }
  }

  async function restore(version: number) {
    if (!confirm(`Restore version ${version}? The current file is snapshotted first, so this is reversible.`)) return;
    setBusy('restore');
    try {
      const response = await fetch(`/api/outputs/${outputId}/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Restore failed.');
      toast.success(`Restored version ${version}`, {
        description: `Saved as version ${body.data.newVersion}. Row matching will be rebuilt on the next sync.`,
      });
      router.refresh();
    } catch (err) {
      toast.error('Could not restore version', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setBusy(null);
    }
  }

  async function retryFailed() {
    setBusy('retry');
    try {
      const response = await fetch(`/api/outputs/${outputId}/retry`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Retry failed.');
      toast.success('Retried failed rows', {
        description: `${body.data.created} created · ${body.data.updated} updated · ${body.data.failed} still failing`,
      });
      router.refresh();
    } catch (err) {
      toast.error('Retry failed', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete "${name}"? MsgFlow stops maintaining it and its stored versions are removed. Your own copy of the file is untouched.`,
      )
    ) {
      return;
    }
    setBusy('delete');
    try {
      const response = await fetch(`/api/outputs/${outputId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed.');
      toast.success('Output deleted');
      router.push('/dashboard/outputs');
    } catch (err) {
      toast.error('Could not delete', { description: err instanceof Error ? err.message : 'Unknown error' });
      setBusy(null);
    }
  }

  if (restoreVersion !== undefined) {
    return (
      <Button size="sm" variant="ghost" onClick={() => restore(restoreVersion)} loading={busy === 'restore'}>
        <RotateCcw className="h-3.5 w-3.5" />
        <span className="sr-only">Restore v{restoreVersion}</span>
      </Button>
    );
  }

  if (retryOnly) {
    return (
      <Button size="sm" variant="outline" onClick={retryFailed} loading={busy === 'retry'}>
        <History className="h-3.5 w-3.5" /> Retry failed rows
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Output actions" disabled={busy !== null}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {status === 'PAUSED' ? (
          <DropdownMenuItem onSelect={() => setStatus('ACTIVE')}>
            <Play className="h-4 w-4" /> Resume
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setStatus('PAUSED')}>
            <Pause className="h-4 w-4" /> Pause
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={retryFailed}>
          <History className="h-4 w-4" /> Retry failed rows
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={remove}>
          <Trash2 className="h-4 w-4" /> Delete output
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
