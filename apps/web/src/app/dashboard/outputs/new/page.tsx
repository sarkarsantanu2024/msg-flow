import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from '@/components/icon';
import { isGoogleConfigured } from '@msgflow/config';
import { requireTenant } from '@/lib/auth';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { OutputWizard } from './output-wizard';

export const metadata: Metadata = { title: 'New output' };
export const dynamic = 'force-dynamic';

export default async function NewOutputPage() {
  await requireTenant();

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/dashboard/outputs">
          <ArrowLeft className="h-4 w-4" /> Back to outputs
        </Link>
      </Button>

      <PageHeader
        title="New output"
        description="Create a brand new file, or connect one you already maintain so MsgFlow keeps it up to date."
      />

      <OutputWizard googleConfigured={isGoogleConfigured()} />
    </div>
  );
}
