# Security

## Authentication

**Email and password only.** Accounts are created directly in MsgFlow with a username and password
the user chooses. There is no Google, GitHub or other third-party sign-in anywhere in the product.

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, when set, are used **solely by the Google Sheets data
connector** and are never involved in authentication.

- Passwords are hashed with bcrypt, cost factor 12.
- Policy is length over composition: minimum 10 characters. A memorable passphrase beats
  `P@ssw0rd`, and users actually comply with it.
- Login compares against a dummy hash when the account does not exist, so a missing account and a
  wrong password take the same time. Otherwise response timing enumerates registered emails.
- The error message is identical for both cases.
- Password reset always reports success whether or not the address exists — a differing response is
  an account-enumeration oracle. Tokens are stored hashed and expire after one hour.
- Sessions are JWTs with a 7-day maximum age, in `httpOnly`, `sameSite=lax` cookies, `secure` in
  production.

## Tenant isolation

The invariant: **no query touches tenant data without a tenantId proven to belong to the signed-in
user on this request.**

Three layers:

1. **Explicit context.** `requireTenant()` / `requireTenantApi()` resolve membership from the
   database on every request. There is no ambient "current tenant" global — a global is exactly what
   leaks across requests under concurrency.
2. **Membership is re-read, never trusted from the JWT.** Revoking a member takes effect
   immediately rather than when their token expires.
3. **`assertTenantOwned()` on every by-id lookup.** Fetching by id alone and trusting the id to be
   unguessable is not isolation.

The tenant-switch cookie is a *preference*, never an authorization: it is only honoured when the
user genuinely holds a membership in that tenant, so setting it by hand grants nothing.

### Database-level enforcement

Every tenant-owned table carries `tenantId` as the leading index column. For defence in depth, enable
PostgreSQL row-level security:

```sql
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Message"
  USING ("tenantId" = current_setting('app.tenant_id', true));
```

Set `app.tenant_id` per transaction. Application-layer filtering alone is one forgotten `where`
clause away from a breach.

## Authorization

Four roles with a strict hierarchy: `VIEWER < OPERATOR < ADMIN < OWNER`.

Permissions are declared in a single matrix (`packages/db/src/tenant.ts`) and checked with
`requirePermission('outputs:sync')`. Route handlers never hand-roll role comparisons.

A workspace must always retain at least one OWNER; the API refuses the change that would remove the
last one.

Platform administration (`/admin`) is a separate `isSuperAdmin` flag on the user, independent of any
tenant role. The first account created on a fresh installation becomes super admin — otherwise
`/admin` would be unreachable without a manual database edit.

## Credentials at rest

Integration credentials are encrypted with **AES-256-GCM** before storage:

```
v1.<iv-b64>.<authTag-b64>.<ciphertext-b64>
```

- The version prefix makes key rotation possible without guessing how an existing blob was encrypted.
- GCM is authenticated, so tampering is detected rather than silently decrypted to garbage.
- A fresh IV per encryption means identical secrets produce different ciphertexts.
- Credentials are decrypted only at the point of use and are **never returned by any API** —
  responses expose name, type and validity only.

`ENCRYPTION_KEY` accepts base64 or hex; anything else is stretched with SHA-256 to a stable 32 bytes.

## Input validation

Every route body, query and form is parsed with Zod before use. Nothing reaches the database
unvalidated.

Critically, **AI output is validated too**: a runtime Zod schema is built from the tenant's own field
definitions, and nothing reaches `ExtractedRecord` until it passes. "AI never writes business data
directly" is enforced by that gate, not by convention.

## Injection and code execution

- Prisma parameterizes everything; there is no string-built SQL.
- Action conditions (`quantity > 0`) are evaluated by a small purpose-built expression evaluator, not
  `eval`. Conditions come from user configuration, and passing user input to `eval` inside the
  workflow engine would be a straightforward code-execution hole. An unparseable condition evaluates
  to *false*.
- Storage references are normalized and rejected if they escape the tenant-prefixed root, so a
  crafted ref cannot reach another tenant's files.

## Service-to-service

The worker authenticates with a shared bearer secret, compared in **constant time**. A byte-by-byte
early-exit comparison leaks the secret to anyone who can measure response timing across enough
requests.

Outbound webhooks are signed `HMAC-SHA256(timestamp + "." + body)`. The timestamp is inside the
signed material deliberately — signing only the body lets an attacker replay a captured request
forever.

## Rate limiting

Sliding-window limits per tenant on auth, general API, ingest and AI endpoints.

**Known limitation:** the limiter is in-process. That is correct for a single instance and for local
development. A multi-instance deployment needs a shared store — Redis or Upstash — or each instance
enforces its own quota independently.

## Audit logging

Login, logout, signup, tenant and member changes, automation lifecycle, record edits and deletions,
output syncs and version restores, integration connections, exports, settings changes, and WhatsApp
connect/disconnect are all recorded with actor, IP, user agent, and before/after state.

Audit writes deliberately swallow their own errors — an audit failure must never break the user
action that triggered it — but they log loudly when they do.

## Secret handling

The logger redacts any key whose name contains `password`, `secret`, `token`, `apikey`,
`authorization`, `cookie`, `credential`, `sessionRef`, `qrCode` and similar, at any depth.

WhatsApp session data never leaves the worker and is git-ignored. QR codes are rendered to data URLs
inside the worker so the raw pairing string is never transmitted.

## Destructive operations

`allowDelete` defaults to `false` on every output and can only be changed by a person through the UI.
No extraction result, condition expression or AI output can flip it. The REST connector never issues
`DELETE` from the automation path.

## Error handling

`AppError` carries a user-safe message and a separate detail payload for the logs. Unknown errors
always become a generic 500 — SQL text, file paths and stack traces never reach an API response.

## Deployment checklist

- [ ] `AUTH_SECRET` and `ENCRYPTION_KEY` are freshly generated, not the examples
- [ ] `WHATSAPP_WORKER_SECRET` matches on both sides and is not the dev default
- [ ] `DATABASE_URL` uses `sslmode=require`
- [ ] The worker's control port is not publicly reachable
- [ ] Postgres RLS policies are enabled
- [ ] A shared-store rate limiter is in place if running more than one instance
- [ ] Session storage is on a persistent volume
- [ ] Database backups are configured and restore has been tested
