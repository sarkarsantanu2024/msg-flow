import { MESSAGE_CATEGORIES } from '@msgflow/types';
import type {
  AutomationDraftInput,
  ClassificationInput,
  ExtractionInput,
  ValidationInput,
} from '@msgflow/types';

/**
 * Prompt construction.
 *
 * Kept out of the provider files so all three vendors send the same
 * instructions — otherwise a bug fixed in the OpenAI prompt silently persists
 * in the Gemini one.
 */

export const CLASSIFICATION_SYSTEM_PROMPT = `You classify business messages from WhatsApp groups used by Indian SMBs.

Return STRICT JSON only. No prose, no markdown fences.

Schema:
{
  "category": one of [${MESSAGE_CATEGORIES.join(', ')}],
  "importance": one of [HIGH, MEDIUM, LOW, IGNORE],
  "confidence": number between 0 and 1,
  "reasoning": short string (max 200 chars),
  "entities": object of any named entities you noticed (customers, products, quantities, amounts, dates)
}

Guidance:
- IGNORE is for greetings, stickers, "ok", "thanks", forwards, and anything with no business content.
- HIGH importance means a concrete business event: an order, a payment, a stock change, a complaint, a delivery.
- Messages mixing chat and business content are classified by the business part.
- Indian business shorthand is normal: "pcs", "kg", "nos", "@", "rs", "₹", "lakh", "cr", "pls send".
- Hindi/Hinglish and regional transliteration are common. Classify on meaning, not language.
- Be honest with confidence. A vague message deserves a low score, not a confident guess.`;

export function buildClassificationPrompt(input: ClassificationInput): string {
  const allowed =
    input.allowedCategories && input.allowedCategories.length > 0
      ? `\nOnly these categories are relevant to this workspace: ${input.allowedCategories.join(', ')}. Anything else is OTHER or IGNORE.`
      : '';

  return `Classify this message.${allowed}

Group: ${input.groupName ?? 'Unknown'}
Sender: ${input.senderName ?? 'Unknown'}

Message:
"""
${input.text}
"""

Return the JSON object only.`;
}

export const EXTRACTION_SYSTEM_PROMPT = `You extract structured business data from WhatsApp messages for Indian SMBs.

Return STRICT JSON only. No prose, no markdown fences.

Schema:
{
  "records": [ { "data": { <field key>: <value> }, "confidence": number 0..1 } ],
  "confidence": number 0..1,
  "reasoning": short string (max 200 chars)
}

Hard rules:
- Return ONLY the field keys you are given. Never invent fields.
- If a field is not stated in the message, OMIT it. Do not guess, do not use "N/A", "unknown" or 0 as filler.
- One message may describe several records (e.g. three products in one order) — return one entry per record.
- If the message contains no data matching the schema, return {"records": [], "confidence": 0, "reasoning": "..."}.
- Numbers: return plain numbers without currency symbols, commas or units. "₹1,250/kg" is 1250. "2.5k" is 2500. "3 lakh" is 300000.
- Dates: return ISO format YYYY-MM-DD. Resolve relative dates ("tomorrow", "next Monday", "15th") against the message date supplied.
- Indian date shorthand like 05/08 is DAY/MONTH, never month/day.
- Preserve customer and product names as written, minus honorifics and trailing punctuation.
- confidence reflects how clearly the message stated the data, not how sure you are that you followed instructions.`;

export function buildExtractionPrompt(input: ExtractionInput): string {
  const fieldLines = input.fields
    .map((f) => {
      const bits = [`- ${f.key} (${f.type}${f.required ? ', required' : ', optional'})`, `: ${f.label}`];
      if (f.description) bits.push(` — ${f.description}`);
      if (f.enumValues?.length) bits.push(` [one of: ${f.enumValues.join(' | ')}]`);
      return bits.join('');
    })
    .join('\n');

  const examples =
    input.examples && input.examples.length > 0
      ? `\nWorked examples:\n${input.examples
          .slice(0, 5)
          .map((e, i) => `${i + 1}. Message: "${e.message}"\n   Expected: ${JSON.stringify(e.expected)}`)
          .join('\n')}\n`
      : '';

  const custom = input.systemPrompt ? `\nWorkspace-specific instructions:\n${input.systemPrompt}\n` : '';

  return `Extract "${input.schemaName}" records from the message below.

Fields to extract:
${fieldLines}
${examples}${custom}
Message date: ${input.messageDate ?? 'unknown'}
Group: ${input.groupName ?? 'Unknown'}
Sender: ${input.senderName ?? 'Unknown'}

Message:
"""
${input.text}
"""

Return the JSON object only.`;
}

