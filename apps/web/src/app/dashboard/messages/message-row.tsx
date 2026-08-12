'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, EyeOff, RefreshCw } from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDateTime, formatPercent, humanize } from '@/lib/format';

interface MessageInfo {
  id: string;
  text: string | null;
  senderName: string | null;
  senderPhone: string | null;
  groupName: string | null;
  timestamp: string;
  status: string;
  ingestSource: string;
  errorMessage: string | null;
  category: string | null;
  importance: string | null;
  confidence: number | null;
  reasoning: string | null;
  recordCount: number;
  recordId: string | null;
}

export function MessageRow({
  message,
  canReprocess,
  automations,
  timezone,
}: {
  message: MessageInfo;
  canReprocess: boolean;
  automations: Array<{ id: string; name: string }>;
  timezone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(action: 'reprocess' | 'ignore', automationId?: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/messages/${message.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, automationId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Action failed.');

      if (action === 'ignore') {
        toast.success('Message ignored');
      } else {
        const results = (body.data.results ?? []) as Array<{ created: number; updated: number; failed: number }>;
        const created = results.reduce((s, r) => s + r.created, 0);
        const updated = results.reduce((s, r) => s + r.updated, 0);
        const failed = results.reduce((s, r) => s + r.failed, 0);
        toast.success('Message reprocessed', {
          description: `${created} record(s) created, ${updated} updated${failed ? `, ${failed} failed` : ''}.`,
        });
      }
      router.refresh();
    } catch (err) {
      toast.error('Could not process message', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{message.senderName || 'Unknown sender'}</span>
        {message.groupName ? (
          <Badge variant="secondary" className="font-normal">
            {message.groupName}
          </Badge>
        ) : null}
        {message.ingestSource !== 'LIVE' ? <Badge variant="muted">{humanize(message.ingestSource)}</Badge> : null}
        <span className="text-xs text-muted-foreground">{formatDateTime(message.timestamp, timezone)}</span>

        <div className="ml-auto flex items-center gap-2">
          {message.category ? <StatusBadge status={message.importance ?? 'LOW'} label={humanize(message.category)} /> : null}
          <StatusBadge status={message.status} />
        </div>
      </div>

      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-foreground/90">
        {message.text || <span className="italic text-muted-foreground">No text content</span>}
      </p>

      {message.errorMessage ? (
        <p className="mt-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {message.errorMessage}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {message.confidence !== null ? <span>AI confidence {formatPercent(message.confidence)}</span> : null}
        {message.reasoning ? <span className="italic">{message.reasoning}</span> : null}
        {message.recordCount > 0 ? (
          <Link
            href={message.recordId ? `/dashboard/records/${message.recordId}` : '/dashboard/records'}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            {message.recordCount} record{message.recordCount === 1 ? '' : 's'} extracted{' '}
            <ArrowRight className="h-3 w-3" />
          </Link>
        ) : null}

        {canReprocess ? (
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 px-2" loading={busy}>
                  <RefreshCw className="h-3.5 w-3.5" /> Reprocess
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => act('reprocess')}>
                  All automations watching this group
                </DropdownMenuItem>
                {automations.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Run against one</DropdownMenuLabel>
                    {automations.map((a) => (
                      <DropdownMenuItem key={a.id} onSelect={() => act('reprocess', a.id)}>
                        {a.name}
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => act('ignore')} disabled={busy}>
              <EyeOff className="h-3.5 w-3.5" /> Ignore
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
