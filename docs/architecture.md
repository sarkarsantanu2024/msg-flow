# Architecture

```
                    ┌──────────────────────┐
                    │       VERCEL         │
                    │   Next.js dashboard  │
                    │   + API routes       │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │        NEON          │
                    │  PostgreSQL + Prisma │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   WORKFLOW ENGINE    │
                    │      AI ENGINE       │
                    └──────────▲───────────┘
                               │
                        normalized messages
                               │
                    ┌──────────┴───────────┐
                    │   WHATSAPP WORKER    │
                    │  whatsapp-web.js     │
                    │  Puppeteer           │
                    └──────────────────────┘
```

## The conceptual model

Not `WhatsApp → AI → Export`, but:

```
WhatsApp → Message DB → AI → Structured Records → Automation → Output Synchronization
```

Two things are the source of truth: the **normalized message** and the **structured record**.
Everything downstream — an Excel file, a Google Sheet, a client API — is a *projection* MsgFlow keeps
in step. This is the difference between a product that maintains business data and one that exports
it.

Three consequences shape the whole system:

1. A structured record **outlives** any single message. `Message ⇄ Record` is many-to-many, because
   "ABC Traders / Product X" accumulates across weeks of chatter.
2. A record's identity is a **natural key**, not a row number. Row numbers belong to
   `OutputSyncRecord`, one per (record, output).
3. Rebuilding any output must be possible from the database alone. If it isn't, the design is wrong.

## Two applications

| | `apps/web` | `apps/worker` |
|---|---|---|
| Runtime | Next.js on Vercel | Persistent Node process |
| Holds | Dashboard, API, auth, DB access, workflow + AI engines | WhatsApp sessions only |
| Scale | Serverless, stateless | Long-lived, stateful |
| Why separate | — | whatsapp-web.js drives a headless browser and holds a session that cannot survive being frozen between invocations |

The worker never touches the database. It normalizes messages and POSTs them to the web app, which
owns all persistence. That keeps database credentials off the WhatsApp host and means the worker can
be deployed anywhere without database networking.

## Request paths

**Live capture**

```
WhatsApp message
  → worker: normalize → buffer (2s / 100 msg batches)
  → POST /api/worker/messages
  → COMMIT to PostgreSQL          ← durability boundary
  → respond to worker
  → (async) classify → extract → fold into record → sync outputs
```

The commit happens *before* any AI work. A slow model must never make the worker retry an
already-stored message.

**Scheduled run**

```
worker ticker (or Vercel Cron) → POST /api/cron/tick
  → runDueAutomations()
  → per automation: resolveWindow() → select messages → classify → extract → actions
```

## Packages

| Package | Responsibility |
|---|---|
| `config` | Environment parsing, shared constants, honest Excel capability lists |
| `logger` | Structured JSON with secret redaction |
| `types` | `MessageProvider`, `AIProvider`, `OutputConnector`, `AppError` |
| `validation` | Zod schemas, plus **runtime** schemas built from a tenant's field definitions |
| `db` | Prisma client, tenancy helpers, AES-256-GCM credential encryption, audit, usage |
| `ai` | Provider abstraction + prompts + JSON recovery + coercion |
| `connectors` | Storage, mapping engine, and one connector per output type |
| `workflow` | Windows, scheduling, record folding, sync engine, health |

Dependencies flow one way: `config/logger/types` ← `validation/db` ← `ai/connectors` ← `workflow` ←
`apps`.

## Provider independence

`packages/types/src/messaging.ts` defines `MessageProvider` and `NormalizedMessage`. Exactly one file
implements it against whatsapp-web.js. Adding the official WhatsApp Business Platform means writing
`apps/worker/src/providers/whatsapp-cloud.ts` — no changes anywhere else, because nothing downstream
knows which provider produced a message.

## Record folding

Extraction does not overwrite a record. It emits **field events**:

```
ExtractionRun ──► RecordFieldEvent { fieldKey, newValue, eventAt = message.timestamp }
                        │
                        ▼          fold, ordered by eventAt
                  ExtractedRecord.data   (materialized view)
```

Ordering is by when the message was **sent**, not when it was processed. A late-arriving older
message is stored with `applied = false` and `skipReason = 'superseded'`: visible in history, not
folded. Nothing is ever deleted.

## Output synchronization

Three things make maintaining an existing 15,000-row file practical:

1. **`OutputSyncRecord.externalRowId`** — after the first sync we know which row each record owns, so
   an update is a direct write.
2. **`syncVersion` vs `record.version`** — unchanged records are skipped without touching the target.
3. **Checksum comparison before writing** — a file edited outside MsgFlow raises `SYNC_CONFLICT`
   rather than being overwritten.

## Health

```
Database → Worker → WhatsApp → Group Listener → Queue → AI → Workflow → Outputs
```

Liveness is heartbeat-based. A worker whose last heartbeat is older than 3× the interval is `DOWN`
regardless of the status it last wrote — a crashed process cannot report its own death. The dashboard
status bar polls every 10 seconds and shows "checking…" rather than a stale green when a poll fails.
