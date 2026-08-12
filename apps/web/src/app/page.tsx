import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, FileSpreadsheet, MessageSquare, RefreshCw, ShieldCheck, Sparkles, Workflow } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/logo';
import { getAuth } from '@/lib/auth';

export default async function LandingPage() {
  const session = await getAuth();
  if (session) redirect('/dashboard');

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <Wordmark />
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Create account</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="container py-20 text-center sm:py-28">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              AI-powered message extraction
            </div>
            <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-6xl">
              Turn Messages Into Business Data.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
              MsgFlow reads the business messages your team already sends on WhatsApp, understands them with AI,
              and continuously creates <em>and updates</em> your Excel files, Google Sheets and internal systems.
            </p>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
              Not an export tool — a system that maintains your business data.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">
                  Start free <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="border-t bg-muted/30 py-16">
          <div className="container">
            <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: MessageSquare,
                  title: 'Capture every message',
                  body: 'Monitor the WhatsApp groups that matter. Every message is stored in PostgreSQL the moment it arrives, so nothing depends on WhatsApp still having it.',
                },
                {
                  icon: Sparkles,
                  title: 'Understand with AI',
                  body: 'Classification and structured extraction with OpenAI, Gemini or Anthropic. Validated against your schema before anything is saved.',
                },
                {
                  icon: FileSpreadsheet,
                  title: 'Update existing files',
                  body: 'Upload a workbook you already use. MsgFlow matches rows on your unique key and updates them in place — formulas and formatting intact.',
                },
                {
                  icon: RefreshCw,
                  title: 'Real-time or scheduled',
                  body: 'Process as messages arrive, or daily, weekly and monthly. Incremental by default, so the same message is never paid for twice.',
                },
                {
                  icon: Workflow,
                  title: 'One record, many outputs',
                  body: 'The same structured record can update a master Excel, a Google Sheet, your own API and a monthly PDF — each with its own operation.',
                },
                {
                  icon: ShieldCheck,
                  title: 'Traceable and safe',
                  body: 'Every output row traces back to the original message. Conflict detection refuses to overwrite a file someone edited by hand.',
                },
              ].map((feature) => (
                <div key={feature.title} className="rounded-lg border bg-background p-5">
                  <feature.icon className="h-5 w-5 text-primary" />
                  <h3 className="mt-3 font-semibold">{feature.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="container flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <Wordmark showTagline />
          <p>© {new Date().getFullYear()} MsgFlow</p>
        </div>
      </footer>
    </div>
  );
}
