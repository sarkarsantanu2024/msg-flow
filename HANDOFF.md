# MsgFlow — Handoff & Pending Work

> **Read this first in a new session.** It records exactly where the build stopped, what is verified,
> what is not, and what to do next. Last updated: 2026-08-12.

---

## Status in one line

The application is **fully built and statically validated**, but has **never been run against a live
database or a real WhatsApp account**.

| Check | Status |
|---|---|
| Prisma client generation | ✅ passes |
| TypeScript — 9 packages | ✅ 0 errors |
| ESLint | ✅ 0 warnings |
| Test suite | ✅ 107 passed |
| Next.js production build | ✅ all routes compiled |
| **Database migrated** | ❌ **never run** |
| **Seed executed** | ❌ **never run** |
| **App started (`pnpm dev`)** | ❌ **never run** |
| **Worker run with real Chromium** | ❌ **never run** |

Nothing below is speculation about what *might* be wrong — it is a list of what was never exercised.

---

## P0 — Do these first, in this order

### 1. Bring up PostgreSQL and migrate

No Postgres was reachable on the build machine, so **no schema has ever been applied**.

```bash
docker compose -f docker/docker-compose.yml up -d postgres
# or point DATABASE_URL / DIRECT_URL at Neon

pnpm db:generate
pnpm db:push          # or: pnpm db:migrate
pnpm db:seed
```

**Expect to fix something here.** The schema validates and the seed typechecks, but neither has
touched a real database. Watch for:

- Enum/default mismatches surfacing only at DDL time
- The seed's `upsert` calls on composite unique keys
- `Prisma.Decimal` construction in the seed (`costUsd`)

Seed prints credentials on success: `demo@msgflow.app` / `msgflow-demo-2026`.

### 2. Start the app and walk the UI

```bash
pnpm dev            # :3000
pnpm worker:dev     # :4000, second terminal
```

The build compiles every route, but **no page has ever been server-rendered**. Walk each sidebar
route and watch the server console. Most likely failure class: a Prisma `include`/`select` shape that
typechecks but returns null at runtime, or a server/client component boundary issue.

Priority order: `/dashboard` → `/dashboard/demo` (exercises the whole AI pipeline with no WhatsApp) →
`/dashboard/outputs/new` (Excel upload + preview) → `/dashboard/automations/new`.

### 3. Install Chromium for the worker

Install ran with `PUPPETEER_SKIP_DOWNLOAD=true`, so **no browser is present**.

```bash
pnpm --filter @msgflow/worker exec puppeteer browsers install chrome
```

Then Dashboard → WhatsApp → **Connect** → scan the QR. This is the single least-verified path in the
system: the whatsapp-web.js event wiring, QR rendering and group discovery have never executed.

### 4. Verify the end-to-end acceptance flow

Once WhatsApp is connected: monitor a group → send a real message → confirm it appears in
`/dashboard/messages` within seconds → confirm a record appears → connect an Excel output → **Sync
Now** → download the file and open it.

---

## P1 — Known gaps, deliberately left

Each is documented in the code and README; none is a surprise.

| Gap | Where | Notes |
|---|---|---|
| **Postgres RLS policies not created** | `docs/security.md` | Documented with example SQL, but **no migration writes them**. Application-layer isolation is in place and tested; RLS is the second layer and still needs a migration. |
| **S3 storage driver not implemented** | `packages/connectors/src/storage.ts` | Interface exists; `STORAGE_DRIVER=s3` throws deliberately. **The local driver is ephemeral on Vercel** — generated Excel files will not survive. This is the one thing that will bite a clean Vercel deploy. |
| **Rate limiter is in-process** | `apps/web/src/lib/api.ts` | Correct for one instance. Multi-instance needs Redis/Upstash. |
| **No outbound email** | `app/(auth)/actions.ts` | Password reset returns the link in the UI in development, clearly labelled. Production needs a mail transport. |
| **Payment processing not wired** | `/dashboard/billing` | Plans, limits and usage are tracked and enforced; no provider connected. |
| **Google Sheets needs credentials** | `packages/connectors/src/sheets.ts` | Fully implemented; runs in mock mode without keys and says so in the UI. |

