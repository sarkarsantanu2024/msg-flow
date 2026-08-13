# Troubleshooting

## Setup

**`Environment variable not found: DATABASE_URL`**
Prisma reads `packages/db/.env` or the process environment. Copy your `.env` there, or export the
variable before running Prisma commands.

**`P1001: Can't reach database server`**
Postgres is not running, or Neon needs `?sslmode=require` on the connection string.

**Prisma migration hangs or errors on Neon**
Migrations need `DIRECT_URL` — the non-pooled endpoint. A pooler cannot run DDL reliably.

**`Module not found: Can't resolve './env.js'` during build**
The workspace packages are ESM TypeScript importing siblings with an explicit `.js` extension.
`next.config.mjs` sets `resolve.extensionAlias` so webpack resolves that to the `.ts` source. If you
add a new consumer of these packages, make sure it uses the same alias.

**pnpm refuses to run install scripts**
pnpm 11 requires explicit approval. `pnpm-workspace.yaml` already allow-lists what MsgFlow needs. To
skip the Chromium download: `PUPPETEER_SKIP_DOWNLOAD=true pnpm install`.

## WhatsApp

**Worker shows OFFLINE**
It has not sent a heartbeat in 45 seconds. Check the process is running, that `APP_URL` points at the
web app, and that `WHATSAPP_WORKER_SECRET` matches on both sides. `curl http://localhost:4000/health`
confirms the worker itself is alive.

**"The WhatsApp worker is not reachable"**
`WHATSAPP_WORKER_URL` is wrong, or the worker is down. In Docker, the app reaches the worker at the
service name, not `localhost`.

**QR never appears**
Chromium failed to start. Check the worker logs. On Linux you usually need the system package plus
`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`. In Docker, set `--shm-size=1gb` — the 64 MB default
crashes Chromium.

**QR expires before I can scan**
It refreshes roughly every 60 seconds and the page polls every 3 seconds. Press **Refresh QR** for a
new one.

**Connection drops repeatedly**
WhatsApp allows a limited number of linked devices; check whether the account is linked elsewhere. A
worker that sleeps (free-tier hosting) will drop the session — disable auto-stop.

**Reconnect loses the session and asks for a new QR**
`WORKER_SESSION_PATH` is not persisted. Mount a volume at that path.

**Messages are not arriving**
In order: is the connection `READY`? Is the group **monitored**? Only group messages are captured —
direct chats are out of scope. Check the worker logs for "Flushed messages".

## AI

**"No AI key configured — using the built-in rule-based provider"**
Working as designed. Set `AI_PROVIDER` and the matching key to use a model.

**`AI_FAILED` errors**
Rate limits and overloads are retried automatically with backoff. Persistent failures usually mean an
invalid key or an exhausted quota — the Usage screen shows recent failures.

**Extraction returns nothing**
Check the extraction reasoning on the message row. Common causes: required fields the message does
not actually state, a schema asking for more than the messages contain, or a confidence threshold set
too high. Demo Mode is the fastest way to iterate on a schema.

**Everything lands in the review queue**
The confidence threshold is too high for your message quality, or required fields are frequently
absent. Lower `minConfidence`, or make fields optional.

## Automations

**Automation runs but processes zero messages**
Check, in order: the group is monitored; `requireImportant` is not filtering everything out; the
processing window actually covers the messages; the messages are not already `EXTRACTED` (use
**Reprocess** with force, or a `CUSTOM` window).

**"Select at least one WhatsApp group before activating"**
The automation has no enabled trigger with a group.

**"Connect at least one output before activating"**
Extracted data would have nowhere to go, so activation is refused rather than producing a
silently-useless automation.

**Scheduled automation never fires**
`nextRunAt` is null, or nothing is calling `/api/cron/tick`. Either run the worker with
`SCHEDULER_ENABLED=true`, or configure Vercel Cron. Check the automation is `ACTIVE`.

**Runs fire at the wrong time**
Schedules use the automation's timezone, falling back to the tenant's. Check both in Settings.

## Outputs

**"The output file has changed since the last synchronization"**
Someone edited the file outside MsgFlow. Nothing was written and nothing is lost. Choose **Use the
latest file**, **Keep MsgFlow's data**, or dismiss. See
[excel-sync.md](excel-sync.md#conflict-protection).

**UPSERT is creating duplicates instead of updating**
The unique key does not match. Check the Mapping tab: the key columns must contain the same values
the extraction produces. A common cause is a date column formatted as text in one place and a date in
the other.

**"UPDATE and UPSERT need at least one field marked as part of the unique key"**
Working as designed — without a key, every message would append a duplicate to your master file.

**Formulas were not updated**
Also working as designed. MsgFlow never overwrites a formula cell with a value; the run reports how
many it skipped. Your spreadsheet logic outranks our data.

**Pivot tables show stale numbers**
Pivots are not recalculated by a sync. Refresh them in Excel. This is flagged before activation.

**"Macro-enabled workbooks (.xlsm) are not supported"**
Macros cannot be preserved through a programmatic write, so the upload is refused rather than
silently destroying them. Save as `.xlsx`.

**Google Sheets sync reports success but the sheet is unchanged**
It is running in mock mode — no Google credentials. The UI labels this. Add credentials on the
Integrations page.

**Downloaded file is missing after a redeploy**
The local storage driver writes to the filesystem, which is ephemeral on Vercel. See
[deployment.md](deployment.md#2-web-app--vercel).

## Data

**Duplicate records**
Check the natural key: `ExtractionField.isKeyField` decides record identity. Too few key fields
merges distinct records; too many splits one record into several.

**A record shows an old value**
Field history on the record page shows every event and whether it was applied. A value recorded with
`applied = false` was superseded by a message with a _later_ send time.

**Edited a record but the output did not change**
Editing marks the sync state stale; the change lands on the next sync. Use **Sync Now** to apply it
immediately.

## Performance

**Slow message list**
Add filters. The indexes lead with `(tenantId, timestamp)`, so a date range is the cheapest filter.

**High AI costs**
Use `SINCE_LAST_SUCCESSFUL_RUN`, keep `requireImportant` on, and add a keyword filter. Classification
is cached per message; extraction runs per (message × automation), so overlapping automations on the
same group multiply cost.

**Worker memory grows**
Chromium. Give it 1 GB+, and restart on a schedule if you run many sessions on one worker.

## Diagnostics

```bash
curl https://msg-flow.vercel.app/api/health     # every layer
curl http://localhost:4000/health         # worker liveness
pnpm db:studio                            # browse the data
LOG_LEVEL=debug pnpm worker:dev           # verbose worker logs
pnpm validate                             # generate → typecheck → lint → test → build
```

Logs are JSON lines with a `scope` field: `worker`, `provider:whatsapp-web`, `api:ingest`,
`workflow:engine`, `connector:excel`, and so on. Secrets are redacted at any depth.
