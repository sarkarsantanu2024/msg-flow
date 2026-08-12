import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; registered?: string }>;
}) {
  const params = await searchParams;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Enter the email and password you created your account with.
      </p>

      {params.registered ? (
        <div className="mt-5 rounded-md border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          Your account is ready. Sign in to continue.
        </div>
      ) : null}

      <LoginForm callbackUrl={params.callbackUrl ?? '/dashboard'} initialError={params.error} />

      <p className="mt-6 text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
