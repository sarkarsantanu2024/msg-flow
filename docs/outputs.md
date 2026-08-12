# Outputs

An **Output** is a file or system MsgFlow keeps up to date. An **OutputTarget** binds an automation to
an output and carries the operation and field mapping — it is the row that says *"this automation
UPSERTs into that workbook, matched on Customer + Product + Date."*

One automation can feed many outputs; one output can be fed by many automations.

## Types

| Type | Update in place? | Notes |
|---|---|---|
| `EXCEL` | yes | See [excel-sync.md](excel-sync.md) |
| `CSV` | yes | RFC 4180 quoting, BOM for Excel compatibility |
| `GOOGLE_SHEETS` | yes | Batch updates; **credentials required to activate** |
| `REST_API` | yes | Your own system. Create/update/upsert — never delete |
| `CLIENT_WEBSITE` / `CLIENT_ADMIN` | yes | The REST connector under friendlier names |
| `WEBHOOK` | insert only | HMAC-signed notifications |
| `PDF` | regenerated | Paginated table report |
| `POWERPOINT` | regenerated | Slide report, 12 rows per slide |

Documents are regenerated rather than updated row by row. Asking for `UPSERT` on a PDF produces a
fresh render and says so in the run warnings, instead of pretending an update happened.

## Operations

`CREATE_NEW` · `APPEND` · `UPDATE_EXISTING` · `UPSERT` · `REPLACE` · `GENERATE_NEW_VERSION`

The API rejects an operation a connector cannot honour, rather than accepting it and behaving
differently from what you asked.

## Unique keys

`UPDATE_EXISTING` and `UPSERT` are meaningless without a way to find an existing row. Both the
mapping UI and the API **refuse** a configuration with no key field. This is what stops a
misconfigured automation from silently appending duplicates to a customer's master file.

Keys can be single (`Order ID`) or composite (`Customer + Product + Date`, applied in `keyOrder`).
The mapping screen asks the question in plain words: *"How should we find an existing record?"*

## Update strategies

Per field: `ALWAYS_UPDATE`, `UPDATE_IF_EMPTY`, `NEVER_UPDATE`, `UPDATE_IF_NEWER`. See
[excel-sync.md](excel-sync.md#update-strategies) — the same engine drives every connector.

## Sync Now

Every output has a **Sync Now** button. It runs the full pipeline:

```
resolve the configured date range → find messages → classify → extract → validate
  → update the output → report exactly what happened
```

The result dialog reports messages processed, records created/updated/skipped/failed and rows
created/updated/skipped/failed, plus any warnings. A button that claimed success without reporting
what it did would be worse than no button.

Sync Now refuses to run while an unresolved conflict exists.

## What gets synchronized

Only records with status `VALIDATED` or `APPROVED`. Anything in the review queue is held back —
uncertain data must never reach a customer's file unreviewed.

Records whose `syncVersion` already matches their current `version` are skipped without touching the
target, so a routine sync usually writes very few rows.

## Failed rows and retry

Per-record failures are recorded on `OutputSyncRecord` with the error message and an attempt count.
The output's **Errors** tab lists them and offers **Retry failed rows**, which re-syncs only those
records.

## Versions

File outputs snapshot every write: version number, checksum, record count, size, storage reference.
Download or restore any version from the **History** tab. Restoring snapshots the current file first.

## Destructive operations

`allowDelete` defaults to `false` on every output and can only be changed by a person through the UI.
No extraction result, condition expression or AI output can flip it. `DELETE` is not reachable from
the automation path.

## Google Sheets without credentials

The connector is fully implemented. Without Google credentials it runs in **mock mode**: mapping, key
matching and update strategies all execute and report exactly what they would have done, but nothing
leaves the process. The UI labels this clearly — *"Credentials required to activate this
integration."*

This keeps the feature demonstrable and testable, and the switch is a single boolean rather than a
separate code path that can drift from the real one.
