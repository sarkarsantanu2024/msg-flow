# msg-flow — Data Model & Architecture

> NOTE: this was the pre-implementation design note. The schema it describes now lives at
> `packages/db/prisma/schema.prisma`, and the authoritative architecture guide is
> [`docs/architecture.md`](../architecture.md). Kept for the design rationale.
>
> Companion to [`packages/db/prisma/schema.prisma`](../../packages/db/prisma/schema.prisma) and
> [requirements 81–133](../requirements/81-133-output-sync-and-scheduling.md).

## 1. The shape of the system

```
WhatsApp  →  Message DB  →  AI  →  Structured Records  →  Automation  →  Output Sync
             (truth)                   (truth)                            (targets)
```

Two things are the source of truth: the **normalized message** and the **structured
record**. Everything downstream — an Excel file, a Google Sheet, a client API — is a
*projection* that the platform keeps in step. This is the difference between a product
that maintains business data and one that exports it.

Consequences that shape the whole model:

- A structured record **outlives** any single message. `Message → Record` is many-to-many
  (`RecordSource`), because "ABC Traders / Product X" accumulates across weeks of chatter.
- A record's identity is a **natural key**, not a row number. Row numbers belong to
  `OutputRecordSync`, one per (record, target).
- Rebuilding an output must always be possible from the database alone. If it isn't, the
  design is wrong.

## 2. Processes

| Process | Responsibility |
|---|---|
| **web** (Next.js App Router) | Dashboard, configuration APIs, SSE/polling for live status. Never does long work inline. |
| **worker: whatsapp** | Owns provider sessions. One session pinned to one worker; heartbeats to `WhatsAppConnection`. Ingests → `Message`, then enqueues. |
| **worker: ai** | Classification and extraction. Writes `MessageClassification`, `ExtractionRun`, `RecordFieldEvent`. |
| **worker: workflow** | Resolves processing windows, runs `AutomationRun`, executes ordered `AutomationAction`s. |
| **worker: output** | Output connectors. Reads/writes Excel, Sheets, REST; owns conflict detection and versioning. |
| **scheduler** | Single-leader cron ticker; enqueues due automations and target syncs. |

Queues: BullMQ over Redis — `ingest`, `classify`, `extract`, `automation`, `output-sync`,
`notify`. Each job carries `tenantId` and is idempotent by construction (see §6).

Workers are separate from web because whatsapp-web.js drives a headless browser: it is
memory-heavy, stateful, and must not be restarted by a web deploy.

## 3. Tenancy

Every tenant-scoped table has `tenantId` as the leading index column. Two layers of
enforcement:

1. **Application** — all DB access goes through a request-scoped Prisma client with a
   `tenantId` bound at construction; repositories refuse queries without it.
2. **Database** — Postgres RLS policies keyed on `current_setting('app.tenant_id')`, set
   per transaction. This is what actually satisfies acceptance criterion §133.34; the
   application layer alone is one forgotten `where` clause from a breach.

Object storage keys are tenant-prefixed (`t/{tenantId}/…`) and served only via
short-lived signed URLs.

## 4. Ingestion & durability (§130)

```
provider event → normalize → dedupe → Message (COMMITTED) → enqueue classify
```

The commit happens **before** any AI work. A message is never lost because extraction
failed; it sits in `PENDING` and can be reprocessed (§101).

Deduplication is two-layered:
- `@@unique([connectionId, externalMessageId])` — the primary guard.
- `@@unique([tenantId, contentHash])` where `contentHash = sha256(chatId|sender|sentAt|body)`
  — covers manual import and providers that reissue ids.

Both are enforced by insert-with-`onConflict`-ignore, so a redelivered webhook is a no-op
rather than a duplicate. This is criterion §133.33 and it must hold at the database level,
not in application logic.

`ingestSource` distinguishes `LIVE` / `BACKLOG` / `MANUAL_IMPORT` (§129). The UI must state
plainly that historical recovery depends on provider access — whatsapp-web.js can
sometimes replay recent unread messages on reconnect, but there is no reliable history
fetch. Persisting on receipt is the only durable answer.

## 5. Extraction → record folding (§117)

Extraction does not overwrite a record. It emits **field events**:

```
ExtractionRun ──► RecordFieldEvent { fieldKey, newValue, eventAt = message.sentAt }
                        │
                        ▼
                  fold, ordered by eventAt
                        │
                        ▼
              StructuredRecord.data   (materialized view)
```

Given the spec's example — stock 100 at 10:00, 80 at 11:00, 75 at 12:00 — the fold yields
75 regardless of the order the messages were *processed*, because ordering is by `sentAt`.
A late-arriving 11:00 message after the 12:00 one is stored with `applied = false` and
`skipReason = "superseded"`: recorded, visible in history, not folded. Nothing is ever
deleted.

