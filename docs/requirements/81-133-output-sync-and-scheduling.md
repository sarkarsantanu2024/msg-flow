# Requirements 81–133 — Output Synchronization, Scheduling & Connection Health

> Captured 2026-08-12. Continuation of spec sections 1–80.

## 0. Conceptual model correction (supersedes earlier framing)

**Old:** `WhatsApp → AI → Export`

**New:** `WhatsApp → Message Database → AI → Structured Business Data → Automation → Output Synchronization`

The database is the source of truth. Excel/Sheets/API are *synchronization targets*, never the
primary store. The product continuously maintains business outputs; it is not an export tool.

---

## 81–82. Output operation modes

Every automation has an **Output Operation** setting:

| Mode | Behaviour |
|---|---|
| `CREATE_NEW` | Create a completely new output file (e.g. `Sales Report - August 2026.xlsx`) |
| `APPEND` | Add newly extracted records to the end of an existing file |
| `UPDATE_EXISTING` | Locate an existing row/entity by key and modify its fields |
| `UPSERT` | Update if the key matches, otherwise insert |
| `REPLACE` | Regenerate the output dataset for a specific period from source data |
| `GENERATE_NEW_VERSION` | Preserve prior output; emit `report_v1/v2/v3.xlsx` |

All modes must be configurable per output target.

## 83. Existing file management

Connectable existing outputs: Excel, CSV, Google Sheets, PDF (where practical),
PowerPoint (where practical), REST API, Webhook, client website, client admin panel.

Excel configuration flow:
1. Upload existing XLSX
2. Select worksheet
3. Preview columns
4. Define primary/unique key
5. Map extracted fields → existing columns
6. Choose operation (APPEND / UPDATE / UPSERT / REPLACE)
7. Save configuration

Example mapping (`sales.xlsx`):

| WhatsApp field | Excel column |
|---|---|
| `date` | Date |
| `customerName` | Customer |
| `product` | Product |
| `quantity` | Quantity |
| `rate` | Rate |
| `salesPerson` | Salesperson |

Unique key: `Date + Customer + Product`. Match → UPDATE, no match → INSERT.

## 84. Synchronization metadata

Uploaded files are not the database. Maintain `OutputRecordSync`:

```
id
tenantId
automationId
recordId
outputId
externalRecordId
externalRowId
lastSyncedAt
syncStatus
syncVersion
errorMessage
```

## 85. Output versioning

Store per version: `fileVersion`, `createdAt`, `createdBy`, `recordCount`, `checksum`,
`storageReference`. Allow view / download / restore of previous versions. Never silently
overwrite without recoverability where practical.

## 86. File conflict protection

Implement file version + checksum, last-modified tracking, optimistic concurrency,
conflict detection, warning before overwrite, retry.

On conflict → status `SYNC_CONFLICT`, message *"The output file has changed since the last
synchronization."* Options: review differences, use latest file, keep automation version,
merge where possible.

## 87. Google Sheets existing data

Flow: Connect Google → select spreadsheet → select worksheet → preview columns →
define unique key → map fields → choose operation → save.
Supports APPEND / UPDATE / UPSERT / REPLACE.

## 88. API / website existing data

Same model against client systems (e.g. `https://client-website.com/api/products`).
Supports CREATE, UPDATE, UPSERT, DELETE (only where explicitly allowed), SYNC.

**AI must never directly execute destructive operations.** Destructive actions require
explicit workflow configuration.

## 89. Output Target abstraction

Types: `EXCEL_FILE`, `CSV_FILE`, `GOOGLE_SHEETS`, `PDF`, `POWERPOINT`, `WEBHOOK`,
`REST_API`, `CLIENT_WEBSITE`, `CLIENT_ADMIN`, `FUTURE_CRM`, `FUTURE_ERP`.

One automation may fan out to multiple targets from a single structured record.

## 90. Multiple output actions

An automation may run ordered actions (save to DB, update Excel, update Sheet, call client
API, generate PDF, send email). Each action carries: order, condition, retry policy,
timeout, status, error handling.

---

## 91–99. Date/time based processing

**Modes:** DAILY, WEEKLY, MONTHLY, CUSTOM DATE RANGE, REAL-TIME, HOURLY, SCHEDULED.

