import { cn } from '@/lib/utils';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { humanize } from '@/lib/format';

/**
 * Status vocabulary in one place.
 *
 * Colour carries meaning here, so every badge also spells out its status in
 * words — a red dot alone is unreadable for anyone who cannot distinguish it
 * from the green one.
 */

type Tone = BadgeProps['variant'];

const TONES: Record<string, Tone> = {
  // Connection
  READY: 'success',
  CONNECTED: 'success',
  AUTHENTICATED: 'success',
  CONNECTING: 'warning',
  RECONNECTING: 'warning',
  QR_REQUIRED: 'warning',
  DISCONNECTED: 'destructive',
  LOGGED_OUT: 'muted',
  ERROR: 'destructive',

  // Automation / output
  ACTIVE: 'success',
  DRAFT: 'muted',
  PAUSED: 'warning',
  ARCHIVED: 'muted',
  SYNCING: 'default',
  SUCCESS: 'success',
  PARTIAL_SUCCESS: 'warning',
  FAILED: 'destructive',
  CONFLICT: 'destructive',

  // Runs
  QUEUED: 'muted',
  RUNNING: 'default',
  RETRYING: 'warning',
  CANCELLED: 'muted',

  // Records
  VALIDATED: 'success',
  APPROVED: 'success',
  NEEDS_REVIEW: 'warning',
  REJECTED: 'destructive',

  // Messages
  PENDING: 'muted',
  CLASSIFIED: 'default',
  PROCESSING: 'default',
  EXTRACTED: 'success',
  SKIPPED: 'muted',
  IGNORED: 'muted',

  // Sync
  SYNCED: 'success',
  STALE: 'warning',

  // Health
  HEALTHY: 'success',
  DEGRADED: 'warning',
  DOWN: 'destructive',
  UNKNOWN: 'muted',

  // Importance
  HIGH: 'destructive',
  MEDIUM: 'warning',
  LOW: 'muted',

  // Worker
  ONLINE: 'success',
  OFFLINE: 'destructive',
  STARTING: 'warning',

  // Tenant
  TRIAL: 'default',
  SUSPENDED: 'destructive',
  MOCK: 'warning',
  NOT_CONFIGURED: 'muted',
  EXPIRED: 'destructive',
};

export function StatusBadge({
  status,
  className,
  label,
}: {
  status: string | null | undefined;
  className?: string;
  label?: string;
}) {
  if (!status) return <Badge variant="muted">Unknown</Badge>;
  const tone = TONES[status.toUpperCase()] ?? 'secondary';
  return (
    <Badge variant={tone} className={className}>
      <StatusDot status={status} />
      {label ?? humanize(status)}
    </Badge>
  );
}

const DOT_COLOURS: Record<string, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  default: 'bg-primary',
  muted: 'bg-muted-foreground/50',
  secondary: 'bg-muted-foreground/50',
  outline: 'bg-muted-foreground/50',
};

export function StatusDot({ status, className }: { status: string | null | undefined; className?: string }) {
  const tone = (status ? (TONES[status.toUpperCase()] ?? 'secondary') : 'muted') as string;
  const pulse = ['SYNCING', 'RUNNING', 'CONNECTING', 'RECONNECTING', 'PROCESSING'].includes(
    (status ?? '').toUpperCase(),
  );
  return (
    <span
      aria-hidden
      className={cn('inline-block h-1.5 w-1.5 rounded-full', DOT_COLOURS[tone] ?? 'bg-muted-foreground/50', pulse && 'animate-pulse', className)}
    />
  );
}
