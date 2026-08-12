import { cn } from '@/lib/utils';

/**
 * MsgFlow mark: a message bubble whose tail flows into a data row — the product
 * thesis in one glyph (message in, structured row out).
 */
export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M7 11.5C7 10.1193 8.11929 9 9.5 9H19.5C20.8807 9 22 10.1193 22 11.5V16.5C22 17.8807 20.8807 19 19.5 19H13.5L10 22V19H9.5C8.11929 19 7 17.8807 7 16.5V11.5Z"
        className="fill-primary-foreground"
        opacity="0.95"
      />
      <rect x="17" y="21" width="8" height="1.8" rx="0.9" className="fill-primary-foreground" opacity="0.75" />
      <rect x="17" y="24.5" width="5.5" height="1.8" rx="0.9" className="fill-primary-foreground" opacity="0.5" />
    </svg>
  );
}

export function Wordmark({ className, showTagline = false }: { className?: string; showTagline?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Logo />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">MsgFlow</div>
        {showTagline ? (
          <div className="text-xs text-muted-foreground">Turn Messages Into Business Data.</div>
        ) : null}
      </div>
    </div>
  );
}
