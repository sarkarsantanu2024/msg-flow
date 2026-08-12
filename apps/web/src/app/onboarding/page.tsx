import { redirect } from 'next/navigation';
import { getUserMemberships } from '@msgflow/db';
import { requireAuth } from '@/lib/auth';
import { Wordmark } from '@/components/logo';
import { OnboardingForm } from './onboarding-form';

export const dynamic = 'force-dynamic';

/**
 * Reached only when a signed-in user belongs to no workspace — which happens if
 * their last membership was removed. Rather than a dead end, they can create a
 * new workspace and carry on.
 */
export default async function OnboardingPage() {
  const context = await requireAuth();
  const memberships = await getUserMemberships(context.userId);
  if (memberships.length > 0) redirect('/dashboard');

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Wordmark showTagline className="mb-8" />
        <h1 className="text-2xl font-semibold tracking-tight">Create a workspace</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          You are signed in as {context.email}, but you do not belong to a workspace yet.
        </p>
        <OnboardingForm />
      </div>
    </div>
  );
}
