'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState } from 'react';
import { CalendarRange } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisWeek', label: 'This week' },
  { value: 'lastWeek', label: 'Last week' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
];

export function DateFilter({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get('preset') ?? 'last7';

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');

  function apply(preset: string, custom?: { from: string; to: string }) {
    const next = new URLSearchParams(params.toString());
    next.set('preset', preset);
    if (custom) {
      next.set('from', custom.from);
      next.set('to', custom.to);
    } else {
      next.delete('from');
      next.delete('to');
    }
    // Reset pagination — page 7 of the old range is meaningless in the new one.
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  const visible = compact ? PRESETS.slice(0, 4) : PRESETS;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((preset) => (
        <Button
          key={preset.value}
          size="sm"
          variant={active === preset.value ? 'default' : 'outline'}
          onClick={() => apply(preset.value)}
          className={cn('h-8', active === preset.value && 'pointer-events-none')}
        >
          {preset.label}
        </Button>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant={active === 'custom' ? 'default' : 'outline'} className="h-8 gap-1.5">
            <CalendarRange className="h-3.5 w-3.5" />
            Custom
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Custom date range</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="range-from">From</Label>
              <Input id="range-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="range-to">To</Label>
              <Input id="range-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!from || !to || from > to}
              onClick={() => {
                apply('custom', { from, to });
                setOpen(false);
              }}
            >
              Apply range
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Resolve `preset`/`from`/`to` search params into concrete dates, server-side. */
export function parseDateParams(searchParams: { preset?: string; from?: string; to?: string }) {
  return {
    preset: searchParams.preset ?? 'last7',
    from: searchParams.from ? new Date(`${searchParams.from}T00:00:00`) : undefined,
    to: searchParams.to ? new Date(`${searchParams.to}T23:59:59`) : undefined,
  };
}
