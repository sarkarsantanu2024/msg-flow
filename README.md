# MsgFlow

**Turn Messages Into Business Data.**

MsgFlow reads the business messages your team already sends on WhatsApp, understands them with AI,
and continuously **creates _and updates_** your Excel files, Google Sheets, APIs and reports.

It is not an export tool. The database is the source of truth; every output is a projection that
MsgFlow keeps in step.

> **Resuming work on this project?** Read [HANDOFF.md](HANDOFF.md) first. It records exactly what is
> verified, what has never been run, and the next steps in order.

```
WhatsApp → Message DB → AI → Structured Records → Automation → Output Synchronization
           (truth)             (truth)                          (projections)
```

---

## Quick start

```bash
pnpm install
cp .env.example .env          # a .env with generated secrets is already present
pnpm db:generate
pnpm db:push                  # or: pnpm db:migrate
pnpm db:seed
pnpm dev                      # https://msg-flow.vercel.app
```

In a second terminal:

```bash
pnpm worker:dev               # http://localhost:4000
```

**Demo sign-in** (created by the seed):

|          |                     |
| -------- | ------------------- |
| Email    | `demo@msgflow.app`  |
| Password | `msgflow-demo-2026` |

The owner account is also a platform super admin, so `/admin` is reachable.
A second account, `operator@msgflow.app`, uses the same password and has the OPERATOR role.

**No AI key? Everything still works.** With `AI_PROVIDER=mock` (the default) a built-in rule-based
provider handles classification and extraction, so Demo Mode, the seeded data and the whole
pipeline are usable before you spend a rupee on tokens.

---

## What is here

```
apps/
  web/        Next.js 15 app — dashboard, API routes, auth. Deploys to Vercel.
  worker/     Persistent Node service — whatsapp-web.js + Puppeteer. Deploys to Railway/Render/Fly/Docker.

packages/
  config/     Environment parsing and shared constants
  logger/     Structured JSON logging with secret redaction
  types/      Provider, output and error contracts
  validation/ Zod schemas, including runtime schemas built from tenant field definitions
  db/         Prisma schema, client, tenancy helpers, encryption, audit, usage
  ai/         AIProvider abstraction — Anthropic, OpenAI, Gemini, and a rule-based mock
  connectors/ Excel, CSV, Google Sheets, REST API, Webhook, PDF, PowerPoint + mapping engine
  workflow/   Processing windows, scheduling, record folding, sync engine, health

docker/       Worker image and a local compose stack
docs/         Architecture, setup, and one guide per subsystem
tests/        107 tests, no database or network required
```

**The WhatsApp rule:** only `apps/worker/src/providers/whatsapp-web.ts` may import
`whatsapp-web.js`. Everything else speaks the `MessageProvider` interface, so the official WhatsApp
Business Platform slots in as one more file.

---

## Why this design

**Messages are committed before any AI runs.** If classification fails, the message is still safely
stored and can be reprocessed. Nothing depends on WhatsApp still having it.

**Records are folded from field events, not overwritten.** Given stock `100 @ 10:00 → 80 @ 11:00 →
75 @ 12:00`, the record converges on 75 regardless of the order messages were _processed_ in,
because ordering is by when they were _sent_. A late-arriving older message is recorded but not
applied — nothing is ever deleted.

**`OutputSyncRecord` remembers which external row each record owns.** That is what makes UPSERT into
a 15,000-row `Customer_Master.xlsx` a direct write rather than a full-sheet scan.

**Excel files are edited in place, never rebuilt.** Formulas, number formats, merged ranges, named
ranges and hidden sheets survive a sync. What cannot be guaranteed is stated plainly in the UI
before you activate an automation — see [docs/excel-sync.md](docs/excel-sync.md).

**A file changed outside MsgFlow is never silently overwritten.** A checksum comparison before every
write raises `SYNC_CONFLICT` and asks you which side wins.

**Duplicate prevention is enforced by the database**, not by application logic: unique constraints on
the provider message id and on a content hash.

---

## Commands

