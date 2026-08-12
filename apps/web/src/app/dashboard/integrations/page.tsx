import type { Metadata } from 'next';
import { isGoogleConfigured } from '@msgflow/config';
import { prisma } from '@msgflow/db';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { formatRelativeTime, humanize } from '@/lib/format';
import { IntegrationsPanel } from './integrations-panel';

export const metadata: Metadata = { title: 'Integrations' };
export const dynamic = 'force-dynamic';

const CATALOG = [
  {
    type: 'GOOGLE_SHEETS',
    name: 'Google Sheets',
    description: 'Keep an existing spreadsheet in step — append, update or upsert rows on your unique key.',
    credentialType: 'OAUTH2' as const,
    fields: [
      { key: 'serviceAccountJson', label: 'Service account JSON', type: 'textarea' as const },
      { key: 'accessToken', label: 'OAuth access token', type: 'text' as const },
      { key: 'refreshToken', label: 'OAuth refresh token', type: 'text' as const },
    ],
  },
  {
    type: 'REST_API',
    name: 'REST API',
    description: 'Push structured records into your own system. Create, update and upsert — never delete.',
    credentialType: 'BEARER_TOKEN' as const,
    fields: [
      { key: 'token', label: 'Bearer token', type: 'text' as const },
      { key: 'apiKey', label: 'API key (alternative)', type: 'text' as const },
      { key: 'headerName', label: 'API key header name', type: 'text' as const },
    ],
  },
  {
    type: 'CLIENT_WEBSITE',
    name: 'Client website / admin',
    description: 'The same connector under a friendlier name, for updating a client site or admin panel.',
    credentialType: 'BASIC_AUTH' as const,
    fields: [
      { key: 'username', label: 'Username', type: 'text' as const },
      { key: 'password', label: 'Password', type: 'password' as const },
    ],
  },
  {
    type: 'WEBHOOK',
    name: 'Webhook',
    description: 'Notify an endpoint whenever records are synchronized. Payloads are HMAC-signed.',
    credentialType: 'NONE' as const,
    fields: [],
  },
];

export default async function IntegrationsPage() {
  const context = await requireTenant();

  const integrations = await prisma.integration.findMany({
    where: { tenantId: context.tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      credentials: { select: { id: true, type: true, isValid: true, lastUsedAt: true } },
      _count: { select: { outputs: true } },
    },
  });

  const canManage = ['OWNER', 'ADMIN'].includes(context.role);

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Credentials for the systems MsgFlow writes to. Stored encrypted and never shown again after saving."
      />

      {!isGoogleConfigured() ? (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <strong>Google Sheets runs in mock mode.</strong> Without GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or a
          service account), the connector executes all mapping, key matching and update-strategy logic and reports
          exactly what it would do — but writes nothing to Google. Credentials required to activate this
          integration.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connected</CardTitle>
            <CardDescription>{integrations.length} integration(s) configured</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {integrations.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                Nothing connected yet. Add one from the catalog.
              </p>
            ) : (
              <ul className="divide-y">
                {integrations.map((integration) => (
                  <li key={integration.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{integration.name}</span>
                      <StatusBadge status={integration.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {humanize(integration.type)} · {integration._count.outputs} output(s)
                      {integration.credentials[0]?.lastUsedAt
                        ? ` · last used ${formatRelativeTime(integration.credentials[0].lastUsedAt)}`
                        : ''}
                    </p>
                    {integration.lastError ? (
                      <p className="mt-1 text-xs text-destructive">{integration.lastError}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Available</CardTitle>
            <CardDescription>Every connector is implemented; some need credentials to go live.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {CATALOG.map((item) => (
              <div key={item.type} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{item.name}</span>
                  {item.type === 'GOOGLE_SHEETS' && !isGoogleConfigured() ? (
                    <Badge variant="warning">Credentials required</Badge>
                  ) : (
                    <Badge variant="muted">Ready to configure</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                {canManage ? (
                  <div className="mt-3">
                    <IntegrationsPanel
                      type={item.type}
                      name={item.name}
                      credentialType={item.credentialType}
                      fields={item.fields}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
