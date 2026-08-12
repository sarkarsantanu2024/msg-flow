# API

All routes return:

```jsonc
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "code": "...", "message": "...", "retryable": false } }
```

Unknown errors always become a generic 500 — SQL text, file paths and stack traces never reach a
response.

| Code | Status |
|---|---|
| `UNAUTHENTICATED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `CONFLICT` / `SYNC_CONFLICT` | 409 |
| `VALIDATION_FAILED` | 422 |
| `RATE_LIMITED` | 429 |
| `AI_FAILED` / `SHEETS_FAILED` / `WEBHOOK_FAILED` / `API_FAILED` | 502 |
| `WORKER_UNAVAILABLE` / `WHATSAPP_DISCONNECTED` / `DATABASE_FAILED` | 503 |
| `INTERNAL` | 500 |

Validation failures include a `fields` map for form display.

## Authentication

Interactive routes use the session cookie. Worker and scheduler routes use
`Authorization: Bearer $WHATSAPP_WORKER_SECRET`, compared in constant time.

---

## Status and health

| Method | Route | Notes |
|---|---|---|
| `GET` | `/api/health` | **Public.** Layer states only — no counts or tenant details |
| `GET` | `/api/status` | Session. Health + WhatsApp summary + counters. Polled every 10s |

## Auth

| Method | Route | Notes |
|---|---|---|
| `*` | `/api/auth/[...nextauth]` | NextAuth — credentials provider only |

Signup, forgot-password and reset-password are server actions in `app/(auth)/actions.ts`.

## Tenant

| Method | Route | Permission |
|---|---|---|
| `POST` | `/api/tenant` | Session — create a workspace |
| `POST` | `/api/tenant/switch` | Session — membership verified before the cookie is written |
| `PATCH` | `/api/settings` | `tenant:manage` — a timezone change reschedules automations |
| `GET/POST/PATCH/DELETE` | `/api/team` | `members:manage` |
| `POST` | `/api/notifications/read-all` | Session |

## WhatsApp

| Method | Route | Permission |
|---|---|---|
| `GET` | `/api/whatsapp` | `whatsapp:read` |
| `POST` | `/api/whatsapp` | `whatsapp:manage` |
| `POST` | `/api/whatsapp/[id]/action` | `whatsapp:manage` — `connect`, `reconnect`, `disconnect`, `logout`, `refresh-qr`, `sync-groups` |
| `PATCH` | `/api/groups/[id]` | `groups:manage` — toggle monitoring |

## Worker → app

| Method | Route | Notes |
|---|---|---|
| `POST` | `/api/worker/heartbeat` | Liveness + resource metrics |
| `POST` | `/api/worker/connection` | Connection state change |
| `PUT` | `/api/worker/connection` | Group discovery results |
| `POST` | `/api/worker/messages` | **Message ingestion — the durability boundary** |

Ingest accepts up to 500 messages per request, commits before any AI work, and reports
`{ received, stored, duplicates, skipped, errors }`.

## Messages and records

| Method | Route | Permission |
|---|---|---|
| `GET` | `/api/messages/[id]` | `messages:read` — includes classification and produced records |
| `POST` | `/api/messages/[id]` | `messages:reprocess` — `reprocess`, `ignore`, `assign` |
| `GET` | `/api/records/[id]` | `records:read` — **full lineage** |
| `PATCH` | `/api/records/[id]` | `records:edit` — validated; marks outputs stale |
| `POST` | `/api/records/[id]` | `records:review` — `approve`, `edit_approve`, `reject`, `reprocess` |
| `DELETE` | `/api/records/[id]` | `records:delete` |

## Automations

| Method | Route | Permission |
|---|---|---|
| `GET/POST` | `/api/automations` | `automations:read` / `manage` — always created as DRAFT |
| `GET/PATCH/DELETE` | `/api/automations/[id]` | DELETE archives; runs and records are kept |
| `POST` | `/api/automations/[id]/status` | `activate`, `pause`, `resume`, `archive`, `duplicate` |
| `POST` | `/api/automations/[id]/run` | Runs the full pipeline now |
| `POST` | `/api/automations/generate` | Returns a **draft only** — nothing is created or activated |

Activation is refused without a source group, an output, and a unique key for UPDATE/UPSERT.

## Outputs

| Method | Route | Permission |
|---|---|---|
| `GET/POST` | `/api/outputs` | `outputs:read` / `manage` |
| `POST` | `/api/outputs/preview` | `outputs:manage` — upload an existing workbook, get real columns |
| `GET/PATCH/DELETE` | `/api/outputs/[id]` | |
| `POST` | `/api/outputs/[id]/sync` | `outputs:sync` — **Sync Now** |
| `GET` | `/api/outputs/[id]/download` | `?version=N` for a historical version |
| `GET/POST` | `/api/outputs/[id]/versions` | POST restores; the current file is snapshotted first |
| `POST` | `/api/outputs/[id]/conflict` | `USE_LATEST_FILE`, `KEEP_AUTOMATION_VERSION`, `IGNORED` |
| `POST` | `/api/outputs/[id]/retry` | Retry only the failed rows |
| `POST/DELETE` | `/api/output-targets` | Connect an automation to an output with its mapping |

Sync Now returns:

```json
{
  "status": "SUCCESS",
  "messagesProcessed": 245,
  "recordsCreated": 38, "recordsUpdated": 91, "recordsSkipped": 112, "recordsFailed": 4,
  "rowsCreated": 38, "rowsUpdated": 91, "rowsSkipped": 112, "rowsFailed": 4,
  "warnings": [], "errors": []
}
```

## Integrations, exports, demo

| Method | Route | Permission |
|---|---|---|
| `GET/POST/DELETE` | `/api/integrations` | `integrations:manage` — credentials never returned |
| `GET/POST` | `/api/exports` | `exports:create` — capped at 10,000 rows, and says so |
| `GET` | `/api/exports/[id]` | Download |
| `POST` | `/api/demo` | `automations:read` — full pipeline; `persist: false` writes nothing |

## Scheduler

| Method | Route | Auth |
|---|---|---|
| `POST/GET` | `/api/cron/tick` | Worker secret, or Vercel's cron header |

## Platform admin

| Method | Route | Auth |
|---|---|---|
| `PATCH` | `/api/admin/tenants/[id]` | Super admin — suspending also pauses every automation |

## Rate limits

Per tenant, sliding window: auth 10/min · API 120/min · ingest 1,000/min · AI 60/min.
In-process — see [security.md](security.md#rate-limiting).
