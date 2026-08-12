'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MessageSquare, Search } from '@/components/icon';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { formatNumber, formatRelativeTime, truncate } from '@/lib/format';

interface GroupRow {
  id: string;
  name: string;
  externalId: string;
  participantCount: number;
  isMonitored: boolean;
  messageCount: number;
  lastMessageAt: string | null;
  automations: Array<{ id: string; name: string; status: string }>;
}

export function GroupsTable({
  groups,
  canManage,
}: {
  groups: GroupRow[];
  canManage: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [local, setLocal] = useState(groups);

  const filtered = local.filter(
    (g) =>
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      g.externalId.toLowerCase().includes(search.toLowerCase()),
  );

  async function toggle(group: GroupRow, next: boolean) {
    setPending(group.id);
    // Optimistic: the switch should respond instantly, then reconcile.
    setLocal((rows) => rows.map((r) => (r.id === group.id ? { ...r, isMonitored: next } : r)));

    try {
      const response = await fetch(`/api/groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isMonitored: next }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Update failed.');

      toast.success(next ? `Monitoring "${group.name}"` : `Stopped monitoring "${group.name}"`, {
        description: next
          ? 'New messages from this group will now be captured and processed.'
          : 'Existing messages are kept; no new ones will be captured.',
      });
      router.refresh();
    } catch (err) {
      setLocal((rows) => rows.map((r) => (r.id === group.id ? { ...r, isMonitored: !next } : r)));
      toast.error('Could not update monitoring', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b p-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search groups…"
              className="pl-8"
              aria-label="Search groups"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {local.length}
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="No groups match that search" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead className="hidden md:table-cell">Members</TableHead>
                <TableHead className="hidden lg:table-cell">Automations</TableHead>
                <TableHead className="text-right">Messages</TableHead>
                <TableHead className="hidden sm:table-cell">Last message</TableHead>
                <TableHead className="text-right">Monitoring</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((group) => (
                <TableRow key={group.id}>
                  <TableCell>
                    <div className="font-medium">{truncate(group.name, 42)}</div>
                    <div className="text-xs text-muted-foreground">{truncate(group.externalId, 32)}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {group.participantCount || '—'}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {group.automations.length === 0 ? (
                      <span className="text-xs text-muted-foreground">None</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {group.automations.slice(0, 2).map((a) => (
                          <Link key={a.id} href={`/dashboard/automations/${a.id}`}>
                            <Badge variant="secondary" className="hover:bg-secondary/70">
                              {truncate(a.name, 18)}
                            </Badge>
                          </Link>
                        ))}
                        {group.automations.length > 2 ? (
                          <Badge variant="muted">+{group.automations.length - 2}</Badge>
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular">{formatNumber(group.messageCount)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                    {formatRelativeTime(group.lastMessageAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={group.isMonitored}
                      onCheckedChange={(next) => toggle(group, next)}
                      disabled={!canManage || pending === group.id}
                      aria-label={`Monitor ${group.name}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/dashboard/messages?groupId=${group.id}`}>
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span className="sr-only">View messages</span>
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
