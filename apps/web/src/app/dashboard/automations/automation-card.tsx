'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Clock, Copy, MoreVertical, Pause, Play, PlayCircle, Trash2, Users } from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatNumber, humanize, truncate } from '@/lib/format';

interface AutomationInfo {
  id: string;
  name: string;
  description: string | null;
  status: string;
  schemaName: string;
  fieldCount: number;
  schedule: string;
  groups: string[];
  outputs: Array<{ id: string; name: string; type: string; operation: string; status: string }>;
  recordCount: number;
  runCount: number;
  lastRunStatus: string | null;
  lastRunLabel: string;
  nextRunLabel: string | null;
}

export function AutomationCard({
  automation,
  canManage,
}: {
  automation: AutomationInfo;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function statusAction(action: 'activate' | 'pause' | 'resume' | 'archive' | 'duplicate') {
    setBusy(action);
    try {
      const response = await fetch(`/api/automations/${automation.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Action failed.');

      const messages: Record<string, string> = {
        activate: 'Automation activated',
        pause: 'Automation paused',
        resume: 'Automation resumed',
        archive: 'Automation archived',
        duplicate: 'Automation duplicated',
      };
      toast.success(messages[action], {
        description:
          action === 'pause'
            ? 'Messages keep being captured; only processing stops.'
            : action === 'activate'
              ? 'It will now process messages according to its schedule.'
              : undefined,
      });

      if (action === 'duplicate' && body.data?.id) {
        router.push(`/dashboard/automations/${body.data.id}`);
        return;
      }
      router.refresh();
    } catch (err) {
      toast.error('Action failed', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    setBusy('run');
    toast.info('Running automation…', { description: 'Processing messages and updating outputs.' });
    try {
      const response = await fetch(`/api/automations/${automation.id}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trigger: 'MANUAL' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Run failed.');

      const r = body.data;
      toast.success(`Run ${String(r.status).toLowerCase().replace('_', ' ')}`, {
        description: `${r.messagesProcessed} message(s) processed · ${r.recordsCreated} created · ${r.recordsUpdated} updated${r.recordsFailed ? ` · ${r.recordsFailed} failed` : ''}`,
      });
      router.refresh();
    } catch (err) {
      toast.error('Run failed', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/dashboard/automations/${automation.id}`} className="font-medium hover:underline">
                {automation.name}
              </Link>
              <StatusBadge status={automation.status} />
              {automation.lastRunStatus === 'FAILED' ? <StatusBadge status="FAILED" label="Last run failed" /> : null}
            </div>
            {automation.description ? (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{automation.description}</p>
            ) : null}
          </div>

          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0" aria-label="Automation actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/automations/${automation.id}`}>Open</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={runNow}>
                  <PlayCircle className="h-4 w-4" /> Run now
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {automation.status === 'ACTIVE' ? (
                  <DropdownMenuItem onSelect={() => statusAction('pause')}>
                    <Pause className="h-4 w-4" /> Pause
                  </DropdownMenuItem>
                ) : automation.status === 'PAUSED' ? (
                  <DropdownMenuItem onSelect={() => statusAction('resume')}>
                    <Play className="h-4 w-4" /> Resume
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => statusAction('activate')}>
                    <Play className="h-4 w-4" /> Activate
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => statusAction('duplicate')}>
                  <Copy className="h-4 w-4" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  onSelect={() => {
                    if (confirm(`Archive "${automation.name}"? Its records and history are kept.`)) {
                      statusAction('archive');
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> {automation.schedule}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {automation.groups.length === 0
              ? 'No groups'
              : truncate(automation.groups.join(', '), 40)}
          </span>
          <span>
            {automation.schemaName} · {automation.fieldCount} fields
          </span>
        </div>

        {automation.outputs.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {automation.outputs.map((output) => (
              <Link key={output.id} href={`/dashboard/outputs/${output.id}`}>
                <Badge variant="secondary" className="hover:bg-secondary/70">
                  {humanize(output.operation)} → {truncate(output.name, 22)}
                </Badge>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
            No output connected yet — extracted data has nowhere to go.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span className="tabular">
            {formatNumber(automation.recordCount)} records · {formatNumber(automation.runCount)} runs
          </span>
          <span>
            Last run {automation.lastRunLabel}
            {automation.nextRunLabel ? ` · next ${automation.nextRunLabel}` : ''}
          </span>
          {canManage ? (
            <Button size="sm" variant="outline" onClick={runNow} loading={busy === 'run'} className="h-7">
              <PlayCircle className="h-3.5 w-3.5" /> Run now
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
