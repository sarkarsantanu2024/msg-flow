'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { forgotPasswordAction } from '../actions';

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const result = await forgotPasswordAction(new FormData(event.currentTarget));
    setSent(result.message ?? 'Check your inbox.');
    setDevUrl(result.devResetUrl ?? null);
    setLoading(false);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Enter your email and we&apos;ll send you a link to choose a new password.
      </p>

      {sent ? (
        <div className="mt-7 space-y-4">
          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
            {sent}
          </div>
          {devUrl ? (
            <div className="rounded-md border bg-muted/50 p-3 text-xs">
              <p className="mb-1.5 font-medium">Development mode — no mailer configured</p>
              <a href={devUrl} className="break-all text-primary hover:underline">
                {devUrl}
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required placeholder="you@company.com" disabled={loading} />
          </div>
          <Button type="submit" className="w-full" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}

      <p className="mt-6 text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
