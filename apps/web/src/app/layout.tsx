import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/misc';
// Self-hosted, like material-symbols below. `next/font/google` downloads the
// font from fonts.gstatic.com during the build, which fails on a builder with
// restricted or flaky egress and takes the whole deployment down with it.
// The variable font ships every weight we used (400–800) in one file.
import '@fontsource-variable/plus-jakarta-sans';
import 'material-symbols/rounded.css';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'MsgFlow — Turn Messages Into Business Data',
    template: '%s · MsgFlow',
  },
  description:
    'MsgFlow reads important WhatsApp business messages and continuously turns them into structured, usable business data — creating and updating Excel, Google Sheets, APIs and reports.',
  applicationName: 'MsgFlow',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-sm antialiased">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