| Command            | What it does                                                 |
| ------------------ | ------------------------------------------------------------ |
| `pnpm dev`         | Next.js app on :3000                                         |
| `pnpm worker:dev`  | WhatsApp worker on :4000, with reload                        |
| `pnpm db:generate` | Generate the Prisma client                                   |
| `pnpm db:push`     | Push the schema without a migration (fastest for local work) |
| `pnpm db:migrate`  | Create and apply a migration                                 |
| `pnpm db:seed`     | Populate a demo workspace                                    |
| `pnpm db:studio`   | Prisma Studio                                                |
| `pnpm test`        | Run the test suite                                           |
| `pnpm typecheck`   | TypeScript across every package                              |
| `pnpm lint`        | ESLint                                                       |
| `pnpm build`       | Production build                                             |
| `pnpm validate`    | generate → typecheck → lint → test → build                   |

---

## Environment

Every variable is documented in [`.env.example`](.env.example). The ones that matter:

| Variable                                                  | Required       | Notes                                                     |
| --------------------------------------------------------- | -------------- | --------------------------------------------------------- |
| `DATABASE_URL`                                            | yes            | Neon pooled connection string                             |
| `DIRECT_URL`                                              | for migrations | Neon direct (non-pooled) connection                       |
| `AUTH_SECRET`                                             | yes            | `openssl rand -base64 32`                                 |
| `ENCRYPTION_KEY`                                          | yes            | 32 bytes; encrypts stored integration credentials         |
| `WHATSAPP_WORKER_SECRET`                                  | yes            | Shared secret between app and worker                      |
| `AI_PROVIDER`                                             | no             | `anthropic` · `openai` · `gemini` · `mock` (default)      |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | no             | Missing key ⇒ falls back to mock, and says so in the UI   |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`               | no             | **Google Sheets connector only — never used for sign-in** |

**Sign-in is email and password only.** Accounts are created directly in MsgFlow with a username and
password the user chooses. There is no Google or other third-party sign-in anywhere in the product.

---

## Documentation

| Guide                                         | Covers                                              |
| --------------------------------------------- | --------------------------------------------------- |
| [architecture.md](docs/architecture.md)       | How the pieces fit, and why                         |
| [setup.md](docs/setup.md)                     | Local development from zero                         |
| [database.md](docs/database.md)               | Every model and the reasoning behind it             |
| [whatsapp.md](docs/whatsapp.md)               | Connecting, QR flow, connection states              |
| [worker.md](docs/worker.md)                   | Running and deploying the worker                    |
| [ai.md](docs/ai.md)                           | Provider abstraction, prompts, cost                 |
| [automation.md](docs/automation.md)           | Schedules, processing windows, incremental runs     |
| [outputs.md](docs/outputs.md)                 | Operations, mapping, unique keys, update strategies |
| [excel-sync.md](docs/excel-sync.md)           | Updating existing workbooks — and the honest limits |
| [deployment.md](docs/deployment.md)           | Vercel + Railway/Render/Fly + Neon                  |
| [security.md](docs/security.md)               | Tenant isolation, RBAC, encryption, rate limiting   |
| [api.md](docs/api.md)                         | Every route                                         |
| [troubleshooting.md](docs/troubleshooting.md) | When things go wrong                                |

---

## Known limitations

Stated plainly rather than discovered later:

- **Google Sheets needs credentials.** Without them the connector runs in mock mode: mapping, key
  matching and update strategies all execute and report what they _would_ do, but nothing is written
  to Google. The UI says so.
- **`.xlsm` macro workbooks are rejected**, because macros cannot be preserved through a
  programmatic write. Save as `.xlsx`.
- **Pivot tables and charts bound to shifting ranges** are not recalculated by a sync. Refresh them
  in Excel. Flagged in the UI before activation.
- **Historical WhatsApp messages cannot be back-filled.** whatsapp-web.js sometimes replays recent
  unread messages on reconnect, but there is no reliable history fetch. This is why messages are
  persisted the moment they arrive.
- **Rate limiting is in-process.** Correct for a single instance; a multi-instance deployment needs
  a shared store (see [security.md](docs/security.md)).
- **Payment processing is not wired up.** Plans, limits and usage are tracked and enforced;
  connecting a payment provider is a deployment step.
- **The S3 storage driver is not enabled** in this build — `STORAGE_DRIVER=local` is the supported
  path. The interface is in place.
- **Password-reset emails are not sent.** With no mail transport configured, the reset link is
  returned in the UI in development and clearly labelled.

---

## License

Proprietary. © 2026 MsgFlow.