- **Real-time (92):** message arrives → process immediately → output update.
- **Daily (93):** e.g. 23:00 daily, processes 00:00–23:59 of that day.
- **Weekly (94):** e.g. Monday 01:00, processes the previous Mon–Sun week.
- **Monthly (95):** e.g. 1st at 02:00, processes the previous calendar month.
- **Custom range (96):** user picks From/To and runs.

**Dashboard filters (97):** Today, Yesterday, Last 7 days, This week, Last week, This month,
Last month, Custom. Timezone handling required; default tenant timezone `Asia/Kolkata`,
configurable per tenant.

**Trigger types (98):** `REAL_TIME`, `SCHEDULED`, `MANUAL`, `EVENT_BASED`.
Scheduled frequency: HOURLY, DAILY, WEEKLY, MONTHLY, `CUSTOM_CRON`.

**Processing window (99):** `CURRENT_MESSAGE`, `TODAY`, `YESTERDAY`, `LAST_7_DAYS`,
`THIS_WEEK`, `LAST_WEEK`, `THIS_MONTH`, `LAST_MONTH`, `CUSTOM`, `PREVIOUS_RUN`,
`SINCE_LAST_SUCCESSFUL_RUN`.

`SINCE_LAST_SUCCESSFUL_RUN` is the most important option — it prevents reprocessing.

## 100. Incremental processing

Never reprocess full history. Track `lastProcessedAt`, `lastProcessedMessageId`,
`lastSuccessfulRunAt`. Matters for cost, speed, AI token usage, scalability, duplicate
prevention.

## 101. Message reprocessing

Per message: Reprocess, Edit, Ignore, Assign automation. Failed AI extraction → Retry.

## 102–103. Dashboards

Date-wise dashboard metrics: messages, important messages, AI processed, records extracted,
successful workflows, failed workflows, review required. Charts: messages by day, records by
day, category by day, automation runs by day.

`/dashboard/analytics` with Day (hourly breakdown), Week (Mon→Sun), Month (1→31) tabs plus
custom range.

## 104–107. Output management

**History (104):** version, date, operation, records affected, created/updated rows,
failed rows, status.

**Detail page (105)** — `/dashboard/outputs/[id]`:
- Fields: name, type, automation, status, last sync, next sync, operation mode, date range,
  record count, version
- Tabs: Overview, Records, Mapping, History, Runs, Errors, Settings
- Actions: Sync Now, Download, View, Edit Mapping, Pause, Resume, Create Version,
  Restore Version

**Sync Now (106):** determine configured date range → find messages → process → extract →
validate → update output → show result.

**Statuses (107):** `ACTIVE`, `PAUSED`, `SYNCING`, `SUCCESS`, `PARTIAL_SUCCESS`, `FAILED`,
`CONFLICT`, `DISCONNECTED`.

---

## 108–113. Connection & health monitoring

**WhatsApp status widget (108)** — mandatory, always visible:
🟢 Connected · 🔴 Disconnected · 🟡 Reconnecting · 🟠 QR Code Required · ⚠ Connection Error

**`/dashboard/whatsapp` (109):** connection name, phone number (if available), provider,
status, connected since, last message received, last heartbeat, worker status, session status.
Actions: Connect, Reconnect, Disconnect, Logout, Refresh QR.

**Live monitor (110):** periodic refresh showing WhatsApp/worker state, last message, last
heartbeat, groups monitored, messages today. On drop, immediately show disconnected and
automation processing `PAUSED / WAITING FOR CONNECTION`.

**Alerts (111):** disconnect creates a system event with timestamp and reconnect action;
notify if configured. Never silently continue assuming connection.

**Health hierarchy (112):** Worker → WhatsApp Client → Group Listener → Message Queue →
AI Processor → Workflow Engine → Output Connector. Each layer shown on the dashboard.

**Automation health (113):** status, last successful run, last failed run, next run,
messages processed, records created/updated/skipped, errors.

---

## 114–119. Mapping, keys, conflicts, lineage

**Mapping UI (114):** extracted data on the left, output fields on the right,
drag-and-drop where practical.

**Unique key (115):** required for UPDATE/UPSERT. Single (Customer ID, Order ID, Invoice
Number, Product ID, Email, Phone) or composite (Customer + Product + Date). UI must ask
plainly: *"How should we find an existing record?"*

**Per-field update strategy (116):** `ALWAYS_UPDATE`, `UPDATE_IF_EMPTY`, `NEVER_UPDATE`,
`UPDATE_IF_NEWER`, `CUSTOM_RULE`.

