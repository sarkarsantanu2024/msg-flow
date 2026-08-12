# Worker

A persistent Node service that owns WhatsApp sessions. It is the only part of MsgFlow that cannot be
serverless.

## What it does

- Runs whatsapp-web.js + Puppeteer, one session per connection
- Normalizes messages into `NormalizedMessage`
- Buffers and batches them to the web app
- Reports connection state changes
- Discovers groups
- Sends a heartbeat every 15 seconds
- Ticks the scheduler every 60 seconds

## What it deliberately does not do

- **Touch the database.** All persistence belongs to the web app. That keeps database credentials off
  the WhatsApp host and means the worker can be deployed anywhere without database networking.
- **Run AI.** No API keys live here.
- **Decide anything about tenants.** It relays; the web app authorizes.

## Running

```bash
pnpm worker:dev     # with reload
pnpm worker:start   # plain
```

### Configuration

```env
APP_URL="http://localhost:3000"
WHATSAPP_WORKER_SECRET="must-match-the-web-app"
WORKER_PORT="4000"
WORKER_NAME="worker-local"
WORKER_SESSION_PATH="./.sessions"
HEARTBEAT_INTERVAL_MS="15000"
PUPPETEER_HEADLESS="true"
# PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"
SCHEDULER_ENABLED="true"
SCHEDULER_INTERVAL_MS="60000"
```

## Control API

Authenticated with `Authorization: Bearer $WHATSAPP_WORKER_SECRET`, except `/health`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness — unauthenticated, for container health checks |
| `GET` | `/connections` | Sessions this worker owns |
| `GET` | `/connections/:id/status` | Full provider status |
| `POST` | `/connections/:id/connect` | Start a session |
| `POST` | `/connections/:id/reconnect` | Restart, keeping the stored session |
| `POST` | `/connections/:id/refresh-qr` | Force a fresh QR |
| `POST` | `/connections/:id/disconnect` | Stop, keeping the session |
| `POST` | `/connections/:id/logout` | Destroy the session |
| `POST` | `/connections/:id/sync-groups` | Re-discover groups |

`connect`, `reconnect` and `refresh-qr` return immediately and report progress through connection
state callbacks — `initialize()` can take 30+ seconds while Chromium boots, and the HTTP caller
should not block on it.

## Message batching

Messages are buffered and flushed every 2 seconds or every 100 messages, whichever comes first.

A busy group arrives in bursts; one HTTP request per message would be slow and rate-limit bait. A
batch that fails to deliver **stays in the buffer** and is retried after a 10-second backoff, so a
temporary outage in the web app does not lose captured messages.

The buffer is capped at 5,000 messages per connection. Overflow drops the oldest and logs an error —
loudly, because silent loss is the failure mode that matters.

## Heartbeats

Every 15 seconds the worker reports name, host, pid, version, CPU, memory, uptime, connection count,
messages seen and queue depth.

**The web app treats a worker with no heartbeat in 45 seconds as offline**, regardless of the status
it last wrote. A crashed process cannot report its own death, so absence of a heartbeat — not
presence of an error — is the signal.

On `SIGTERM`/`SIGINT` the worker reports `OFFLINE` before exiting, so an intentional stop is
reflected immediately rather than after the heartbeat goes stale.

## Shutdown

1. Stop the heartbeat and scheduler timers
2. Report `OFFLINE`
3. Flush every message buffer
4. Destroy each WhatsApp client
5. Close the HTTP server
6. Hard exit after 15 seconds if a Chromium instance refuses to die

## Sessions

Stored under `WORKER_SESSION_PATH`, one directory per connection.

**Persist this path in production.** A Docker volume or mounted disk. Without it, every deploy forces
a new QR scan.

Session data is authentication material: git-ignored, never sent to the browser, never logged.

## Deployment

See [deployment.md](deployment.md). Essentials:

- At least **1 GB RAM** — Chromium is memory-hungry
- `--shm-size=1gb` in Docker; the 64 MB default crashes Chromium
- Persistent volume for sessions
- Do not let the host sleep or auto-stop — a stopped worker is a disconnected WhatsApp

## Running several workers

Each needs a distinct `WORKER_NAME`. Connections are pinned to the worker that owns them, so a
control call must reach the right one. For multi-worker deployments, route by connection or give each
worker its own hostname and set `WHATSAPP_WORKER_URL` per tenant.

## Adding a provider

`whatsapp-web.js` is imported in exactly one file. To add the official WhatsApp Business Platform:

1. Write `src/providers/whatsapp-cloud.ts` implementing `MessageProvider`.
2. Select it in `ConnectionManager.getOrCreate()` based on the connection's provider field.

Nothing else changes — the connection manager, batching, heartbeat and the entire web app already
speak the interface.
