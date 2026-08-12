'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from '@/components/icon';
import { STATUS_POLL_INTERVAL_MS } from '@msgflow/config';
import type { SystemHealth, WhatsAppStatusSummary } from '@msgflow/types';
import { cn } from '@/lib/utils';
import { formatNumber, formatRelativeTime, humanize } from '@/lib/format';
import { StatusDot } from '@/components/status-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/misc';

/**
 * The always-visible system status bar.
 *
 * The specification is emphatic that the dashboard must never show "WhatsApp"
 * without its actual connection state — a user needs to know at a glance
 * whether the system is still listening. This polls rather than assuming, and
 * says "checking…" while it does not know, never a stale green.
 */

interface StatusPayload {
  health: SystemHealth;
  whatsapp: WhatsAppStatusSummary;
  counters: {
    groupsMonitored: number;
    messagesToday: number;
    recordsToday: number;
    errorsToday: number;
  };
}

export function SystemStatusBar({ initial }: { initial: StatusPayload }) {
  const [data, setData] = useState<StatusPayload>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch('/api/status', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { ok: boolean; data: StatusPayload };
        if (!cancelled && body.ok) {
          setData(body.data);
          setStale(false);
        }
      } catch {
        // A failed poll means we no longer know the state. Say so rather than
        // continuing to display the last known values as if they were current.
        if (!cancelled) setStale(true);
      }
    }

    const timer = setInterval(poll, STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function manualRefresh() {
    setRefreshing(true);
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      const body = (await response.json()) as { ok: boolean; data: StatusPayload };
      if (body.ok) {
        setData(body.data);
        setStale(false);
      }
    } catch {
      setStale(true);
    } finally {
      setRefreshing(false);
    }
  }

  const layerByName = Object.fromEntries(data.health.layers.map((l) => [l.layer, l]));
  const whatsappStatus = data.whatsapp.status;
  const whatsappDown = ['DISCONNECTED', 'LOGGED_OUT', 'ERROR'].includes(whatsappStatus);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2 text-xs lg:px-6',
        whatsappDown ? 'bg-destructive/5' : 'bg-muted/40',
        stale && 'opacity-60',
      )}
    >
      <Link href="/dashboard/whatsapp" className="flex items-center gap-1.5 hover:underline">
        <StatusDot status={stale ? 'UNKNOWN' : whatsappStatus} />
        <span className="font-medium">WhatsApp</span>
        <span className="text-muted-foreground">
          {stale ? 'checking…' : humanize(whatsappStatus)}
        </span>
      </Link>

      {(
        [
          ['WORKER', 'Worker'],
          ['AI', 'AI'],
          ['DATABASE', 'Database'],
          ['WORKFLOW', 'Workflow'],
          ['OUTPUT', 'Outputs'],
        ] as const
      ).map(([key, label]) => {
        const layer = layerByName[key];
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <span className="flex cursor-help items-center gap-1.5">
                <StatusDot status={stale ? 'UNKNOWN' : (layer?.state ?? 'UNKNOWN')} />
                <span className="font-medium">{label}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{layer?.message ?? 'No information available'}</TooltipContent>
          </Tooltip>
        );
      })}

      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
        <span className="tabular">
          Groups <strong className="text-foreground">{formatNumber(data.counters.groupsMonitored)}</strong>
        </span>
        <span className="tabular">
          Messages today <strong className="text-foreground">{formatNumber(data.counters.messagesToday)}</strong>
        </span>
        <span className="tabular">
          Records <strong className="text-foreground">{formatNumber(data.counters.recordsToday)}</strong>
        </span>
        <span className="tabular">
          Errors{' '}
          <strong className={data.counters.errorsToday > 0 ? 'text-destructive' : 'text-foreground'}>
            {formatNumber(data.counters.errorsToday)}
          </strong>
        </span>
        <button
          onClick={manualRefresh}
          className="flex items-center gap-1 hover:text-foreground"
          aria-label="Refresh status"
          title={`Checked ${formatRelativeTime(data.health.checkedAt)}`}
        >
          <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
        </button>
      </div>
    </div>
  );
}
