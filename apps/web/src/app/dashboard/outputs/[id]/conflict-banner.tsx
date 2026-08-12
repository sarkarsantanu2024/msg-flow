'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/format';

/**
 * Sync conflict resolution.
 *
 * There is deliberately no "merge automatically" button: silently reconciling
 * two versions of a customer's spreadsheet is the kind of guess that loses data
 * without anyone noticing. The user chooses which side wins.
 */
export function ConflictBanner({
  outputId,
  detectedAt,
  canResolve,
}: {
  outputId: string;
  detectedAt: string;
  canResolve: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(resolution: 'USE_LATEST_FILE' | 'KEEP_AUTOMATION_VERSION' | 'IGNORED') {
    setBusy(resolution);
    try {
      const response = await fetch(`/api/outputs/${outputId}/conflict`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not resolve the conflict.');

      const messages: Record<string, string> = {
        USE_LATEST_FILE: 'Using the current file',
        KEEP_AUTOMATION_VERSION: 'MsgFlow data will be written on the next sync',
        IGNORED: 'Conflict dismissed and the output paused',
      };
      toast.success(messages[resolution], {
        description:
          resolution === 'USE_LATEST_FILE'
            ? 'Row matching will be rebuilt from the file as it now stands.'
            : resolution === 'KEEP_AUTOMATION_VERSION'
              ? 'The next sync will overwrite the changed rows.'
              : undefined,
      });
      router.refresh();
    } catch (err) {
      toast.error('Could not resolve conflict', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-destructive">
            The output file has changed since the last synchronization.
          </p>
          <p className="mt-1 text-sm text-destructive/90">
            Someone edited it outside MsgFlow {formatRelativeTime(detectedAt)}. Nothing was written, so no changes
            have been lost. Choose how to continue.
          </p>

          {canResolve ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => resolve('USE_LATEST_FILE')}
                loading={busy === 'USE_LATEST_FILE'}
              >
                Use the latest file
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => resolve('KEEP_AUTOMATION_VERSION')}
                loading={busy === 'KEEP_AUTOMATION_VERSION'}
              >
                Keep MsgFlow&apos;s data
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resolve('IGNORED')} loading={busy === 'IGNORED'}>
                Dismiss &amp; pause
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-destructive/80">
              An operator or admin needs to resolve this.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