export const AUTOMATION_SYSTEM_PROMPT = `You design data-extraction automations for MsgFlow, a platform that turns WhatsApp business messages into structured data and syncs it to spreadsheets and APIs.

Return STRICT JSON only. No prose, no markdown fences.

Schema:
{
  "name": string,
  "description": string,
  "suggestedGroupIds": string[],
  "categories": string[],
  "processingMode": one of [REAL_TIME, DAILY, WEEKLY, MONTHLY, CUSTOM, MANUAL],
  "dateRangeMode": one of [CURRENT_MESSAGE, TODAY, YESTERDAY, THIS_WEEK, LAST_WEEK, THIS_MONTH, LAST_MONTH, LAST_7_DAYS, CUSTOM, SINCE_LAST_SUCCESSFUL_RUN],
  "schema": { "name": string, "fields": [ { "key": camelCase, "label": string, "type": one of [STRING,TEXT,NUMBER,INTEGER,DECIMAL,BOOLEAN,DATE,DATETIME,ENUM,EMAIL,PHONE,CURRENCY], "required": boolean, "description": string } ] },
  "output": { "type": one of [EXCEL,CSV,GOOGLE_SHEETS,REST_API,WEBHOOK], "operation": one of [CREATE_NEW,APPEND,UPDATE_EXISTING,UPSERT,REPLACE,GENERATE_NEW_VERSION], "keyFields": string[] },
  "reasoning": string
}

Guidance:
- Pick 4-8 fields. A focused schema extracts more reliably than an exhaustive one.
- Always include a date field and whatever identifies the business entity (customer, order number, product).
- keyFields must uniquely identify a record. For sales: customer + product + date. For orders: the order number alone.
- If the user says "update my existing file", choose UPSERT. Only choose CREATE_NEW when they clearly want a fresh file each run.
- REAL_TIME suits event-driven work; DAILY suits reports. Match the user's words.
- Choose suggestedGroupIds only from the groups supplied. If none obviously matches, return an empty array.`;

export function buildAutomationPrompt(input: AutomationDraftInput): string {
  const groups =
    input.availableGroups.length > 0
      ? input.availableGroups.map((g) => `- ${g.id}: "${g.name}"`).join('\n')
      : '(no groups are being monitored yet)';

  return `Design an automation for this request:

"""
${input.prompt}
"""

Available WhatsApp groups:
${groups}

Return the JSON object only.`;
}

export const VALIDATION_SYSTEM_PROMPT = `You review structured data that was extracted from a message, and judge whether it faithfully reflects what the message said.

Return STRICT JSON only. No prose, no markdown fences.

Schema:
{
  "valid": boolean,
  "issues": [ { "field": string, "issue": string, "severity": "error" | "warning" } ],
  "correctedData": object (include ONLY if you are correcting something),
  "confidence": number 0..1
}

Rules:
- "error" means the value contradicts the message or is clearly wrong (wrong number, invented customer).
- "warning" means it is plausible but uncertain (ambiguous date, unclear unit).
- Do not flag a field as an error merely because it is absent — absence is legitimate when the message did not say.
- Only include correctedData when you are confident of the correct value from the message text itself.`;

export function buildValidationPrompt(input: ValidationInput): string {
  const fieldList = input.fields.map((f) => `- ${f.key} (${f.type}): ${f.label}`).join('\n');
  return `Review this extraction.

Fields:
${fieldList}

Extracted data:
${JSON.stringify(input.data, null, 2)}

Original message:
"""
${input.originalText}
"""

Return the JSON object only.`;
}
