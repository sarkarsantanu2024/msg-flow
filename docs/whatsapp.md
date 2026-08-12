# WhatsApp

## Connecting

1. Start the worker: `pnpm worker:dev`.
2. Open **Dashboard → WhatsApp**.
3. Press **Connect**. The page polls every 3 seconds while connecting.
4. A QR code appears. On your phone: **WhatsApp → Settings → Linked devices → Link a device**.
5. Status goes `QR_REQUIRED → AUTHENTICATED → READY`.
6. Groups are discovered automatically the moment the session is ready.

The QR is rendered to a data URL inside the worker, so the browser never fetches it from anywhere and
the raw pairing string never leaves the worker process.

## Connection states

| State | Meaning |
|---|---|
| `DISCONNECTED` | No session. Automation processing is waiting for a connection. |
| `CONNECTING` | Starting the client; Chromium is booting |
| `QR_REQUIRED` | Waiting for you to scan |
| `AUTHENTICATED` | QR accepted; the session is initialising |
| `READY` | Connected and listening |
| `RECONNECTING` | Automatic recovery after a drop |
| `ERROR` | Something failed; the message is shown on the page |
| `LOGGED_OUT` | Session destroyed. A new QR scan is required. |

Every transition is written to `ConnectionEvent` and shown in the connection history. A drop from
`READY` also raises a notification. The system never silently continues as though WhatsApp were
still connected.

## The honesty rule

If the worker stops heartbeating, the dashboard reports the connection as `DISCONNECTED` regardless
of the last status written to the database. A crashed worker cannot report its own death, so absence
of a heartbeat — not presence of an error — is the signal. Showing a stale green here would be the
worst possible lie.

## Actions

Every button calls the worker for real:

| Action | Effect |
|---|---|
| **Connect** | Creates the connection record if needed and starts the session |
| **Reconnect** | Tears down and restarts, keeping the stored session |
| **Refresh QR** | Forces a fresh QR when the current one expired |
| **Sync groups** | Re-discovers groups from WhatsApp |
| **Disconnect** | Stops the client; the session is kept for a later reconnect |
| **Logout** | Destroys the stored session — a new QR scan is required. Confirmed first. |

If the worker is unreachable, the connection is marked `ERROR` with a clear message, rather than
being left claiming "connecting" forever.

## Groups

Only **monitored** groups enter the pipeline. Discovery never enables monitoring by itself — that is
always an explicit choice on the Groups page. Messages from unmonitored groups are dropped at
ingestion and never stored.

## Message capture

```
message → normalize → buffer (2s or 100 messages) → POST /api/worker/messages → COMMIT
```

Batching matters because a busy group arrives in bursts, and one HTTP request per message would be
slow and rate-limit bait. A batch that fails to deliver stays buffered and is retried, so a temporary
outage in the web app does not lose captured messages. The buffer is capped at 5,000 messages per
connection; overflow is logged loudly rather than silently.

## Historical messages

**There is no reliable way to back-fill WhatsApp history.** whatsapp-web.js sometimes replays recent
unread messages on reconnect, but nothing more. Any product claiming otherwise is overselling.

This is precisely why MsgFlow persists every message to PostgreSQL the moment it arrives. Once
captured, a message can be reprocessed, exported, analysed and audited forever — independently of
what WhatsApp still holds.

`IngestSource` records how each message arrived: `LIVE`, `BACKLOG`, `MANUAL` or `DEMO`. Live capture
and replayed backlog are never conflated.

## Sessions

whatsapp-web.js stores its session under `WORKER_SESSION_PATH` (default `./.sessions`), one directory
per connection. **Persist this path in production** — a Docker volume or a mounted disk — otherwise
every deploy forces a new QR scan.

Session data is authentication material. It is git-ignored, never sent to the browser, and never
logged.

## Provider independence

`whatsapp-web.js` is imported in exactly one file:
[`apps/worker/src/providers/whatsapp-web.ts`](../apps/worker/src/providers/whatsapp-web.ts).

Everything else speaks `MessageProvider` / `NormalizedMessage`. Adding the official WhatsApp Business
Platform means writing one more file implementing the same interface. Nothing downstream needs to
know which provider produced a message.

## Reliability notes

- Automatic reconnection is attempted 10 seconds after an unexpected drop. `LOGGED_OUT` is terminal
  and is not retried, because the session genuinely no longer exists.
- Chromium is memory-hungry. Give the worker at least 1 GB, and set `shm_size: 1gb` in Docker.
- Only group messages are captured; direct chats are out of scope.
- Outgoing messages (`fromMe`) are stored but excluded from automation processing.
