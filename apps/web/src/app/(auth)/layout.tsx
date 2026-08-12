import Link from 'next/link';
import { Wordmark } from '@/components/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-10 inline-block">
            <Wordmark showTagline />
          </Link>
          {children}
        </div>
      </div>

      {/* Decorative panel; hidden on small screens where it would only push the form down. */}
      <div className="relative hidden bg-primary lg:block">
        <div className="flex h-full flex-col justify-center px-14 text-primary-foreground">
          <blockquote className="max-w-md">
            <p className="text-2xl font-semibold leading-snug">
              “Read important WhatsApp business messages and continuously turn them into structured, usable
              business data.”
            </p>
            <footer className="mt-6 text-sm opacity-80">The MsgFlow product promise</footer>
          </blockquote>

          <div className="mt-12 grid max-w-md gap-3 text-sm opacity-90">
            {[
              'Create new Excel files — or update the ones you already use',
              'Real-time, daily, weekly and monthly processing',
              'Every row traces back to the original message',
            ].map((line) => (
              <div key={line} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-foreground/70" />
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
