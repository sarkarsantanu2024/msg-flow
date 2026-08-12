'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pause, Play, PlayCircle } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';

export function AutomationControls({
  automationId,
  status,
  hasOutputs,
  hasGroups,
}: {
  automationId: string;
  status: string;
  hasOutputs: boolean;
  hasGroups: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function statusAction(action: 'activate' | 'pause' | 'resume') {
    setBusy(action);
    try {
      const response = await fetch(`/api/automations/${automationId}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Action failed.');
      toast.success(
        action === 'activate' ? 'Automation activated' : action === 'pause' ? 'Paused' : 'Resumed',
        {
          description:
            action === 'pause'
              ? 'Messages keep being captured; processing is paused and the backlog will be picked up on resume.'
              : undefined,
        },
      );
      router.refresh();
    } catch (err) {
      toast.error('Could not change status', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    setBusy('run');
    try {
      const response = await fetch(`/api/automations/${automationId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trigger: 'MANUAL' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Run failed.');

      const r = body.data;
      toast.success(`Run ${String(r.status).toLowerCase().replace('_', ' ')}`, {
        description: `${r.messagesScanned} scanned · ${r.messagesProcessed} processed · ${r.recordsCreated} created · ${r.recordsUpdated} updated${r.recordsFailed ? ` · ${r.recordsFailed} failed` : ''}`,
      });
      router.refresh();
    } catch (err) {
      toast.error('Run failed', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  }

  const blocked = !hasOutputs || !hasGroups;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={status} />

      <Button variant="outline" onClick={runNow} loading={busy === 'run'}>
        <PlayCircle className="h-4 w-4" /> Run now
      </Button>

      {status === 'ACTIVE' ? (
        <Button variant="outline" onClick={() => statusAction('pause')} loading={busy === 'pause'}>
          <Pause className="h-4 w-4" /> Pause
        </Button>
      ) : status === 'PAUSED' ? (
        <Button onClick={() => statusAction('resume')} loading={busy === 'resume'}>
          <Play className="h-4 w-4" /> Resume
        </Button>
      ) : (
        <Button
          onClick={() => statusAction('activate')}
          loading={busy === 'activate'}
          disabled={blocked}
          title={
            blocked
              ? !hasGroups
                ? 'Select at least one source group first'
                : 'Connect an output first'
              : undefined
          }
        >
          <Play className="h-4 w-4" /> Activate
        </Button>
      )}
    </div>
  );
}
