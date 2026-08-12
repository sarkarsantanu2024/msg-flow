'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Bell, Building2, ChevronDown, LogOut, Menu, Settings, User as UserIcon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sidebar } from './sidebar';
import { formatRelativeTime } from '@/lib/format';

export interface TopbarNotification {
  id: string;
  severity: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export function Topbar({
  tenantName,
  tenantSlug,
  role,
  userName,
  userEmail,
  memberships,
  notifications,
  unreadCount,
  reviewCount,
  isSuperAdmin,
}: {
  tenantName: string;
  tenantSlug: string;
  role: string;
  userName: string;
  userEmail: string;
  memberships: Array<{ tenantId: string; tenantName: string; role: string }>;
  notifications: TopbarNotification[];
  unreadCount: number;
  reviewCount: number;
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  async function switchTenant(tenantId: string) {
    await fetch('/api/tenant/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId }),
    });
    router.refresh();
  }

  async function markAllRead() {
    await fetch('/api/notifications/read-all', { method: 'POST' });
    router.refresh();
  }

  const initials =
    userName
      .split(' ')
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'U';

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Tenant switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 px-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="max-w-[10rem] truncate font-medium">{tenantName}</span>
            <Badge variant="muted" className="hidden px-1.5 py-0 text-xs sm:inline-flex">
              {role}
            </Badge>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {memberships.map((m) => (
            <DropdownMenuItem
              key={m.tenantId}
              onSelect={() => switchTenant(m.tenantId)}
              className="flex items-center justify-between"
            >
              <span className="truncate">{m.tenantName}</span>
              <Badge variant="muted" className="ml-2 px-1.5 py-0 text-xs">
                {m.role}
              </Badge>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/dashboard/settings">
              <Settings className="h-4 w-4" /> Workspace settings
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      {/* Notifications */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unreadCount} unread)`}>
            <Bell className="h-4.5 w-4.5" />
            {unreadCount > 0 ? (
              <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
              </span>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Notifications</span>
            {unreadCount > 0 ? (
              <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                Mark all read
              </button>
            ) : null}
          </div>
          <DropdownMenuSeparator />
          {notifications.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing to report.</p>
          ) : (
            notifications.map((n) => (
              <DropdownMenuItem key={n.id} asChild>
                <Link href={n.link ?? '/dashboard'} className="flex flex-col items-start gap-0.5 py-2">
                  <div className="flex w-full items-center gap-2">
                    <span
                      className={
                        n.severity === 'ERROR' || n.severity === 'CRITICAL'
                          ? 'h-1.5 w-1.5 rounded-full bg-destructive'
                          : n.severity === 'WARNING'
                            ? 'h-1.5 w-1.5 rounded-full bg-warning'
                            : 'h-1.5 w-1.5 rounded-full bg-primary'
                      }
                    />
                    <span className="flex-1 truncate text-sm font-medium">{n.title}</span>
                  </div>
                  {n.body ? <span className="line-clamp-2 pl-3.5 text-xs text-muted-foreground">{n.body}</span> : null}
                  <span className="pl-3.5 text-xs text-muted-foreground">
                    {formatRelativeTime(n.createdAt)}
                  </span>
                </Link>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 px-1.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {initials}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/dashboard/settings">
              <UserIcon className="h-4 w-4" /> Profile &amp; settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => signOut({ callbackUrl: '/login' })}>
            <LogOut className="h-4 w-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mobile navigation */}
      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent className="left-0 top-0 h-screen max-w-[17rem] translate-x-0 translate-y-0 rounded-none p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Navigation</DialogTitle>
          </DialogHeader>
          <Sidebar reviewCount={reviewCount} isSuperAdmin={isSuperAdmin} onNavigate={() => setMobileNavOpen(false)} />
        </DialogContent>
      </Dialog>

      <span className="sr-only">{tenantSlug}</span>
    </header>
  );
}
