# Excel synchronization

The feature this product is really about: **update the workbook you already use**, rather than
generating a new file nobody wants.

## The central rule

**Never rebuild the workbook.** MsgFlow loads the existing file, writes individual cells, and saves.
That is what keeps your formulas, number formats, merged ranges, named ranges and hidden sheets
intact through a sync.

Implementation: [`packages/connectors/src/excel.ts`](../packages/connectors/src/excel.ts).

## Connecting a file you already maintain

1. **Outputs → New output → Excel workbook**
2. **Upload** your `.xlsx`. MsgFlow reads it immediately and shows the real worksheets, real column
   headers and sample values — so you map onto columns that genuinely exist rather than typing header
   names from memory.
3. Pick the worksheet to maintain.
4. Create the output, then connect it to an automation and map your fields.
5. Choose the **unique key** — how MsgFlow finds an existing row.

## Operations

| Operation | Behaviour |
|---|---|
| `CREATE_NEW` | A brand new file each run |
| `APPEND` | Always insert; no matching pass |
| `UPDATE_EXISTING` | Match required. Unmatched rows are reported as failures, never inserted |
| `UPSERT` | Match → update, no match → insert |
| `REPLACE` | Clear the data rows (header, formatting and other sheets untouched), then write |
| `GENERATE_NEW_VERSION` | Write to a new file; the previous one stays downloadable |

## How a row is found

Cheapest first:

1. **`OutputSyncRecord.externalRowId`** — after the first sync MsgFlow knows exactly which row each
   record owns. This is what makes a 15,000-row file cheap to maintain.
2. **Composite key lookup** — build the key from the mapped key fields and scan the key columns.
3. **No match** → insert (UPSERT/APPEND) or fail the row (UPDATE_EXISTING).

Keys are normalized before comparison: `"ABC Traders"`, `"abc traders"` and `"ABC  Traders"` are the
same customer. Without that normalization the system would create three records and your file would
grow duplicates.

## Update strategies

Set per field, because not every column should behave the same way:

| Strategy | Use it for |
|---|---|
| `ALWAYS_UPDATE` | Quantities, stock levels, status |
| `UPDATE_IF_EMPTY` | Notes someone may have filled in by hand |
| `NEVER_UPDATE` | Customer names, and anything a human owns |
| `UPDATE_IF_NEWER` | Values that should only move forward in time |

Two protections apply regardless of strategy:

- An extraction that produced **nothing** for a field never blanks an existing value.
- **Key fields are never rewritten** — changing them would re-target the update at a different row.

## What survives a write

Preserved:

- Cell formulas · number and date formats · fonts, fills and borders
- Merged cell ranges · named ranges · column widths and row heights
- Multiple worksheets, including hidden ones · data validation rules

**Formula cells are never overwritten with values.** If a mapped column contains a formula, MsgFlow
skips that cell and reports how many it skipped. Your spreadsheet logic outranks our data.

Not guaranteed — and stated in the UI *before* you activate an automation:

- **Pivot tables** are not recalculated. Refresh them in Excel after a sync.
- **Charts bound to ranges that shift** when rows are inserted may need re-pointing.
- **`.xlsm` macro workbooks are rejected outright.** Macros cannot be preserved through a
  programmatic write, so MsgFlow refuses the upload rather than silently destroying them. Save as
  `.xlsx`.
- Some **conditional-formatting rule types**, slicers and timelines.

A blanket "everything is preserved" promise would be false, so the product does not make one.

## Conflict protection

Before every write, MsgFlow re-reads the file's checksum and compares it against the one recorded at
the last successful sync. If they differ, somebody edited the file outside MsgFlow.

The sync **aborts without writing**, the output status becomes `CONFLICT`, and you are asked to
choose:

- **Use the latest file** — adopt the file as it now stands; row ownership is rebuilt from scratch on
  the next sync, because rows may have moved.
- **Keep MsgFlow's data** — the next sync overwrites the changed rows.
- **Dismiss and pause** — stop syncing until you decide.

There is deliberately **no "merge automatically"**. Silently reconciling two versions of a customer's
spreadsheet is exactly the kind of guess that loses data without anyone noticing.

## Versioning

Every file write creates an `OutputVersion` with a checksum, record count, size and storage
reference. From the output's **History** tab you can download any version or restore it.

Restoring snapshots the current file *first*, so rolling back is itself reversible. After a restore,
all row ownership is marked stale and rebuilt on the next sync.

## Atomic writes

Files are written to a temporary path and then renamed. A crash mid-write can never leave a
customer's workbook truncated.

## Worked example

Existing `sales.xlsx`:

| Customer | Product | Quantity | Rate | Notes | Total |
|---|---|---|---|---|---|
| ABC Traders | Product X | 20 | 250 | Regular customer | `=C2*D2` |

Mapping: `customerName → Customer` (key, NEVER_UPDATE), `product → Product` (key, NEVER_UPDATE),
`quantity → Quantity` (ALWAYS_UPDATE), `rate → Rate` (ALWAYS_UPDATE), `notes → Notes`
(UPDATE_IF_EMPTY). Operation: `UPSERT`.

WhatsApp: *"ABC Traders updated their order: now 75 kg Product X, same rate."*

Result: row 2's Quantity becomes 75. Rate is unchanged. Notes keeps "Regular customer". The `Total`
formula is untouched and recalculates to 18,750 when Excel opens the file. No new row is added.

This exact scenario is covered by the test suite — see
[`tests/excel.test.ts`](../tests/excel.test.ts).
