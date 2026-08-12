import type { Metadata } from 'next';
import { prisma } from '@msgflow/db';
import { getProviderStatus } from '@msgflow/ai';
import { isGoogleConfigured } from '@msgflow/config';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { SettingsForm } from './settings-form';
import { formatDateTime, humanize } from '@/lib/format';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const context = await requireTenant();

  const [tenant, auditLogs] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: context.tenantId } }),
    prisma.auditLog.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  const provider = getProviderStatus();
  const canManage = ['OWNER', 'ADMIN'].includes(context.role);
  const canSeeAudit = ['OWNER', 'ADMIN'].includes(context.role);

  return (
    <div>
      <PageHeader title="Settings" description="Workspace configuration and activity history." />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SettingsForm
            canManage={canManage}
            name={tenant?.name ?? context.tenantName}
            timezone={tenant?.timezone ?? context.timezone}
          />

          {canSeeAudit ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Audit log</CardTitle>
                <CardDescription>Who did what, and when</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {auditLogs.length === 0 ? (
                  <EmptyState title="No activity recorded yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Who</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead className="hidden sm:table-cell">Entity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDateTime(log.createdAt, context.timezone)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.user?.name ?? log.user?.email ?? 'System'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{log.action.replace(/[._]/g, ' ')}</Badge>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                            {log.entityType}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI provider</CardTitle>
              <CardDescription>Configured with environment variables on the server</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Active</span>
                <Badge variant={provider.usingFallback ? 'warning' : 'success'}>
                  {humanize(provider.active)}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Model</span>
                <span className="text-sm text-muted-foreground">{provider.model}</span>
              </div>
              {provider.usingFallback ? (
                <p className="rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
                  <strong>{humanize(provider.configured ?? '')}</strong> is selected but has no API key, so the
                  built-in rule-based provider is being used. Set the relevant key in your environment to switch.
                </p>
              ) : null}
              <ul className="space-y-1.5 border-t pt-3 text-sm">
                {provider.available.map((p) => (
                  <li key={p.name} className="flex items-center justify-between">
                    <span>{humanize(p.name)}</span>
                    <Badge variant={p.configured ? 'success' : 'muted'}>
                      {p.configured ? 'Ready' : 'No key'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sign-in</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                MsgFlow uses email and password only. Accounts are created directly here — there is no Google or
                other third-party sign-in.
              </p>
              <p className="text-xs text-muted-foreground">
                Google credentials, when configured, are used solely by the optional Google Sheets data connector
                and never for authentication.{' '}
                {isGoogleConfigured() ? 'Google Sheets is configured.' : 'Google Sheets is not configured.'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
