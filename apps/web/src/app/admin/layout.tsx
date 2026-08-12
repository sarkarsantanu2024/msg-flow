import Link from 'next/link';
import { ArrowLeft, Building2, LayoutDashboard, Server } from '@/components/icon';
import { requireSuperAdmin } from '@/lib/auth';
import { Wordmark } from '@/components/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/tenants', label: 'Tenants', icon: Building2 },
  { href: '/admin/workers', label: 'Workers', icon: Server },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const context = await requireSuperAdmin();

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="flex h-16 items-center gap-4 px-4 lg:px-6">
          <Wordmark />
          <Badge variant="destructive">Platform admin</Badge>

          <nav className="ml-6 hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <Button key={item.href} asChild variant="ghost" size="sm">
                <Link href={item.href}>
                  <item.icon className="h-4 w-4" /> {item.label}
                </Link>
              </Button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{context.email}</span>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" /> Back to workspace
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="p-4 lg:p-6">{children}</main>
    </div>
  );
}
