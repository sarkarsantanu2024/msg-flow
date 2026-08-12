'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { humanize } from '@/lib/format';

const ALL = '__all__';
const STATUSES = ['DRAFT', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED'];

export function RecordFilters({
  schemas,
  automations,
}: {
  schemas: Array<{ id: string; name: string }>;
  automations: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  const hasFilters = ['search', 'status', 'schemaId', 'automationId', 'sort'].some((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          update({ search });
        }}
        className="relative min-w-[13rem] flex-1 sm:max-w-xs"
      >
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by record key…"
          className="pl-8"
          aria-label="Search records"
        />
      </form>

      <Select value={params.get('status') ?? ALL} onValueChange={(v) => update({ status: v })}>
        <SelectTrigger className="w-auto min-w-[8rem]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any status</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {humanize(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={params.get('schemaId') ?? ALL} onValueChange={(v) => update({ schemaId: v })}>
        <SelectTrigger className="w-auto min-w-[9rem]">
          <SelectValue placeholder="Schema" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All schemas</SelectItem>
          {schemas.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={params.get('automationId') ?? ALL} onValueChange={(v) => update({ automationId: v })}>
        <SelectTrigger className="w-auto min-w-[9rem]">
          <SelectValue placeholder="Automation" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All automations</SelectItem>
          {automations.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={`${params.get('sort') ?? 'updatedAt'}:${params.get('direction') ?? 'desc'}`}
        onValueChange={(v) => {
          const [sort, direction] = v.split(':');
          update({ sort, direction });
        }}
      >
        <SelectTrigger className="w-auto min-w-[9rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="updatedAt:desc">Recently updated</SelectItem>
          <SelectItem value="createdAt:desc">Newest first</SelectItem>
          <SelectItem value="createdAt:asc">Oldest first</SelectItem>
          <SelectItem value="confidence:asc">Lowest confidence</SelectItem>
          <SelectItem value="naturalKey:asc">Key A–Z</SelectItem>
        </SelectContent>
      </Select>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch('');
            router.push(pathname);
          }}
        >
          <X className="h-3.5 w-3.5" /> Clear
        </Button>
      ) : null}
    </div>
  );
}
