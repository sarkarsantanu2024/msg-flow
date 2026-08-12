'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { AlertCircle } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { signupAction } from '../actions';

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

export function SignupForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFields({});
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    formData.set('timezone', timezone);

    const password = String(formData.get('password') ?? '');
    const email = String(formData.get('email') ?? '');

    const result = await signupAction(formData);

    if (!result.ok) {
      setError(result.message ?? 'We could not create your account.');
      setFields(result.fields ?? {});
      setLoading(false);
      return;
    }

    // Sign straight in — making someone type the password they just chose is
    // friction with no security benefit.
    const signInResult = await signIn('credentials', { email, password, redirect: false });
    if (!signInResult || signInResult.error) {
      router.push('/login?registered=1');
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-7 space-y-4">
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" required placeholder="Rahul Sharma" disabled={loading} aria-invalid={Boolean(fields.name)} />
        {fields.name ? <p className="text-xs text-destructive">{fields.name}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="organizationName">Organization</Label>
        <Input
          id="organizationName"
          name="organizationName"
          required
          placeholder="Acme Trading Co."
          disabled={loading}
          aria-invalid={Boolean(fields.organizationName)}
        />
        {fields.organizationName ? <p className="text-xs text-destructive">{fields.organizationName}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@company.com"
          disabled={loading}
          aria-invalid={Boolean(fields.email)}
        />
        {fields.email ? <p className="text-xs text-destructive">{fields.email}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          placeholder="At least 10 characters"
          disabled={loading}
          aria-invalid={Boolean(fields.password)}
        />
        {fields.password ? (
          <p className="text-xs text-destructive">{fields.password}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            At least 10 characters. A short phrase you can remember beats a short jumble.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Select value={timezone} onValueChange={setTimezone} disabled={loading}>
          <SelectTrigger id="timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Schedules and daily reports use this. You can change it later in Settings.
        </p>
      </div>

      <Button type="submit" className="w-full" loading={loading}>
        {loading ? 'Creating your workspace…' : 'Create account'}
      </Button>
    </form>
  );
}
