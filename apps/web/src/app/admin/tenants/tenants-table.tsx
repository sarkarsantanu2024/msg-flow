'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Search } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { formatDate, formatNumber } from '@/lib/format';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  plan: string | null;
  members: number;
  messages: number;
  automations: number;
  outputs: number;
  records: number;
  createdAt: string;
}

export function TenantsTable({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.slug.toLowerCase().includes(search.toLowerCase()),
  );

  async function setStatus(tenant: TenantRow, status: 'ACTIVE' | 'SUSPENDED') {
    if (
      status === 'SUSPENDED' &&
      !confirm(
        `Suspend "${tenant.name}"? Their users lose access and processing stops. No data is deleted.`,
      )
    ) {
      return;
    }

    setBusy(tenant.id);
    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Update failed.');
      toast.success(status === 'SUSPENDED' ? 'Tenant suspended' : 'Tenant activated');
      router.refresh();
    } catch (err) {
      toast.error('Could not update tenant', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b p-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tenants…"
            className="pl-8"
            aria-label="Search tenants"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {tenants.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No tenants match" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead className="hidden lg:table-cell">Plan</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead className="text-right">Messages</TableHead>
              <TableHead className="text-right">Records</TableHead>
              <TableHead className="hidden md:table-cell">Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell>
                  <div className="font-medium">{tenant.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {tenant.slug} · {tenant.timezone}
                  </div>
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                  {tenant.plan ?? 'Trial'}
                </TableCell>
                <TableCell className="text-right tabular">{formatNumber(tenant.members)}</TableCell>
                <TableCell className="text-right tabular">{formatNumber(tenant.messages)}</TableCell>
                <TableCell className="text-right tabular">{formatNumber(tenant.records)}</TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {formatDate(tenant.createdAt)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={tenant.status} />
                </TableCell>
                <TableCell className="text-right">
                  {tenant.status === 'SUSPENDED' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStatus(tenant, 'ACTIVE')}
                      loading={busy === tenant.id}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Activate
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setStatus(tenant, 'SUSPENDED')}
                      loading={busy === tenant.id}
                    >
                      <Ban className="h-3.5 w-3.5 text-destructive" /> Suspend
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
