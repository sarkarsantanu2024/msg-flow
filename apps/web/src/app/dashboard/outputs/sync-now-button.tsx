'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw } from '@/components/icon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatNumber } from '@/lib/format';

interface SyncSummary {
  status: string;
  messagesProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsFailed: number;
  warnings: string[];
  errors: string[];
}

/**
 * SYNC NOW.
 *
 * Runs the real pipeline and shows the actual result — messages processed,
 * rows created, updated, skipped and failed. A button that claimed success
 * without reporting what it did would be worse than no button.
 */
export function SyncNowButton({ outputId, compact = false }: { outputId: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<SyncSummary | null>(null);

  async function sync() {
    setBusy(true);
    const toastId = toast.loading('Synchronizing…', {
      description: 'Finding messages, extracting data and updating the output.',
    });

    try {
      const response = await fetch(`/api/outputs/${outputId}/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await response.json();

      if (!response.ok) {
        toast.error('Sync failed', {
          id: toastId,
          description: body?.error?.message ?? 'Unknown error',
        });
        router.refresh();
        return;
      }

      const result = body.data as SyncSummary;
      setSummary(result);

      const tone =
        result.status === 'SUCCESS' ? toast.success : result.status === 'FAILED' ? toast.error : toast.warning;
      tone(`Sync ${result.status.toLowerCase().replace('_', ' ')}`, {
        id: toastId,
        description: `${formatNumber(result.rowsCreated)} created · ${formatNumber(result.rowsUpdated)} updated · ${formatNumber(result.rowsSkipped)} skipped${result.rowsFailed ? ` · ${formatNumber(result.rowsFailed)} failed` : ''}`,
      });
      router.refresh();
    } catch (err) {
      toast.error('Sync failed', {
        id: toastId,
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size={compact ? 'sm' : 'default'} variant={compact ? 'ghost' : 'default'} onClick={sync} loading={busy}>
        <RefreshCw className="h-3.5 w-3.5" />
        {compact ? <span className="sr-only">Sync now</span> : 'Sync now'}
      </Button>

      <Dialog open={summary !== null} onOpenChange={(open) => !open && setSummary(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync result</DialogTitle>
            <DialogDescription>
              {summary?.status === 'CONFLICT'
                ? 'The output file changed since the last synchronization, so nothing was written.'
                : 'What this synchronization actually did.'}
            </DialogDescription>
          </DialogHeader>

          {summary ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Messages processed', summary.messagesProcessed],
                  ['Records created', summary.recordsCreated],
                  ['Records updated', summary.recordsUpdated],
                  ['Records skipped', summary.recordsSkipped],
                  ['Rows created', summary.rowsCreated],
                  ['Rows updated', summary.rowsUpdated],
                  ['Rows skipped', summary.rowsSkipped],
                  ['Rows failed', summary.rowsFailed],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-md border p-2.5">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular">{formatNumber(value as number)}</dd>
                  </div>
                ))}
              </dl>

              {summary.warnings.length > 0 ? (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-warning">Warnings</p>
                  <ul className="mt-1.5 space-y-1 text-sm text-warning">
                    {summary.warnings.slice(0, 6).map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {summary.errors.length > 0 ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Errors</p>
                  <ul className="mt-1.5 space-y-1 text-sm text-destructive">
                    {summary.errors.slice(0, 6).map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button onClick={() => setSummary(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
