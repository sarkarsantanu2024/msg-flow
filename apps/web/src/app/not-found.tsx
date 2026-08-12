import Link from 'next/link';
import { FileQuestion } from '@/components/icon';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="rounded-full bg-muted p-4">
        <FileQuestion className="h-7 w-7 text-muted-foreground" />
      </div>
      <h1 className="mt-5 text-xl font-semibold">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The page you were looking for does not exist, or you do not have access to it.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
