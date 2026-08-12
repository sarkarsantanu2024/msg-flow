import Link from 'next/link';
import { AlertOctagon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/logo';

export default function SuspendedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Wordmark className="mb-10" />
      <div className="rounded-full bg-destructive/10 p-4">
        <AlertOctagon className="h-7 w-7 text-destructive" />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">This workspace is suspended</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Message capture and automation processing are paused. Your data is intact and nothing has been deleted —
        contact support to reactivate the workspace.
      </p>
      <div className="mt-6 flex gap-2">
        <Button asChild variant="outline">
          <Link href="/dashboard">Try again</Link>
        </Button>
        <Button asChild>
          <a href="mailto:support@msgflow.app">Contact support</a>
        </Button>
      </div>
    </div>
  );
}
