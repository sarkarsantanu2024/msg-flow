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

Revised 2026-08-13 after client feedback: *"user can not comfortable to send
msg with @get word."* Senders will not change how they type, so the default
requires nothing from them.

- **Default — monitor mode.** The worker forwards every message from groups
  (`@g.us`) and direct chats (`@c.us`); the dashboard's per-chat monitoring
  toggle decides what is stored. Unmonitored chats are discarded at ingest.
  The workspace owner consents per chat; senders do nothing.
- **Optional — tag mode.** Setting `CAPTURE_TAG` (e.g. `@get`) on a worker
  flips it to opt-in-per-message: only tagged messages are forwarded, and a
  tagged arrival auto-monitors its chat. For clients who want the tighter
  boundary and can get senders to tag.
- Either way: status, broadcast and channel traffic is never captured, and a
  chat is auto-registered on first contact (monitored only in tag mode) — the
  only way direct chats become visible, since group sync sees only `@g.us`.
- Privacy note on monitor mode: message text from unmonitored chats does
  transit the server before being discarded. A worker-side monitored-list
  cache would keep it on the phone entirely — worthwhile phase-4 hardening.
- Reply-tagging (capturing the message someone replies to) is still blocked
  by a broken whatsapp-web.js call — see the serializer notes in
  `apps/worker/src/providers/whatsapp-web.ts`.

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
