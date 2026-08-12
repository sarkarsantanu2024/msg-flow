'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from '@/components/icon';
import { MESSAGE_CATEGORIES } from '@msgflow/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { humanize } from '@/lib/format';

const ALL = '__all__';

const STATUSES = [
  'PENDING',
  'CLASSIFIED',
  'PROCESSING',
  'EXTRACTED',
  'SKIPPED',
  'IGNORED',
  'NEEDS_REVIEW',
  'FAILED',
];

export function MessageFilters({ groups }: { groups: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '' || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  const hasFilters = ['search', 'groupId', 'category', 'importance', 'status', 'from', 'to'].some((k) =>
    params.get(k),
  );

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
          placeholder="Search message or sender…"
          className="pl-8"
          aria-label="Search messages"
        />
      </form>

      <Select value={params.get('groupId') ?? ALL} onValueChange={(v) => update({ groupId: v })}>
        <SelectTrigger className="w-auto min-w-[9rem]">
          <SelectValue placeholder="All groups" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All groups</SelectItem>
          {groups.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={params.get('category') ?? ALL} onValueChange={(v) => update({ category: v })}>
        <SelectTrigger className="w-auto min-w-[8rem]">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All categories</SelectItem>
          {MESSAGE_CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>
              {humanize(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={params.get('importance') ?? ALL} onValueChange={(v) => update({ importance: v })}>
        <SelectTrigger className="w-auto min-w-[7.5rem]">
          <SelectValue placeholder="Importance" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any importance</SelectItem>
          {['HIGH', 'MEDIUM', 'LOW', 'IGNORE'].map((i) => (
            <SelectItem key={i} value={i}>
              {humanize(i)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={params.get('status') ?? ALL} onValueChange={(v) => update({ status: v })}>
        <SelectTrigger className="w-auto min-w-[7.5rem]">
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

      <Input
        type="date"
        value={params.get('from') ?? ''}
        onChange={(e) => update({ from: e.target.value })}
        className="w-auto"
        aria-label="From date"
      />
      <Input
        type="date"
        value={params.get('to') ?? ''}
        onChange={(e) => update({ to: e.target.value })}
        className="w-auto"
        aria-label="To date"
      />

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
