# Deployment

Two applications, deployed separately, for one reason: whatsapp-web.js drives a headless browser and
holds a long-lived session. That cannot run as a serverless function.

```
Vercel (Next.js)  ←→  Neon (PostgreSQL)  ←→  Railway/Render/Fly/VPS (worker)
```

## 1. Database — Neon

1. Create a project at [neon.tech](https://neon.tech).
2. Copy both connection strings: the **pooled** one and the **direct** one.

```env
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/msgflow?sslmode=require"
DIRECT_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/msgflow?sslmode=require"
```

Prisma migrations need the direct connection — a pooler cannot run DDL reliably.

```bash
pnpm --filter @msgflow/db exec prisma migrate deploy
```

Then enable row-level security (see [security.md](security.md#database-level-enforcement)).

## 2. Web app — Vercel

**Project settings**

| Setting | Value |
|---|---|
| Root directory | `apps/web` |
| Framework | Next.js |
| Build command | `cd ../.. && pnpm --filter @msgflow/db generate && pnpm --filter @msgflow/web build` |
| Install command | `pnpm install` |
| Node version | 22.x |

**Environment variables**

```
DATABASE_URL, DIRECT_URL
AUTH_SECRET                 # openssl rand -base64 32
APP_URL                     # https://your-app.vercel.app
ENCRYPTION_KEY              # openssl rand -base64 32
WHATSAPP_WORKER_URL         # https://your-worker.up.railway.app
WHATSAPP_WORKER_SECRET      # openssl rand -hex 24 — must match the worker
AI_PROVIDER                 # anthropic | openai | gemini | mock
ANTHROPIC_API_KEY           # or OPENAI_API_KEY / GEMINI_API_KEY
WEBHOOK_SECRET
GOOGLE_CLIENT_ID            # optional — Sheets connector only, never sign-in
GOOGLE_CLIENT_SECRET
```

Generate `AUTH_SECRET` and `ENCRYPTION_KEY` fresh. Never reuse the values from `.env.example`.

**Vercel Cron** — add to `apps/web/vercel.json` if you want Vercel to drive the schedule instead of
the worker:

```json
{ "crons": [{ "path": "/api/cron/tick", "schedule": "*/5 * * * *" }] }
```

Then set `SCHEDULER_ENABLED=false` on the worker so the schedule is not driven twice.

**Storage note.** The default local storage driver writes to the filesystem, which is ephemeral on
Vercel. Generated Excel files will not survive between invocations. For production either run the
web app somewhere with a persistent disk, or implement the S3 driver behind the existing
`StorageDriver` interface (`packages/connectors/src/storage.ts`). This is stated plainly because it
is the one thing that will bite an otherwise-clean Vercel deployment.

## 3. Worker

Chromium needs ~1 GB of RAM. Anything smaller will OOM under real traffic.

### Railway

1. New service from the repo.
2. Dockerfile path: `docker/worker.Dockerfile`.
3. Variables:

```
APP_URL=https://your-app.vercel.app
WHATSAPP_WORKER_SECRET=<same as the web app>
WORKER_NAME=worker-production
WORKER_PORT=4000
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
PUPPETEER_HEADLESS=true
SCHEDULER_ENABLED=true
```

4. **Attach a volume at `/app/apps/worker/.sessions`.** Without it, every deploy forces a new QR
   scan.
5. Memory: at least 1 GB.

### Render

Same image and variables. Add a persistent disk mounted at `/app/apps/worker/.sessions`. Use the
Standard plan or higher — the free tier sleeps, and a sleeping worker is a disconnected WhatsApp.

### Fly.io

```toml
[[mounts]]
  source = "worker_sessions"
  destination = "/app/apps/worker/.sessions"

[[vm]]
  memory = "1gb"
```

Set `auto_stop_machines = false`. A stopped machine drops the WhatsApp session.

### VPS with Docker

```bash
docker build -f docker/worker.Dockerfile -t msgflow-worker .

docker run -d --name msgflow-worker \
  --restart unless-stopped \
  --shm-size=1gb \
  -p 4000:4000 \
  -v msgflow-sessions:/app/apps/worker/.sessions \
  -e APP_URL=https://your-app.vercel.app \
  -e WHATSAPP_WORKER_SECRET=your-secret \
  msgflow-worker
```

`--shm-size=1gb` matters: Chromium crashes with the Docker default of 64 MB.

## 4. Verify

```bash
curl https://your-app.vercel.app/api/health     # every layer reported
curl https://your-worker-host/health            # worker liveness
```

Then in the dashboard: the status bar should show WhatsApp, Worker, AI, Database, Workflow and
Outputs. Connect WhatsApp and scan the QR.

## Scaling

- **Web** scales horizontally on Vercel with no changes, except the rate limiter (see
  [security.md](security.md#rate-limiting)).
- **Worker**: one process can hold several WhatsApp sessions, but each costs a Chromium instance.
  Run one worker per few tenants and give each a distinct `WORKER_NAME`; connections are pinned to
  the worker that owns them.
- **Database**: `Message` and `RecordFieldEvent` grow fastest. Partition by month once volume
  justifies it — the `(tenantId, timestamp)` and `(tenantId, recordId, eventAt)` indexes are already
  partition-friendly.

## Backups

Neon provides point-in-time restore. Test a restore before you need one.

Storage (generated Excel files and uploaded workbooks) is separate from the database. Back it up too
— the database can rebuild an output's *content*, but not the specific historical file bytes a
customer downloaded.
