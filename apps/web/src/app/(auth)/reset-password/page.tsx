'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resetPasswordAction } from '../actions';

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const formData = new FormData(event.currentTarget);
    formData.set('token', token);
    const response = await resetPasswordAction(formData);
    setResult({ ok: response.ok, message: response.message ?? '' });
    setLoading(false);
  }

  if (!token) {
    return (
      <div className="mt-7 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
        This reset link is missing its token. Request a new link from the sign-in page.
      </div>
    );
  }

  if (result?.ok) {
    return (
      <div className="mt-7 space-y-5">
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          {result.message}
        </div>
        <Button asChild className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-7 space-y-4">
      {result && !result.ok ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {result.message}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          placeholder="At least 10 characters"
          disabled={loading}
        />
      </div>

      <Button type="submit" className="w-full" loading={loading}>
        Update password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Your reset link is valid for one hour.</p>
      <Suspense fallback={<div className="skeleton mt-7 h-32" />}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
