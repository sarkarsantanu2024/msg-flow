/**
 * Resolve `preset`/`from`/`to` search params into concrete dates.
 *
 * Deliberately kept out of components/dashboard/date-filter.tsx. That module is
 * marked `'use client'`, which turns *every* export of it into a client
 * reference — including a plain function with no hooks. A server component that
 * imports one gets a stub that throws "Attempted to call parseDateParams() from
 * the server" when called, which is what took the dashboard down. The filter UI
 * needs the client boundary; this helper only ever runs on the server.
 */
export function parseDateParams(searchParams: { preset?: string; from?: string; to?: string }) {
  return {
    preset: searchParams.preset ?? 'last7',
    from: searchParams.from ? new Date(`${searchParams.from}T00:00:00`) : undefined,
    to: searchParams.to ? new Date(`${searchParams.to}T23:59:59`) : undefined,
  };
}
