'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Database,
  FileOutput,
  FileStack,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
  Smartphone,
} from '@/components/icon';
import { cn } from '@/lib/utils';
import { Wordmark } from '@/components/logo';
import { Badge } from '@/components/ui/badge';

/** Sidebar navigation. Matches the routes in the product specification. */
const NAV_SECTIONS: Array<{
  label: string;
  items: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Capture',
    items: [
      { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: Smartphone },
      { href: '/dashboard/groups', label: 'Groups', icon: Users },
      { href: '/dashboard/messages', label: 'Messages', icon: MessageSquare },
    ],
  },
  {
    label: 'Process',
    items: [
      { href: '/dashboard/automations', label: 'Automations', icon: Workflow },
      { href: '/dashboard/records', label: 'Extracted Data', icon: Database },
    ],
  },
  {
    label: 'Deliver',
    items: [
      { href: '/dashboard/outputs', label: 'Outputs', icon: FileOutput },
      { href: '/dashboard/exports', label: 'Exports', icon: FileStack },
      { href: '/dashboard/integrations', label: 'Integrations', icon: Plug },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Sidebar({
  reviewCount = 0,
  isSuperAdmin = false,
  onNavigate,
}: {
  reviewCount?: number;
  isSuperAdmin?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className="flex h-16 shrink-0 items-center border-b px-5">
        <Link href="/dashboard" onClick={onNavigate}>
          <Wordmark />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-5">
            <p className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                // `/dashboard` must not stay highlighted on every child route.
                const active =
                  item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.href === '/dashboard/records' && reviewCount > 0 ? (
                        <Badge variant="warning" className="px-1.5 py-0 text-xs">
                          {reviewCount > 99 ? '99+' : reviewCount}
                        </Badge>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {isSuperAdmin ? (
          <div className="mb-5 border-t pt-4">
            <p className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Platform
            </p>
            <Link
              href="/admin"
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                pathname.startsWith('/admin')
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Super Admin
            </Link>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
