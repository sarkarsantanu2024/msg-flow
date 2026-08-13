# Tag-capture product direction

Decided 2026-08-13 with the product owner. Supersedes the monitor-everything
model for capture; the automation/extraction pipeline underneath is unchanged.

## The product in one sentence

A salesperson tags a WhatsApp message with `@get`; MsgFlow captures it, extracts
the fields the workspace has defined, and produces the file the user asks for —
for one day, several dates, or a date range.

## Reference scenario (real client)

Rate enquiries flow through a sales WhatsApp group all day:

> JK Sanjeev Gupta — Rate Request Supermax Bakery
> Dairy Life Enhancer: 10Kg / Mitai Life Enhancer: 10Kg
> …reply: Dairy Life Enhancer: 950+ / Mitai Life Enhancer: 950+

The client today re-types these into a tracking sheet with columns:
Asm Name · Date of Enquiry · Time · Party Name · Product Name · Quantity ·
Unit · Rate · Rate Given By · Order Status · SO No · Posting Remarks ·
Follow-up Remarks · Line of Action.

The product's job is to make that sheet build itself from tagged messages.

## Capture model (implemented)

- `@get` (configurable per worker, `CAPTURE_TAG`) is the opt-in marker. Only
  messages containing it — case-insensitive, anywhere in the text — leave the
  phone. Untagged traffic is never forwarded, stored, or seen by the server.
- Groups (`@g.us`) and direct chats (`@c.us`) both count. Status, broadcast
  and channel traffic never does.
- A chat is auto-registered and monitored the first time a tagged message
  arrives from it. Un-monitoring a chat in the dashboard wins over the tag.
- Phase 1 limitation: the tag must be written in the message itself. Replying
  `@get` to someone else's message does not capture the quoted message yet —
  resolving quotes needs a whatsapp-web.js call that is currently broken
  upstream (see the serializer notes in `apps/worker/src/providers/whatsapp-web.ts`).

## Phases

### Phase 1 — capture (done)
Worker tag filter, direct-chat support, chat auto-registration.

### Phase 2 — instruction & schema from the user
- User defines output columns by hand (name, type, order), or
- uploads a photo/screenshot (.jpg/.png) of their existing sheet or form; AI
  vision reads it and proposes the column schema for confirmation. The
  reference image for this feature is the client's tracking sheet above.

### Phase 3 — exports on demand
- Date scope: single day, a set of dates, or a range — chosen at export time.
- Formats: xlsx, csv, pdf exist in `packages/connectors`; add docx. "All
  formats" resolves to: xlsx · csv · pdf · docx.
- PDF/docx render on A4 with the workspace's column layout.

### Phase 4 — polish / pain points added on the owner's invitation
- Reply-tagging (capture the quoted message) once upstream allows it.
- `@get` command form ("@get 10.08.2026 xlsx" answered in-chat with the file)
  — explicitly deferred, owner chose tag-only for now.
- Duplicate-enquiry detection (same party + product + day).
- Rate-trend view per product from accumulated enquiries.
- Scheduled daily digest: yesterday's tagged messages as a file, mailed or
  posted to an output target.

## Non-goals

- Sweeping entire chats without tags. The tag is the consent boundary.
- Message history backfill. Capture starts when the worker is connected.
