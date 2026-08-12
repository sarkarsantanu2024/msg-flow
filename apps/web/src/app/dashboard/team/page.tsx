import type { Metadata } from 'next';
import { prisma } from '@msgflow/db';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { TeamTable } from './team-table';

export const metadata: Metadata = { title: 'Team' };
export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const context = await requireTenant();

  const members = await prisma.membership.findMany({
    where: { tenantId: context.tenantId },
    include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return (
    <div>
      <PageHeader
        title="Team"
        description="Who can access this workspace, and what they are allowed to do."
      />

      <TeamTable
        canManage={['OWNER', 'ADMIN'].includes(context.role)}
        currentUserId={context.userId}
        members={members.map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.user.name ?? m.user.email,
          email: m.user.email,
          role: m.role,
          lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
          joinedAt: m.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
