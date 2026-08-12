import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2 } from '@/components/icon';
import { prisma } from '@msgflow/db';
import { requireTenant } from '@/lib/auth';
import { resolvePreset } from '@/lib/queries';
import { PageHeader, StatTile } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/misc';
import { StatusBadge } from '@/components/status-badge';
import { formatDate, formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const context = await requireTenant();
  const month = resolvePreset('thisMonth', context.timezone);

  const [subscription, plans, usage, counts] = await Promise.all([
    prisma.subscription.findUnique({
      where: { tenantId: context.tenantId },
      include: { plan: true },
    }),
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceInr: 'asc' } }),
    prisma.usage.aggregate({
      where: { tenantId: context.tenantId, periodStart: { gte: month.start, lt: month.end } },
      _sum: { messages: true, aiCalls: true },
    }),
    Promise.all([
      prisma.automation.count({ where: { tenantId: context.tenantId, status: { not: 'ARCHIVED' } } }),
      prisma.output.count({ where: { tenantId: context.tenantId } }),
      prisma.membership.count({ where: { tenantId: context.tenantId } }),
    ]),
  ]);

  const [automationCount, outputCount, seatCount] = counts;
  const limits = (subscription?.plan.limits ?? {}) as Record<string, number>;

  const usageRows = [
    { label: 'Messages this month', used: usage._sum.messages ?? 0, limit: limits.messagesPerMonth },
    { label: 'AI calls this month', used: usage._sum.aiCalls ?? 0, limit: limits.aiCallsPerMonth },
    { label: 'Automations', used: automationCount, limit: limits.automations },
    { label: 'Outputs', used: outputCount, limit: limits.outputs },
    { label: 'Team members', used: seatCount, limit: limits.seats },
  ];

  return (
    <div>
      <PageHeader
        title="Billing"
        description="Your plan and how much of it you are using this month."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Current plan</CardTitle>
            <CardDescription>
              {subscription
                ? `${subscription.plan.name} · renews ${formatDate(subscription.currentPeriodEnd, context.timezone)}`
                : 'No subscription record — this workspace is on the default trial.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-semibold">{subscription?.plan.name ?? 'Trial'}</span>
              {subscription ? <StatusBadge status={subscription.status} /> : <Badge variant="default">Trial</Badge>}
            </div>

            <div className="space-y-3">
              {usageRows.map((row) => {
                const percent = row.limit ? Math.min(100, (row.used / row.limit) * 100) : 0;
                return (
                  <div key={row.label}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span>{row.label}</span>
                      <span className="tabular text-muted-foreground">
                        {formatNumber(row.used)}
                        {row.limit ? ` / ${formatNumber(row.limit)}` : ''}
                      </span>
                    </div>
                    {row.limit ? <Progress value={percent} /> : null}
                  </div>
                );
              })}
            </div>

            <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              Payment processing is not wired up in this build. Plans and limits are tracked and enforced in the
              product; connecting a payment provider is a deployment step documented in docs/deployment.md.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="grid gap-3">
            <StatTile label="Messages this month" value={formatNumber(usage._sum.messages ?? 0)} />
            <StatTile label="AI calls this month" value={formatNumber(usage._sum.aiCalls ?? 0)} />
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link href="/dashboard/usage">See detailed usage</Link>
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {plans.map((plan) => {
          const planLimits = (plan.limits ?? {}) as Record<string, number>;
          const features = (plan.features ?? []) as string[];
          const current = subscription?.planId === plan.id;
          return (
            <Card key={plan.id} className={current ? 'border-primary ring-1 ring-primary' : undefined}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  {current ? <Badge variant="default">Current</Badge> : null}
                </div>
                <CardDescription>
                  {plan.priceInr === 0 ? 'Free' : `₹${formatNumber(plan.priceInr)} / ${plan.interval}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      <span>{feature}</span>
                    </li>
                  ))}
                  {planLimits.messagesPerMonth ? (
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      <span>{formatNumber(planLimits.messagesPerMonth)} messages / month</span>
                    </li>
                  ) : null}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
