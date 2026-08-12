# AI

## The contract

One interface, four operations, in `packages/types/src/ai.ts`:

```ts
interface AIProvider {
  classifyMessage(input): Promise<AiResponse<ClassificationResult>>;
  extractStructuredData(input): Promise<AiResponse<ExtractionResult>>;
  generateAutomation(input): Promise<AiResponse<AutomationDraft>>;
  validateExtraction(input): Promise<AiResponse<ValidationVerdict>>;
}
```

Nothing in the application imports a vendor SDK directly. Four implementations exist: Anthropic,
OpenAI, Gemini, and a rule-based mock.

## Choosing a provider

```env
AI_PROVIDER="anthropic"        # anthropic | openai | gemini | mock
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_MODEL="claude-sonnet-5"
```

**If the selected provider has no key, MsgFlow falls back to the mock and says so** — in the status
bar, on the Settings page and in the Usage screen. A missing key degrades the product to rule-based
extraction; it does not take message processing down.

## The mock provider is not a stub

It is a genuine rule engine, and it exists for three reasons: Demo Mode works with no API key, tests
are deterministic and free, and a failing provider degrades to something useful.

It handles the message shapes Indian SMB groups actually produce:

- Quantities with units: `50 kg`, `120 pcs`, `2 nos`
- Rates: `₹250/kg`, `rs 1,250`, `@ 180`
- Magnitudes: `2.5k`, `3 lakh`, `1.2 cr`
- Dates: `15/08` as **day/month**, `15 Aug`, `tomorrow`, `today`
- Entity names before or after action verbs, with honorifics stripped
- Order references: `ORD-1041`, `PO 8823`, `INV-220`
- Indian mobile numbers
- Greetings, acknowledgements and sticker-only messages → `IGNORE`

## Classification

Sixteen categories (`SALES`, `ORDER`, `INVENTORY`, `PAYMENT`, `DELIVERY`, `COMPLAINT`, … `IGNORE`)
and four importance levels.

Results are cached on `MessageClassification`, so a message is classified once regardless of how many
automations read it.

`IGNORE` short-circuits the pipeline before extraction — the cheapest token is the one you do not
spend.

## Extraction

The prompt is built from the tenant's own field definitions. The hard rules given to every model:

- Return **only** the field keys supplied. Never invent fields.
- If a field is not stated, **omit it**. No `"N/A"`, no `"unknown"`, no `0` as filler.
- One message may describe several records — return one entry per record.
- Numbers plain, without symbols, commas or units.
- Dates as `YYYY-MM-DD`; `05/08` is **day/month**, never month/day.
- Confidence reflects how clearly the message stated the data.

Prompts live in one file (`packages/ai/src/prompts.ts`) so all three vendors send identical
instructions. A bug fixed in one prompt cannot silently persist in another.

## The validation gate

Model output never reaches the database directly:

```
AI → JSON recovery → coercion → runtime Zod schema (built from the tenant's fields) → ExtractedRecord
```

`packages/validation/src/dynamic.ts` builds a Zod schema at request time from the tenant's
`ExtractionField` rows. It coerces the real-world forms (`"₹1,250.50"` → `1250.5`, `"05/08/2026"` →
`"2026-08-05"`, case-insensitive enum matching) and rejects anything that does not fit.

Records that fail validation, or fall below the confidence threshold, are stored with status
`NEEDS_REVIEW` — they go to the review queue, never to a customer's file. They are not discarded: a
human can fix a bad extraction, but a discarded one is gone forever.

## Robustness

**JSON recovery.** Models wrap JSON in prose and code fences no matter how firmly the prompt says
not to. The parser tries the fenced block, the whole response, and an outermost balanced brace scan,
repairing trailing commas and `NaN` along the way. Failing an entire extraction over a ```json fence
would be a self-inflicted wound.

**Coercion.** A model that invents a category, returns `records` as a bare object, or answers `85`
when asked for `0.85` is corrected rather than allowed to crash the pipeline.

**Retries.** Only genuinely retryable failures — rate limits, overloads, timeouts, 5xx — are retried,
with exponential backoff. A malformed request repeated three times is three times the cost and the
same failure.

## Cost tracking

Every call writes an `AIUsage` row: provider, model, operation, input/output tokens, estimated cost,
duration, success. Rolled up daily into `Usage` and shown on the Usage screen.

Prices live in `packages/ai/src/pricing.ts`. They are **estimates for internal display**, and the UI
labels them as such rather than implying an invoice.

## Automation drafting

Natural language in, a complete draft out: name, schema with field types, processing mode, date-range
mode, suggested groups, output type, operation and key fields.

**Nothing is created or activated.** The draft is returned for review, every field is editable, and
creation and activation are two further explicit steps. An AI that could silently switch on a live
data pipeline would be a liability.

## Adding a provider

1. Implement `AIProvider` in `packages/ai/src/providers/`.
2. Reuse the shared prompts and the `coerce*` helpers from `providers/shared.ts`.
3. Register it in `factory.ts` and add its pricing.

Roughly 100 lines. The prompts, coercion, validation and cost tracking are already done.