---

## P2 — Deprecations to clear before they break

| Warning | Action |
|---|---|
| `package.json#prisma` config is deprecated, removed in Prisma 7 | Migrate to `prisma.config.ts` |
| `next lint` deprecated, removed in Next 16 | `npx @next/codemod@canary next-lint-to-eslint-cli .` |
| Vite CJS Node API deprecation in vitest output | Cosmetic; clears on the next vitest major |

---

## Context a new session will not otherwise have

### Requirements provenance

- **Sections 81–133** of the product spec are captured verbatim in
  [`docs/requirements/81-133-output-sync-and-scheduling.md`](docs/requirements/81-133-output-sync-and-scheduling.md).
- **Sections 1–80 were never written to disk.** They were supplied in an earlier session and exist
  only in that conversation. If they matter, they need to be re-supplied.

### Two architecture documents exist

- [`docs/architecture.md`](docs/architecture.md) — **authoritative**, describes what was built.
- [`docs/architecture/00-overview.md`](docs/architecture/00-overview.md) — the earlier design note,
  written before implementation. Kept for its rationale; model names differ from the final schema.

### Decisions that were made explicitly

- **Auth is email + password only.** The user asked for this directly: no Google, no social sign-in.
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` exist *solely* for the Sheets data connector and must
  never be wired into sign-in.
- **`.xlsm` is rejected outright** rather than silently destroying macros.
- **No "merge automatically" option on sync conflicts** — the user chooses which side wins.
- **AI-drafted automations are never auto-activated.**
- **`allowDelete` on outputs is human-only**; no AI output can flip it.

### Load-bearing invariants — do not break these

1. **Only `apps/worker/src/providers/whatsapp-web.ts` may import `whatsapp-web.js`.** Everything else
   speaks `MessageProvider`. This is what makes the official Cloud API a one-file addition.
2. **Messages are committed to Postgres before any AI runs.** The durability boundary is in
   `/api/worker/messages`.
3. **Records are folded from `RecordFieldEvent`, ordered by the message's own `timestamp`** — never
   overwritten. Superseded events are stored `applied: false`, never deleted.
4. **Duplicate prevention is database-enforced** (two unique constraints on `Message`, one on
   `ExtractedRecord.naturalKeyHash`), not application logic.
5. **Cursors advance only on a fully successful run** (`workflow/src/engine.ts`).
6. **Excel is edited in place, never rebuilt**; formula cells are never overwritten.
7. **Action conditions use a purpose-built evaluator, not `eval`** — those strings are user input
   reaching the workflow engine.

### Build gotchas already solved (don't re-break)

- `next.config.mjs` sets `resolve.extensionAlias` so webpack resolves the workspace packages' `.js`
  import specifiers to `.ts` source. Removing it breaks the build.
- `serverExternalPackages` (not the old `experimental.serverComponentsExternalPackages`) keeps
  exceljs/pdfkit/pptxgenjs/googleapis out of the bundle.
- The NextAuth `session` callback **spreads** `session.user` rather than replacing it, because
  NextAuth intersects the type with `AdapterUser`.
- `exceljs` is a root devDependency so `tests/excel.test.ts` can resolve it under pnpm's isolated
  node-linker.
- `pnpm-workspace.yaml` `allowBuilds` must keep Prisma's entries `true`, or the client cannot
  generate.

---

## Verification command

```bash
pnpm validate    # db:generate → typecheck → lint → test → build
```

All green as of this handoff. If it is not green in a new session, something in the environment
changed — check `.env` exists in the repo root, `apps/web/` and `apps/worker/`.

---

## Where things live

```
apps/web        Next.js — dashboard, API, auth        → Vercel
apps/worker     whatsapp-web.js + Puppeteer           → Railway/Render/Fly/Docker
packages/       config logger types validation db ai connectors workflow
docs/           13 guides — start with README.md
docker/         worker image + local compose
tests/          107 tests, no DB or network required
```
