import { prisma } from '@msgflow/db';
import { requireTenant } from '@/lib/auth';
import { getStatusPayload } from '@/lib/queries';
import { Sidebar } from '@/components/dashboard/sidebar';
import { Topbar } from '@/components/dashboard/topbar';
import { SystemStatusBar } from '@/components/dashboard/system-status-bar';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await requireTenant();

  const [notifications, unreadCount, reviewCount, status] = await Promise.all([
    prisma.notification.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.notification.count({ where: { tenantId: context.tenantId, readAt: null } }),
    prisma.extractedRecord.count({ where: { tenantId: context.tenantId, status: 'NEEDS_REVIEW' } }),
    getStatusPayload(context.tenantId, context.timezone),
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-64 shrink-0 border-r bg-card lg:block">
        <Sidebar reviewCount={reviewCount} isSuperAdmin={context.isSuperAdmin} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          tenantName={context.tenantName}
          tenantSlug={context.tenantSlug}
          role={context.role}
          userName={context.name ?? context.email}
          userEmail={context.email}
          memberships={context.memberships.map((m) => ({
            tenantId: m.tenantId,
            tenantName: m.tenantName,
            role: m.role,
          }))}
          notifications={notifications.map((n) => ({
            id: n.id,
            severity: n.severity,
            title: n.title,
            body: n.body,
            link: n.link,
            createdAt: n.createdAt.toISOString(),
            readAt: n.readAt?.toISOString() ?? null,
          }))}
          unreadCount={unreadCount}
          reviewCount={reviewCount}
          isSuperAdmin={context.isSuperAdmin}
        />

        <SystemStatusBar initial={status} />

        <main className="flex-1 overflow-y-auto bg-muted/20 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
