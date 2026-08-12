# Database

PostgreSQL via Prisma. Schema: [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma).

Every tenant-owned table carries `tenantId` as the **leading** index column, so tenant-scoped queries
use an index and a missing filter is a visible mistake rather than a silent full scan.

## Identity and tenancy

| Model | Purpose |
|---|---|
| `User` | Email, bcrypt hash, `isSuperAdmin`, reset token |
| `Tenant` | Workspace. `timezone` drives every schedule and date filter |
| `Membership` | User ⇄ tenant with a `Role` |
| `Plan` / `Subscription` / `Usage` | Plans, limits and daily metering |

`Role` is `OWNER > ADMIN > OPERATOR > VIEWER`, mapped to permissions by a single matrix in
`packages/db/src/tenant.ts`.

## Capture

| Model | Notes |
|---|---|
| `WhatsAppConnection` | Provider, status, phone, heartbeat, transient QR, owning worker |
| `ConnectionEvent` | Every state transition — nothing happens silently |
| `WhatsAppGroup` | `isMonitored` gates the entire pipeline |
| `Message` | The durable record |

**`Message` carries two unique constraints, and both matter:**

- `(tenantId, externalId)` — the provider's own message id. The primary duplicate guard.
- `(tenantId, contentHash)` — `sha256(group|sender|timestamp|text)`. Covers manual and demo ingest,
  and providers that reissue ids.

Duplicate prevention is enforced by the database, not by application logic. A redelivered webhook is
a no-op rather than a duplicate row.

`timestamp` is the author's clock and is the **ordering authority** for record folding. `receivedAt`
is our capture clock, used for SLA and monitoring. Conflating them would break chronological
correctness whenever a message arrives late.

## AI

| Model | Notes |
|---|---|
| `MessageClassification` | One per message (unique), so classification runs once |
| `ExtractionSchema` / `ExtractionField` | The tenant-defined business entity |

`ExtractionField.isKeyField` marks the fields forming a record's natural identity.

## Structured records

`ExtractedRecord` is the durable business data, independent of any output.

- `naturalKey` — readable, e.g. `2026-08-12|abc traders|product x`
- `naturalKeyHash` — sha256, unique per `(tenantId, schemaId)`. **The duplicate guard for records.**
- `version` — bumped on every applied change; drives output no-op filtering
- `status` — `DRAFT`, `VALIDATED`, `NEEDS_REVIEW`, `APPROVED`, `REJECTED`

`RecordSource` is the lineage edge, many-to-many because a record accumulates across many messages
and one message can produce several records.

**`RecordFieldEvent` is append-only.** `ExtractedRecord.data` is the fold over these events ordered
by `eventAt` (the message's own timestamp). Out-of-order processing still converges on the
chronologically correct value. Superseded events are stored with `applied = false` and a
`skipReason`. Nothing is ever deleted.

## Automation

| Model | Notes |
|---|---|
| `Automation` | Schedule, window, filters, and the incremental cursors |
| `AutomationTrigger` | Binds to a source group, with its own cursor so one stalled group cannot block others |
| `AutomationAction` | Ordered actions with condition, retry policy, timeout |

Cursors (`lastProcessedAt`, `lastProcessedMessageId`, `lastSuccessfulRunAt`) advance **only on a
fully successful run**.

## Outputs

| Model | Notes |
|---|---|
| `Output` | The logical output the user manages |
| `OutputTarget` | Binds an automation to an output with operation + mapping |
| `OutputMapping` | Field mapping, update strategy, unique-key participation |
| `OutputSyncRecord` | **Per-record, per-output sync state** |
| `OutputVersion` | Immutable snapshot of every write |
| `OutputConflict` | Raised when the target changed outside MsgFlow |

`OutputSyncRecord` is the model that makes maintaining a 15,000-row workbook practical: it remembers
the external row each record owns, so an update is a direct write rather than a full-sheet scan.
`syncVersion` versus `ExtractedRecord.version` gives a free skip for unchanged records.

`Output.lastKnownChecksum` is the optimistic-concurrency guard. `allowDelete` defaults to false and
is human-only.

## Workflow

`WorkflowRun` stores the **resolved** window (`windowStart`/`windowEnd`), so a run stays reproducible
after the automation's configuration changes. `WorkflowRunStep` records every action with attempt
count, duration and error.

## Operations

`Integration` / `IntegrationCredential` (AES-256-GCM at rest), `Export`, `AuditLog`, `AIUsage`,
`Worker` / `WorkerHeartbeat`, `HealthCheck`, `ApiKey`, `Notification`.

## Working with the schema

```bash
pnpm db:generate     # regenerate the client after a schema change
pnpm db:push         # push without a migration — fastest for local work
pnpm db:migrate      # create and apply a migration
pnpm db:studio       # browse
pnpm db:seed         # demo workspace
```

## Index strategy

Compound indexes lead with `tenantId`, then the column the screen actually filters or sorts by:

- `Message(tenantId, timestamp)` — every processing window and date filter
- `Message(tenantId, groupId, timestamp)` — per-group history
- `Message(tenantId, status, timestamp)` — the pending queue
- `ExtractedRecord(tenantId, status, updatedAt)` — the review queue
- `RecordFieldEvent(recordId, fieldKey, eventAt)` — field history
- `OutputSyncRecord(tenantId, outputId, syncStatus)` — failed-row retry

## Growth

`Message` and `RecordFieldEvent` grow fastest. `Message.metadata` and `WorkerHeartbeat` are the first
candidates for pruning; the normalized message row and the field-event history should be kept,
because they are what reprocessing, audit and lineage depend on.

Partition by month once volume justifies it — the leading `(tenantId, timestamp)` and
`(tenantId, recordId, eventAt)` indexes are already partition-friendly.
