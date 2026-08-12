import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma, recordAudit } from '@msgflow/db';
import { z } from 'zod';
import { created, readJson, route } from '@/lib/api';
import { requireAuthApi, TENANT_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  timezone: z.string().min(1).default('Asia/Kolkata'),
});

/** Create an additional workspace for the signed-in user, who becomes its owner. */
export const POST = route(async (request: Request) => {
  const context = await requireAuthApi();
  const input = schema.parse(await readJson(request));

  let slug =
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'workspace';

  if (await prisma.tenant.findUnique({ where: { slug } })) {
    slug = `${slug}-${randomBytes(3).toString('hex')}`;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: input.name,
      slug,
      timezone: input.timezone,
      status: 'TRIAL',
      memberships: { create: { userId: context.userId, role: 'OWNER' } },
    },
  });

  const store = await cookies();
  store.set(TENANT_COOKIE, tenant.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  await recordAudit({
    tenantId: tenant.id,
    userId: context.userId,
    action: 'tenant.created',
    entityType: 'Tenant',
    entityId: tenant.id,
    after: { name: tenant.name },
  });

  return created({ id: tenant.id, name: tenant.name, slug: tenant.slug });
});
