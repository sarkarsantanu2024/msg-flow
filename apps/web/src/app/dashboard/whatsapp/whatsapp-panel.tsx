'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { toast } from 'sonner';
import { LogOut, Plug, PlugZap, QrCode, RefreshCw, Unplug, Users } from '@/components/icon';
import type { WhatsAppStatusSummary } from '@msgflow/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { EmptyState } from '@/components/ui/states';
import { formatDateTime, formatDuration, formatNumber, formatRelativeTime, humanize } from '@/lib/format';

interface WorkerInfo {
  name: string;
  hostname: string;
  status: string;
  version: string | null;
  lastHeartbeatAt: string | null;
  memoryMb: number | null;
  uptimeSec: number | null;
}

interface ConnectionEventInfo {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  message: string | null;
  occurredAt: string;
}

/**
 * WhatsApp connection control.
 *
 * Polls every few seconds while connecting so the QR appears without the user
 * refreshing, and slows down once the state is settled. Every button here calls
 * the worker for real.
 */
export function WhatsAppPanel({
  initialSummary,
  connectionId,
  provider,
  canManage,
  events,
  worker,
  timezone,
}: {
  initialSummary: WhatsAppStatusSummary;
  connectionId: string | null;
  provider: string;
  canManage: boolean;
  events: ConnectionEventInfo[];
  worker: WorkerInfo | null;
  timezone: string;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(initialSummary);
  const [busy, setBusy] = useState<string | null>(null);

  const transitional = ['CONNECTING', 'RECONNECTING', 'QR_REQUIRED', 'AUTHENTICATED'].includes(summary.status);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/whatsapp', { cache: 'no-store' });
      const body = (await response.json()) as { ok: boolean; data: WhatsAppStatusSummary };
      if (body.ok) setSummary(body.data);
    } catch {
      // A failed poll is not worth a toast; the status bar reports staleness.
    }
  }, []);

  useEffect(() => {
    const interval = transitional ? 3_000 : 15_000;
    const timer = setInterval(refresh, interval);
    return () => clearInterval(timer);
  }, [refresh, transitional]);

  async function act(action: string, label: string) {
    setBusy(action);
    try {
      let targetId = connectionId;

      // Creating the connection row is part of "Connect" — the user should not
      // have to perform a separate setup step first.
      if (!targetId) {
        const createResponse = await fetch('/api/whatsapp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Primary WhatsApp', provider: 'WHATSAPP_WEB' }),
        });
        const createBody = await createResponse.json();
        if (!createResponse.ok) throw new Error(createBody?.error?.message ?? 'Could not create the connection.');
        targetId = createBody.data.connectionId as string;
      }

      const response = await fetch(`/api/whatsapp/${targetId}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? `${label} failed.`);

      toast.success(`${label} requested`, {
        description:
          action === 'connect' || action === 'reconnect'
            ? 'Scan the QR code when it appears below.'
            : undefined,
      });
      await refresh();
      router.refresh();
    } catch (err) {
      toast.error(`${label} failed`, {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setBusy(null);
    }
  }

  const connected = summary.status === 'READY';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div
              className={
                connected
                  ? 'rounded-lg bg-success/10 p-3'
                  : summary.status === 'QR_REQUIRED'
                    ? 'rounded-lg bg-warning/10 p-3'
                    : 'rounded-lg bg-destructive/10 p-3'
              }
            >
              {connected ? (
                <PlugZap className="h-6 w-6 text-success" />
              ) : summary.status === 'QR_REQUIRED' ? (
                <QrCode className="h-6 w-6 text-warning" />
              ) : (
                <Unplug className="h-6 w-6 text-destructive" />
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{summary.name}</CardTitle>
                <StatusBadge status={summary.status} />
              </div>
              <CardDescription className="mt-1">
                {connected
                  ? `Connected and listening${summary.phoneNumber ? ` as ${summary.phoneNumber}` : ''}.`
                  : summary.status === 'QR_REQUIRED'
                    ? 'Scan the QR code below with WhatsApp on your phone.'
                    : summary.status === 'CONNECTING' || summary.status === 'RECONNECTING'
                      ? 'Starting the WhatsApp session…'
                      : 'Not connected. Automation processing is waiting for a connection.'}
              </CardDescription>
              {summary.lastError ? (
                <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                  {summary.lastError}
                </p>
              ) : null}
            </div>
          </div>

          {canManage ? (
            <div className="flex flex-wrap gap-2">
              {!connected ? (
                <Button onClick={() => act('connect', 'Connect')} loading={busy === 'connect'}>
                  <Plug className="h-4 w-4" /> Connect
                </Button>
              ) : null}
              {connectionId ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => act('reconnect', 'Reconnect')}
                    loading={busy === 'reconnect'}
                  >
                    <RefreshCw className="h-4 w-4" /> Reconnect
                  </Button>
                  {summary.status === 'QR_REQUIRED' ? (
                    <Button
                      variant="outline"
                      onClick={() => act('refresh-qr', 'Refresh QR')}
                      loading={busy === 'refresh-qr'}
                    >
                      <QrCode className="h-4 w-4" /> Refresh QR
                    </Button>
                  ) : null}
                  {connected ? (
                    <Button
                      variant="outline"
                      onClick={() => act('sync-groups', 'Group sync')}
                      loading={busy === 'sync-groups'}
                    >
                      <Users className="h-4 w-4" /> Sync groups
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() => act('disconnect', 'Disconnect')}
                    loading={busy === 'disconnect'}
                  >
                    <Unplug className="h-4 w-4" /> Disconnect
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (
                        confirm(
                          'Logging out destroys the stored WhatsApp session. You will need to scan a new QR code to reconnect. Continue?',
                        )
                      ) {
                        act('logout', 'Logout');
                      }
                    }}
                    loading={busy === 'logout'}
                  >
                    <LogOut className="h-4 w-4" /> Logout
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </CardHeader>

        <CardContent>
          <dl className="grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Provider', humanize(provider)],
              ['Phone number', summary.phoneNumber ?? 'Not available'],
              ['Connected since', summary.connectedAt ? formatDateTime(summary.connectedAt, timezone) : '—'],
              ['Last heartbeat', formatRelativeTime(summary.lastHeartbeatAt)],
              ['Last message', formatRelativeTime(summary.lastMessageAt)],
              ['Groups monitored', formatNumber(summary.groupsMonitored)],
              ['Messages today', formatNumber(summary.messagesToday)],
              ['Worker', summary.workerName ? `${summary.workerName} · ${humanize(summary.workerStatus)}` : 'Offline'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 truncate text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {summary.qrCode ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan to connect</CardTitle>
            <CardDescription>
              WhatsApp → Settings → Linked devices → Link a device. The code refreshes automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-8">
            <div className="rounded-lg border bg-white p-4">
              {/* The worker renders the QR to a data URL, so no external request is made. */}
              <Image
                src={summary.qrCode}
                alt="WhatsApp QR code"
                width={264}
                height={264}
                unoptimized
                className="h-[264px] w-[264px]"
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Worker</CardTitle>
            <CardDescription>
              The persistent Node service that runs WhatsApp Web. It must be running for messages to arrive.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {worker ? (
              <dl className="grid gap-3 sm:grid-cols-2">
                {[
                  ['Name', worker.name],
                  ['Host', worker.hostname],
                  ['Status', humanize(worker.status)],
                  ['Version', worker.version ?? '—'],
                  ['Last heartbeat', formatRelativeTime(worker.lastHeartbeatAt)],
                  ['Memory', worker.memoryMb ? `${Math.round(worker.memoryMb)} MB` : '—'],
                  ['Uptime', worker.uptimeSec ? formatDuration(worker.uptimeSec * 1000) : '—'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 text-sm">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <EmptyState
                title="No worker has registered"
                description="Start it locally with `pnpm worker:dev`, or deploy it to Railway, Render, Fly.io or any Docker host. The web app cannot run WhatsApp Web itself."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connection history</CardTitle>
            <CardDescription>Every state change is recorded — nothing happens silently.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {events.length === 0 ? (
              <EmptyState title="No events yet" description="Connection changes will appear here." />
            ) : (
              <ul className="max-h-80 divide-y overflow-y-auto scrollbar-thin">
                {events.map((event) => (
                  <li key={event.id} className="flex items-start gap-3 px-5 py-2.5">
                    <StatusBadge status={event.toStatus ?? event.eventType} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        {event.fromStatus ? `${humanize(event.fromStatus)} → ` : ''}
                        {humanize(event.toStatus ?? event.eventType)}
                      </p>
                      {event.message ? (
                        <p className="truncate text-xs text-muted-foreground">{event.message}</p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(event.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {summary.groupsMonitored === 0 && connected ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No groups are being monitored yet"
            description="Messages only enter the pipeline from groups you explicitly monitor."
            action={
              <Button asChild>
                <Link href="/dashboard/groups">Choose groups</Link>
              </Button>
            }
          />
        </Card>
      ) : null}
    </div>
  );
}
