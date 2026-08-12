# Automations

An automation decides **which messages to read**, **what to extract from them**, and **where the
result goes**.

## Lifecycle

```
DRAFT → ACTIVE ⇄ PAUSED → ARCHIVED
```

Automations are always created as `DRAFT` — including ones drafted by AI. Activation is a separate,
explicit human decision, and it is refused unless the automation has at least one source group, at
least one connected output, and a unique key whenever the operation is UPDATE or UPSERT.

**Pausing does not lose messages.** Capture continues; only processing stops. On resume the backlog
is picked up according to the configured window.

## Processing modes

| Mode | When it runs |
|---|---|
| `REAL_TIME` | As each message arrives |
| `DAILY` | Once a day at the configured local time |
| `WEEKLY` | Once a week, on the configured weekday |
| `MONTHLY` | On the configured day of the month (capped at 28, so February never skips) |
| `CUSTOM` | A cron expression you supply |
| `MANUAL` | Only when you press Run |

Schedules are evaluated in the automation's timezone, falling back to the tenant's. Changing the
tenant timezone recomputes `nextRunAt` for every affected automation — otherwise every report would
silently shift by hours.

## Processing windows

Which messages a run considers:

| Window | Meaning |
|---|---|
| `CURRENT_MESSAGE` | Just the triggering message (real-time) |
| `TODAY` / `YESTERDAY` | Local day boundaries |
| `THIS_WEEK` / `LAST_WEEK` | Monday-to-Sunday, local |
| `THIS_MONTH` / `LAST_MONTH` | Calendar months, local |
| `LAST_7_DAYS` | Rolling seven local days |
| `CUSTOM` | An explicit from/to |
| `SINCE_LAST_SUCCESSFUL_RUN` | **The default and the important one** |

`SINCE_LAST_SUCCESSFUL_RUN` is what stops MsgFlow re-sending the same messages to the AI on every
run. That matters for cost, speed, token usage and duplicate prevention.

On the very first run there is no cursor, so the window looks back a **bounded** 30 days rather than
scanning all history and spending a fortune in tokens. The run summary says so.

The resolved window is stored on the run (`windowStart` / `windowEnd`), so a run stays reproducible
even after the configuration changes.

## Incremental processing

Three cursors: `lastProcessedAt`, `lastProcessedMessageId`, `lastSuccessfulRunAt`.

They advance **only on a fully successful run**. A partial failure leaves them alone so the failed
messages are retried next time. Re-scanning is harmless because message dedupe and the record natural
key make reprocessing idempotent — a retry updates the existing record rather than creating a
duplicate.

A single run processes at most 500 messages. When that cap is hit the run says so explicitly rather
than silently truncating; the remainder is picked up by the next run.

## Message filtering, before the AI

Cheap triage runs before any tokens are spent:

1. **Keyword filter** — optional, comma-separated.
2. **Classification** — cached per message, so it runs once no matter how many automations read it.
3. **Importance threshold** — skip anything below the configured level.
4. **Category filter** — restrict to the categories this automation cares about.

Anything classified `IGNORE` (greetings, acknowledgements, stickers) is skipped before extraction.

## Natural-language drafting

Describe what you want:

> "Extract sales enquiries from the Sales group and update my master Excel every evening."

MsgFlow drafts a name, an extraction schema with field types, a processing mode, a date-range mode,
suggested groups and an output operation with key fields.

**Nothing is created or activated.** The draft is returned for review, every field is editable, and
you press *Create automation* — then, separately, *Activate*. An AI that could silently switch on a
live data pipeline would be a liability, not a feature.

With no AI key configured this still works, using the rule-based drafter, and the UI says which one
produced the draft.

## Actions

By default, activating an automation syncs every connected output. For finer control, define ordered
`AutomationAction`s, each with:

- an **order** and an optional **condition** (`quantity > 0`, `status == "Confirmed"`, `notes empty`,
  combinable with `&&` / `||`)
- a **retry policy** (attempts, backoff, delays) and a **timeout**
- `continueOnError` — whether a failure stops the run

Conditions are evaluated by a small purpose-built expression evaluator, not `eval`. Conditions come
from user configuration, and handing user input to `eval` inside the workflow engine would be a
straightforward code-execution hole. An unparseable condition evaluates to *false* — the action does
not run — rather than silently passing.

Every action becomes a `WorkflowRunStep` with its own status, attempt count, duration and error, so a
failure is inspectable rather than a mystery.

## Runs

Each run records the window, messages scanned and processed, records created/updated/skipped/failed,
rows created/updated/skipped/failed, token usage, estimated cost, and a summary of every output.

Status is `SUCCESS`, `PARTIAL_SUCCESS` (something worked, something failed) or `FAILED`.

## Scheduling in production

The worker ticks `/api/cron/tick` every 60 seconds by default. Alternatives:

- **Vercel Cron** — add a schedule for `/api/cron/tick`; the endpoint accepts Vercel's own header.
- **Any external scheduler** — POST with `Authorization: Bearer $WHATSAPP_WORKER_SECRET`.

Set `SCHEDULER_ENABLED=false` on the worker if something else drives the schedule.