Per-field `UpdateStrategy` (§116) is applied at fold time:

| Strategy | Fold rule |
|---|---|
| `ALWAYS_UPDATE` | take the newest event |
| `UPDATE_IF_EMPTY` | take it only if current value is null/blank |
| `NEVER_UPDATE` | keep the origin value; record the event unapplied |
| `UPDATE_IF_NEWER` | apply only if `eventAt > record.lastEventAt` |
| `CUSTOM_RULE` | evaluate the configured expression |

Records below `ExtractionProfile.confidenceThreshold` land in `NEEDS_REVIEW` rather than
flowing to outputs.

## 6. Processing windows & incremental processing (§99, §100)

`resolveWindow(automation, now)` returns `[start, end)` computed **in the automation's
timezone** (falling back to the tenant's):

| Window | Resolution |
|---|---|
| `CURRENT_MESSAGE` | the triggering message only (real-time path) |
| `TODAY` / `YESTERDAY` | local day boundaries |
| `LAST_7_DAYS` | rolling 7×24h back from now |
| `THIS_WEEK` / `LAST_WEEK` | local Monday-start weeks |
| `THIS_MONTH` / `LAST_MONTH` | local calendar months |
| `CUSTOM` | `customWindowFrom` … `customWindowTo` |
| `PREVIOUS_RUN` | previous run's `windowStart` … `windowEnd` |
| `SINCE_LAST_SUCCESSFUL_RUN` | `lastSuccessfulRunAt` … now — **the default** |

The resolved window is written to `AutomationRun.windowStart/windowEnd` so a run stays
reproducible after the config changes.

Cursors (`lastProcessedAt`, `lastProcessedMessageId`, `lastSuccessfulRunAt`) advance
**only on `SUCCESS`**. A `PARTIAL_SUCCESS` leaves the cursor where it was so failures are
retried, and the per-message dedupe plus record natural key make re-scanning harmless.
Per-source cursors on `AutomationSource` prevent one stalled group from blocking others.

Message selection is a single indexed query — `(tenantId, sentAt)` and
`(tenantId, chatId, sentAt)` are the covering indexes:

```sql
WHERE tenantId = $1 AND chatId = ANY($2) AND sentAt >= $3 AND sentAt < $4
  AND state IN ('PENDING','CLASSIFIED')
```

Full history is never rescanned (§100) — cost, latency and token spend all depend on this.

## 7. Output synchronization

### Matching (§115)

The unique key comes from `FieldMapping` rows with `isKeyPart = true`, ordered by
`keyOrder`. Matching proceeds cheapest-first:

1. **`OutputRecordSync.externalRowId`** — we already own a row on this target. Free.
2. **Key lookup in the target** — build the composite key from mapped fields, find the row.
3. **No match** → INSERT (for `UPSERT` / `APPEND`) or fail the row (for `UPDATE_EXISTING`).

Step 1 is what makes a 15,000-row `Customer_Master.xlsx` cheap to maintain: after first
sync, the platform knows exactly which row each record owns, and re-scanning the sheet is
only a fallback.

`syncVersion` vs. `StructuredRecord.version` gives a free no-op filter — records that have
not changed since the last successful write are skipped, and land in `rowsSkipped`.

### Operations (§82)

| Operation | Behaviour |
|---|---|
| `CREATE_NEW` | fresh file each run, named from the window |
| `APPEND` | insert-only; no matching pass |
| `UPDATE_EXISTING` | match required; unmatched rows become `OutputRowFailure` |
| `UPSERT` | match → update, else insert |
| `REPLACE` | delete rows in the window's key range, then insert — scoped by window, never whole-file |
| `GENERATE_NEW_VERSION` | write to a new `OutputVersion`, prior file untouched |

### Excel writing (§125, §126) — the hard part

Never rebuild the workbook. Load it, write the specific cells, save. Concretely:

- `exceljs` preserves formulas, number formats, merged ranges and named ranges across a
  load/save cycle far better than SheetJS's community build; it is the default writer.
- The template's structure is profiled once on upload into `OutputTemplate.structure`
  (columns, formula cells, merged ranges, named ranges, hidden sheets, charts).
- Anything the writer cannot guarantee — pivot tables, charts bound to moving ranges,
  some conditional-formatting forms, macros in `.xlsm` — is recorded in
  `OutputTemplate.warnings` and shown **before activation**, per §126.
- Writes go to a temp copy, checksum it, then atomically swap and record an
  `OutputVersion`. A crash mid-write can never leave a truncated customer file.

Be honest in the UI about the limits here: "preserves formulas and formatting; charts and
pivot tables may need to be refreshed" is a true statement. A blanket promise is not.

### Conflict detection (§86)

Before writing, re-read the target's checksum and modified time and compare against
`OutputTarget.lastKnownChecksum` / `lastKnownModifiedAt`. On mismatch: abort the write,
create an `OutputConflict`, set target status `CONFLICT`, raise a `SystemEvent`, and offer
review / use-latest / keep-ours / merge.

This is strong for platform-stored files and best-effort for files the user edits in place
(OneDrive, local disk) — the spec's "where practical" is doing real work. Google Sheets
gives us a proper revision id, so detection there is exact.

Criterion §133.32 — *existing records must not be accidentally overwritten* — rests on
three things together: conflict detection, `NEVER_UPDATE`/`UPDATE_IF_EMPTY` field
strategies, and version snapshots that make any write reversible.

### Destructive operations (§88)

`allowDelete` defaults to false on every target and is settable only by a human through
the UI. No extraction output, condition expression, or AI-generated config can set it.
`DELETE` is not reachable from the automation path unless that flag is on.

## 8. Lineage (§118, §119)

The chain is fully materialized, so "Where did this data come from?" is a join, not a
reconstruction:

```
OutputRecordSync (sales.xlsx, row 128)
   └─ StructuredRecord (ABC Traders / Product X)
        └─ RecordSource ──► ExtractionRun (confidence 0.96, claude-sonnet-5)
                              └─ Message ("ABC Traders require 50kg Product X.")
                                   └─ Chat (Sales Team) · Contact (Rahul) · sentAt
```

`RecordFieldEvent` adds the field-level answer: not just where the record came from, but
which message set *this particular value*.

## 9. Health & connection status (§108–§113)

`HealthCheck` rows are written by each worker per layer of the hierarchy
(Worker → WhatsApp Client → Group Listener → Message Queue → AI Processor → Workflow
Engine → Output Connector). The dashboard reads the latest row per (layer, subject).

Liveness is heartbeat-based: `lastHeartbeatAt` older than 3× the heartbeat interval means
`DOWN` regardless of what the last status write claimed. A crashed worker cannot report
its own death, so absence of a heartbeat — not presence of an error — is the signal.

On disconnect: `ConnectionEvent` + `SystemEvent(WHATSAPP_CONNECTION_LOST)`, automations
move to *waiting for connection*, notifications fire if configured. Never continue
silently (§111).

## 10. Retention

Messages and `RecordFieldEvent` grow fastest. `Tenant.settings.retention` governs raw
payload/media pruning; `Message.rawPayload` and attachments are the first to go, while the
normalized row and the field-event history are kept — they are what reprocessing, audit and
lineage need. Partition `Message` and `RecordFieldEvent` by month once volume justifies it;
the `(tenantId, sentAt)` and `(tenantId, recordId, eventAt)` indexes are already
partition-friendly.

## 11. Open decisions

1. **Excel writer** — `exceljs` is the recommendation above. If `.xlsm` macro workbooks
   turn out to be a real client requirement, that needs a different (likely non-Node)
   approach; worth confirming before committing.
2. **Real-time debounce** — a burst of messages about one record would trigger a sync per
   message. Proposal: coalesce output syncs on a short window (~30s) per target.
3. **Sheets vs. Excel matching cost** — Google Sheets has no cheap random-row read; we
   either cache the key→row index per target or read the key column each sync. Caching
   wins above a few thousand rows.

## 12. Acceptance-test coverage (§133)

| Criteria | Where it lives |
|---|---|
| 1–3 connection & groups | `WhatsAppConnection`, `ConnectionEvent`, `Chat.isMonitored`, `HealthCheck` |
| 4–5 capture & storage | `Message` + dedupe uniques, commit-before-AI |
| 6–7 classify & extract | `MessageClassification`, `ExtractionRun`, `RecordType` |
| 8–13 automation & schedules | `Automation`, `TriggerType`, `ScheduleFrequency`, `ProcessingWindow` |
| 14–20 Excel & Sheets ops | `OutputTarget.operation`, `OutputTemplate`, connectors |
| 21 client API | `OutputTargetType.REST_API`, `Credential` |
| 22–23 mapping & keys | `FieldMapping.isKeyPart` / `keyOrder` |
| 24–26 sync now / last / next | `OutputSyncRun`, `lastSyncAt`, `nextSyncAt` |
| 27–28 history & versions | `OutputSyncRun`, `OutputVersion` |
| 29–30 failed rows & retry | `OutputRowFailure.retryable` |
| 31 lineage | `RecordSource`, `RecordFieldEvent`, `OutputRecordSync` |
| 32 no accidental overwrite | `OutputConflict`, `UpdateStrategy`, `OutputVersion` |
| 33 no duplicates | message uniques + `naturalKeyHash` unique |
| 34 tenant isolation | `tenantId` everywhere + Postgres RLS |
| 35 provider independence | `WhatsAppProvider` behind a connector interface |
