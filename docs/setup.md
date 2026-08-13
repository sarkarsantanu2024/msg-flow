# Local setup

## Requirements

- Node.js 20+ (22 recommended)
- pnpm 11 (`corepack enable && corepack prepare pnpm@11.15.1 --activate`)
- PostgreSQL 14+ — a local instance, Docker, or a Neon database
- Chromium — only needed to actually connect WhatsApp

## 1. Install

```bash
pnpm install
```

pnpm 11 asks for approval before running postinstall scripts. `pnpm-workspace.yaml` already
allow-lists what MsgFlow needs. To skip the ~150 MB Chromium download on a machine that will only run
the web app:

```bash
PUPPETEER_SKIP_DOWNLOAD=true pnpm install
```

Install the browser later with:

```bash
pnpm --filter @msgflow/worker exec puppeteer browsers install chrome
```

## 2. Environment

A `.env` with freshly generated secrets is already present. To regenerate:

```bash
cp .env.example .env
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 32   # → ENCRYPTION_KEY
openssl rand -hex 24      # → WHATSAPP_WORKER_SECRET
```

Copy the same file to `apps/web/.env` and `apps/worker/.env`, or export the variables globally.

### Database

**Neon** (recommended — matches production):

```env
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/msgflow?sslmode=require"
DIRECT_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/msgflow?sslmode=require"
```

`DATABASE_URL` is the pooled endpoint; `DIRECT_URL` is the direct one. Prisma migrations need the
direct connection — a pooler cannot run DDL reliably.

**Local Postgres via Docker:**

```bash
docker compose -f docker/docker-compose.yml up -d postgres
```

```env
DATABASE_URL="postgresql://msgflow:msgflow@localhost:5432/msgflow"
DIRECT_URL="postgresql://msgflow:msgflow@localhost:5432/msgflow"
```

## 3. Schema and seed

```bash
pnpm db:generate     # generate the Prisma client
pnpm db:push         # push the schema (fastest for local work)
pnpm db:seed         # demo workspace with a week of realistic data
```

Use `pnpm db:migrate` instead of `db:push` when you want a migration file.

The seed prints the demo credentials:

```
Email:    demo@msgflow.app
Password: msgflow-demo-2026
```

## 4. Run

```bash
pnpm dev            # https://msg-flow.vercel.app
```

Second terminal:

```bash
pnpm worker:dev     # http://localhost:4000
```

The worker registers itself on its first heartbeat; the dashboard status bar turns green within
about 15 seconds.

## 5. Try it without WhatsApp

Go to **Demo Mode** (`/dashboard/demo`), type a message, press **Run pipeline**. You will see
classification, extraction, schema validation and the exact output row that would be written — all
through the real code path, with no WhatsApp connection and no AI key required.

## AI providers

`AI_PROVIDER=mock` (the default) uses a built-in rule-based provider: no key, no cost, deterministic
results, and genuinely useful on Indian SMB message shapes.

To use a real model, set the provider and its key:

```env
AI_PROVIDER="anthropic"
ANTHROPIC_API_KEY="sk-ant-..."
```

If the selected provider has no key, MsgFlow falls back to the mock **and says so** in the status bar
and on the Settings page, rather than failing silently.

## Verify everything

```bash
pnpm validate    # generate → typecheck → lint → test → build
```

## Common problems

**`Environment variable not found: DATABASE_URL`** — Prisma reads `packages/db/.env` or the process
environment. Copy `.env` there, or export the variable.

**`P1001: Can't reach database server`** — Postgres is not running, or Neon needs `?sslmode=require`.

**Worker shows OFFLINE** — it has not sent a heartbeat. Check it is running, that `APP_URL` points at
the web app, and that `WHATSAPP_WORKER_SECRET` matches on both sides.

More in [troubleshooting.md](troubleshooting.md).