**Record conflict (117):** multiple messages touching one record are applied
chronologically; keep event history; never silently delete previous values.

**Lineage (118):** every output record traces WhatsApp message → AI extraction → structured
record → workflow run → output row. "Where did this data come from?" opens the original
message.

**Output record detail (119):** output data plus source group, sender, message text,
received timestamp, AI confidence, automation, workflow result, output file + row number.

## 120. Manual data import

XLSX/CSV: upload → preview → detect columns → map fields → select unique key → import →
store normalized records. Lets the platform adopt an existing business dataset.

## 121–124. Worked examples

- Existing `sales.xlsx` (1000 rows) + UPSERT on Order ID: existing orders update, new
  orders insert; final file holds old and new data.
- Daily automation: UPSERT into `Master Sales.xlsx` **and** generate `Sales-2026-08-12.xlsx`.
- Monthly automation on the 1st: process previous month → `Sales-August-2026.xlsx`, optionally
  also update `Sales-Master.xlsx`.
- One automation → many outputs (master Excel, daily Excel, Google Sheet, client API,
  monthly PDF), each with independent operation, schedule, mapping, destination, status.

## 125–126. Templates and formula protection

Users define output templates. Preserve headers, worksheets, formulas, formatting, merged
cells, hidden sheets, named ranges. Update only the required rows/cells — do not recreate
the workbook. If a feature cannot be safely preserved, warn the user.

## 127–130. Activation, pause, backlog, durability

**Pre-activation summary (127):** source, processing schedule, date range, AI extraction,
output, operation, key, additional outputs → `[Activate Automation]`.

**Pause/resume (128):** messages continue to be stored while paused; backlog processed on
resume per configuration.

**Backlog (129):** distinguish `LIVE`, `BACKLOG`, `MANUAL_REPROCESS`. Do not assume full
WhatsApp history is recoverable via whatsapp-web.js. State clearly: *"Historical message
availability depends on WhatsApp/provider access."*

**Critical data principle (130):** never depend solely on live WhatsApp messages. Persist a
normalized copy in PostgreSQL on receipt — enables analytics, reprocessing, exports,
reports, automation recovery, auditing.

---

## 131–132. Product flow & promise

```
WhatsApp → Connection Status → Group Monitoring → Message Capture → Database
  → AI Classification → AI Extraction → Validation → Structured Records
  → Automation → Date/Time Processing → Create New OR Update Existing
  → Excel / CSV / PPT / REST API / Admin Panel / Google Sheets / PDF / Webhook /
    Website / Future CRM / ERP
```

**Promise:** *"Read important WhatsApp business messages and continuously turn them into
structured, usable business data."* — CREATE, UPDATE, APPEND, UPSERT, SYNC, REPORT, AUTOMATE.

---

## 133. Final acceptance test

1. WhatsApp status is visible
2. User can see CONNECTED/DISCONNECTED
3. User can monitor groups
4. Messages are captured
5. Messages are stored
6. AI classifies messages
7. AI extracts structured information
8. User can create automation
9. Daily processing selectable
10. Weekly processing selectable
11. Monthly processing selectable
12. Custom date range selectable
13. Real-time processing selectable
14. User can create a new Excel
15. User can upload existing Excel
16. User can update existing Excel
17. User can append to existing Excel
18. User can UPSERT existing Excel
19. User can connect existing Google Sheet
20. User can update Google Sheet
21. User can call an existing client API
22. User can configure field mapping
23. User can define unique keys
24. User can manually Sync Now
25. User can see last sync
26. User can see next sync
27. User can see output history
28. User can see version history
29. User can see failed records
30. User can retry failed records
31. User can trace output data back to the original WhatsApp message
32. Existing records must not be accidentally overwritten
33. Duplicate messages must not create duplicate records
34. Tenant A cannot access Tenant B data
35. System remains provider-independent for future WhatsApp Business Platform integration

---

## Dashboard top bar (recommended)

```
┌─────────────────────────────────────────────────────────────┐
│ WhatsApp ● Connected    Worker ● Online    AI ● Healthy     │
│ Groups 5   Messages Today 1,284   Records 326   Errors 3    │
└─────────────────────────────────────────────────────────────┘
```

`TODAY | WEEK | MONTH | CUSTOM`, then counters (Messages, Important, Extracted, Created,
Updated, Skipped, Failed) and an automation list with health + last/next sync.
