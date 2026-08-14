import type {
  AIProvider,
  AiResponse,
  AutomationDraft,
  AutomationDraftInput,
  ClassificationInput,
  ClassificationResult,
  ExtractionInput,
  ExtractionResult,
  ValidationInput,
  SchemaFromImageInput,
  SchemaFromImageResult,
  ValidationVerdict,
  AiCategory,
} from '@msgflow/types';
import { estimateTokens } from '../pricing.js';

/**
 * Deterministic rule-based provider.
 *
 * Three jobs:
 *  1. Demo Mode works with no API key at all.
 *  2. Tests assert on exact outputs without network calls or spend.
 *  3. A missing/failing provider degrades to something useful rather than
 *     taking the whole pipeline down.
 *
 * It is genuinely useful, not a stub: the heuristics below handle the message
 * shapes Indian SMB groups actually produce (quantities with units, ₹ rates,
 * dd/mm dates, Hinglish verbs).
 */

interface CategoryRule {
  category: AiCategory;
  patterns: RegExp[];
  importance: 'HIGH' | 'MEDIUM' | 'LOW';
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'ORDER',
    importance: 'HIGH',
    patterns: [/\border(ed|s)?\b/i, /\bpo\b/i, /purchase order/i, /\bord[-\s]?\d+/i, /place[d]?\s+an?\s+order/i],
  },
  {
    category: 'SALES',
    importance: 'HIGH',
    patterns: [/\benquir(y|ies)\b/i, /\bquot(e|ation)\b/i, /\brequire(s|d|ment)?\b/i, /\bneed(s)?\b/i, /\binterested\b/i, /\bchahiye\b/i],
  },
  {
    category: 'INVENTORY',
    importance: 'HIGH',
    patterns: [/\bstock\b/i, /\binventory\b/i, /\bbalance\s+qty\b/i, /\bout of stock\b/i, /\brestock\b/i, /\bgodown\b/i],
  },
  {
    category: 'PAYMENT',
    importance: 'HIGH',
    patterns: [/\bpayment\b/i, /\bpaid\b/i, /\bneft\b/i, /\brtgs\b/i, /\bupi\b/i, /\binvoice\b/i, /\boutstanding\b/i, /\breceived\s+₹/i],
  },
  {
    category: 'DELIVERY',
    importance: 'HIGH',
    patterns: [/\bdeliver(y|ed|ing)?\b/i, /\bdispatch(ed)?\b/i, /\bshipp?(ed|ing)\b/i, /\blr\s*no/i, /\becomm?\b/i],
  },
  {
    category: 'LOGISTICS',
    importance: 'MEDIUM',
    patterns: [/\btransport\b/i, /\btruck\b/i, /\bvehicle\b/i, /\bcourier\b/i, /\bfreight\b/i],
  },
  {
    category: 'COMPLAINT',
    importance: 'HIGH',
    patterns: [/\bcomplain(t|ts)?\b/i, /\bdamaged?\b/i, /\bdefect(ive)?\b/i, /\bwrong\s+(item|product|qty)/i, /\breturn\b/i, /\bissue\b/i, /\bnot happy\b/i],
  },
  {
    category: 'CUSTOMER',
    importance: 'MEDIUM',
    patterns: [/\bcustomer\b/i, /\bclient\b/i, /\bnew lead\b/i, /\bcontact\s+details\b/i],
  },
  {
    category: 'MEETING',
    importance: 'MEDIUM',
    patterns: [/\bmeeting\b/i, /\bcall at\b/i, /\bschedule[d]?\b/i, /\bagenda\b/i, /\bzoom\b/i, /\bgoogle meet\b/i],
  },
  {
    category: 'TASK',
    importance: 'MEDIUM',
    patterns: [/\bplease\s+(do|send|share|prepare)\b/i, /\bfollow[- ]?up\b/i, /\btodo\b/i, /\bassign(ed)?\b/i, /\bkar\s+do\b/i],
  },
  { category: 'PURCHASE', importance: 'MEDIUM', patterns: [/\bpurchase\b/i, /\bvendor\b/i, /\bsupplier\b/i, /\bprocure(ment)?\b/i] },
  { category: 'FINANCE', importance: 'MEDIUM', patterns: [/\bgst\b/i, /\btds\b/i, /\bledger\b/i, /\bbalance sheet\b/i, /\bexpense\b/i] },
  { category: 'HR', importance: 'LOW', patterns: [/\bleave\b/i, /\bsalary\b/i, /\battendance\b/i, /\bjoining\b/i, /\bresign/i] },
  { category: 'ANNOUNCEMENT', importance: 'LOW', patterns: [/\bholiday\b/i, /\bnotice\b/i, /\bannouncement\b/i, /\ball\s+staff\b/i] },
];

const IGNORE_PATTERNS = [
  /^(hi|hello|hey|good morning|good evening|good night|gm|gn|ok|okay|k|thanks|thank you|ty|welcome|yes|no|sure|done|noted|got it|👍|🙏|😊)[\s!.]*$/i,
  /^\p{Extended_Pictographic}+$/u,
  /^forwarded/i,
];

function delay(): Promise<void> {
  // A few ms so async ordering in tests matches the real providers.
  return new Promise((resolve) => setTimeout(resolve, 5));
}

function meta(inputText: string, outputText: string, durationMs: number) {
  return {
    provider: 'mock',
    model: 'mock-rules-v1',
    inputTokens: estimateTokens(inputText),
    outputTokens: estimateTokens(outputText),
    costUsd: 0,
    durationMs,
  };
}

/** Parse "50 kg", "50kg", "qty 50", "50 nos", "50 pcs". */
function findQuantity(text: string): { value: number; unit: string | null } | null {
  const m = text.match(/(?:qty|quantity)?\s*(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|gm|g|ton|tons|mt|pcs|pieces|nos|no|units?|box|boxes|bags?|ltr|liters?|l)\b/i);
  if (m) return { value: Number(m[1]), unit: normalizeUnit(m[2]) };
  const bare = text.match(/\b(?:qty|quantity)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i);
  if (bare) return { value: Number(bare[1]), unit: null };
  return null;
}

function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase();
  if (['kg', 'kgs', 'kilo'].includes(u)) return 'kg';
  if (['pcs', 'pieces', 'nos', 'no', 'unit', 'units'].includes(u)) return 'pcs';
  if (['ltr', 'liter', 'liters', 'l'].includes(u)) return 'ltr';
  if (['ton', 'tons', 'mt'].includes(u)) return 'ton';
  return u;
}

/** Parse "₹250", "rs 250", "250/kg", "@ 250". */
function findRate(text: string): number | null {
  const patterns = [
    /(?:₹|rs\.?|inr)\s*(\d+(?:,\d{2,3})*(?:\.\d+)?)/i,
    /@\s*(\d+(?:,\d{2,3})*(?:\.\d+)?)/,
    /(\d+(?:,\d{2,3})*(?:\.\d+)?)\s*(?:\/|per\s*)(?:kg|pcs|unit|nos|ltr)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      let n = Number(m[1].replace(/,/g, ''));
      if (/lakh/i.test(text)) n *= 100_000;
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function findDate(text: string, fallbackIso?: string): string | null {
  const base = fallbackIso ? new Date(fallbackIso) : new Date('2026-08-12T00:00:00Z');

  const dmy = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = dmy[3] ? Number(dmy[3]) : base.getUTCFullYear();
    if (year < 100) year += 2000;
    if (day <= 31 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const named = text.match(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
  if (named) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(named[2].toLowerCase()) + 1;
    return `${base.getUTCFullYear()}-${String(month).padStart(2, '0')}-${String(Number(named[1])).padStart(2, '0')}`;
  }

  if (/\btomorrow\b/i.test(text)) {
    const d = new Date(base.getTime() + 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  if (/\btoday\b/i.test(text)) return base.toISOString().slice(0, 10);
  if (/\byesterday\b/i.test(text)) return new Date(base.getTime() - 86_400_000).toISOString().slice(0, 10);

  return null;
}

/**
 * Pull a business-entity name. Looks for the grammatical subject before an
 * action verb ("ABC Traders ordered…", "order from ABC Traders").
 */
function findEntityName(text: string): string | null {
  const after = text.match(
    /(?:from|for|to|customer|client|party|buyer)\s*[:\-]?\s*([A-Z][\w&.]*(?:\s+[A-Z][\w&.]*){0,3})/,
  );
  if (after?.[1]) return cleanName(after[1]);

  const before = text.match(
    /\b([A-Z][\w&.]*(?:\s+[A-Z][\w&.]*){0,3})\s+(?:ordered|order|requires?|required|needs?|wants?|has|have|placed|sent|paid)\b/,
  );
  if (before?.[1]) return cleanName(before[1]);

  return null;
}

function cleanName(raw: string): string {
  return raw
    .replace(/\b(sir|madam|ji|shri|mr|mrs|ms)\b\.?/gi, '')
    .replace(/[.,;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findProduct(text: string): string | null {
  const m = text.match(/\bproduct\s+([A-Za-z0-9][\w-]*)/i) ?? text.match(/\bitem\s*[:\-]?\s*([A-Za-z0-9][\w-]*)/i);
  if (m?.[1]) return cleanName(m[1]);
  return null;
}

function findOrderId(text: string): string | null {
  const m = text.match(/\b((?:ord|po|inv|so)[-\s]?\d{3,})\b/i);
  return m ? m[1].toUpperCase().replace(/\s/g, '-') : null;
}

function findPhone(text: string): string | null {
  const m = text.match(/\b(?:\+91[\s-]?)?([6-9]\d{9})\b/);
  return m ? m[0].replace(/\s|-/g, '') : null;
}

export class MockProvider implements AIProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock-rules-v1';
  readonly isConfigured = true;

  async classifyMessage(input: ClassificationInput): Promise<AiResponse<ClassificationResult>> {
    const started = Date.now();
    await delay();
    const text = input.text.trim();

    if (!text || IGNORE_PATTERNS.some((p) => p.test(text))) {
      const result: ClassificationResult = {
        category: 'IGNORE',
        importance: 'IGNORE',
        confidence: 0.95,
        reasoning: 'Greeting, acknowledgement or empty message with no business content.',
        entities: {},
      };
      return { data: result, meta: meta(text, JSON.stringify(result), Date.now() - started) };
    }

    let best: CategoryRule | null = null;
    let bestScore = 0;
    for (const rule of CATEGORY_RULES) {
      const score = rule.patterns.reduce((acc, p) => acc + (p.test(text) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = rule;
      }
    }

    const allowed = input.allowedCategories;
    if (best && allowed && allowed.length > 0 && !allowed.includes(best.category)) {
      best = null;
      bestScore = 0;
    }

    const entities: Record<string, unknown> = {};
    const qty = findQuantity(text);
    if (qty) entities.quantity = qty.value;
    if (qty?.unit) entities.unit = qty.unit;
    const rate = findRate(text);
    if (rate !== null) entities.rate = rate;
    const name = findEntityName(text);
    if (name) entities.customerName = name;
    const product = findProduct(text);
    if (product) entities.product = product;
    const orderId = findOrderId(text);
    if (orderId) entities.orderId = orderId;
    const phone = findPhone(text);
    if (phone) entities.phone = phone;
    const date = findDate(text);
    if (date) entities.date = date;

    // More corroborating signals ⇒ higher confidence, capped so the mock never
    // claims certainty it has not earned.
    const signalBonus = Math.min(0.2, Object.keys(entities).length * 0.04);
    const confidence = best ? Math.min(0.94, 0.55 + bestScore * 0.12 + signalBonus) : 0.4;

    const result: ClassificationResult = {
      category: best?.category ?? 'OTHER',
      importance: best?.importance ?? (Object.keys(entities).length >= 2 ? 'MEDIUM' : 'LOW'),
      confidence,
      reasoning: best
        ? `Matched ${bestScore} ${best.category.toLowerCase()} pattern(s)${Object.keys(entities).length ? ` and found ${Object.keys(entities).length} entities` : ''}.`
        : 'No strong category signal; treated as general business chatter.',
      entities,
    };

    return { data: result, meta: meta(text, JSON.stringify(result), Date.now() - started) };
  }

  async extractStructuredData(input: ExtractionInput): Promise<AiResponse<ExtractionResult>> {
    const started = Date.now();
    await delay();
    const text = input.text.trim();

    const qty = findQuantity(text);
    const rate = findRate(text);
    const customer = findEntityName(text);
    const product = findProduct(text);
    const orderId = findOrderId(text);
    const phone = findPhone(text);
    const date = findDate(text, input.messageDate);

    const data: Record<string, unknown> = {};
    let filled = 0;

    for (const field of input.fields) {
      const key = field.key.toLowerCase();
      let value: unknown;

      if (/(customer|client|party|buyer|company|account)/.test(key)) value = customer;
      else if (/(product|item|material|sku|goods)/.test(key)) value = product;
      else if (/(quantity|qty|volume)/.test(key)) value = qty?.value;
      else if (/^unit$|uom/.test(key)) value = qty?.unit;
      else if (/(rate|price|amount|value|total|cost)/.test(key)) {
        value = rate;
        if (/total|amount/.test(key) && rate !== null && qty) value = rate * qty.value;
      } else if (/(orderid|order_?no|invoice|reference|refno)/.test(key)) value = orderId;
      else if (/(phone|mobile|contact)/.test(key)) value = phone;
      else if (/(date|delivery|due|when)/.test(key)) value = date;
      else if (/(salesperson|sales_?rep|owner|assigned)/.test(key)) value = input.senderName ?? null;
      else if (/(status|stage)/.test(key)) {
        value = field.enumValues?.length ? field.enumValues[0] : 'New';
      } else if (/(note|remark|description|detail|comment)/.test(key)) {
        value = text.slice(0, 280);
      }

      if (value !== null && value !== undefined && value !== '') {
        data[field.key] = value;
        filled++;
      }
    }

    const required = input.fields.filter((f) => f.required);
    const requiredFilled = required.filter((f) => data[f.key] !== undefined).length;
    const hasEnough = required.length === 0 ? filled > 0 : requiredFilled === required.length;

    const coverage = input.fields.length > 0 ? filled / input.fields.length : 0;
    const confidence = hasEnough ? Math.min(0.92, 0.55 + coverage * 0.4) : 0.35;

    const result: ExtractionResult = {
      records: hasEnough ? [{ data, confidence }] : [],
      confidence: hasEnough ? confidence : 0,
      reasoning: hasEnough
        ? `Rule-based extraction filled ${filled} of ${input.fields.length} fields.`
        : `Could not fill the required field(s): ${required
            .filter((f) => data[f.key] === undefined)
            .map((f) => f.key)
            .join(', ')}.`,
    };

    return { data: result, meta: meta(text, JSON.stringify(result), Date.now() - started) };
  }

  async generateAutomation(input: AutomationDraftInput): Promise<AiResponse<AutomationDraft>> {
    const started = Date.now();
    await delay();
    const p = input.prompt.toLowerCase();

    const wantsUpdate = /(update|maintain|existing|master|sync|keep.*up to date)/.test(p);
    const daily = /(daily|every day|each day|end of day|eod)/.test(p);
    const weekly = /(weekly|every week|each week)/.test(p);
    const monthly = /(monthly|every month|each month)/.test(p);

    const isInventory = /(stock|inventory|godown|warehouse)/.test(p);
    const isOrder = /(order|po\b|purchase)/.test(p);
    const isDelivery = /(deliver|dispatch|shipment|logistics)/.test(p);
    const isComplaint = /(complaint|issue|damage|return)/.test(p);

    let schemaName = 'Sales Enquiry';
    let categories: AiCategory[] = ['SALES', 'ORDER'];
    let fields = [
      { key: 'date', label: 'Date', type: 'DATE', required: true, description: 'Date of the enquiry' },
      { key: 'customerName', label: 'Customer', type: 'STRING', required: true, description: 'Customer or company name' },
      { key: 'product', label: 'Product', type: 'STRING', required: true, description: 'Product enquired about' },
      { key: 'quantity', label: 'Quantity', type: 'DECIMAL', required: false, description: 'Quantity requested' },
      { key: 'unit', label: 'Unit', type: 'STRING', required: false, description: 'Unit of measure' },
      { key: 'rate', label: 'Rate', type: 'CURRENCY', required: false, description: 'Quoted rate per unit' },
      { key: 'salesPerson', label: 'Sales Person', type: 'STRING', required: false, description: 'Who reported it' },
    ];
    let keyFields = ['date', 'customerName', 'product'];

    if (isInventory) {
      schemaName = 'Inventory Update';
      categories = ['INVENTORY'];
      fields = [
        { key: 'date', label: 'Date', type: 'DATE', required: true, description: 'Date of the stock update' },
        { key: 'product', label: 'Product', type: 'STRING', required: true, description: 'Product or SKU' },
        { key: 'stock', label: 'Stock', type: 'DECIMAL', required: true, description: 'Current stock level' },
        { key: 'unit', label: 'Unit', type: 'STRING', required: false, description: 'Unit of measure' },
        { key: 'location', label: 'Location', type: 'STRING', required: false, description: 'Warehouse or godown' },
      ];
      keyFields = ['product'];
    } else if (isDelivery) {
      schemaName = 'Delivery Update';
      categories = ['DELIVERY', 'LOGISTICS'];
      fields = [
        { key: 'date', label: 'Date', type: 'DATE', required: true, description: 'Dispatch or delivery date' },
        { key: 'orderId', label: 'Order ID', type: 'STRING', required: true, description: 'Order or LR number' },
        { key: 'customerName', label: 'Customer', type: 'STRING', required: false, description: 'Receiving party' },
        { key: 'status', label: 'Status', type: 'ENUM', required: false, description: 'Delivery status' },
        { key: 'vehicle', label: 'Vehicle', type: 'STRING', required: false, description: 'Vehicle or courier' },
      ];
      keyFields = ['orderId'];
    } else if (isComplaint) {
      schemaName = 'Customer Complaint';
      categories = ['COMPLAINT', 'CUSTOMER'];
      fields = [
        { key: 'date', label: 'Date', type: 'DATE', required: true, description: 'Date raised' },
        { key: 'customerName', label: 'Customer', type: 'STRING', required: true, description: 'Complaining customer' },
        { key: 'product', label: 'Product', type: 'STRING', required: false, description: 'Product involved' },
        { key: 'issue', label: 'Issue', type: 'TEXT', required: true, description: 'What went wrong' },
        { key: 'severity', label: 'Severity', type: 'ENUM', required: false, description: 'How serious' },
      ];
      keyFields = ['date', 'customerName'];
    } else if (isOrder) {
      schemaName = 'Order';
      categories = ['ORDER', 'SALES'];
      fields = [
        { key: 'orderId', label: 'Order ID', type: 'STRING', required: true, description: 'Order number' },
        { key: 'date', label: 'Date', type: 'DATE', required: true, description: 'Order date' },
        { key: 'customerName', label: 'Customer', type: 'STRING', required: true, description: 'Customer name' },
        { key: 'product', label: 'Product', type: 'STRING', required: true, description: 'Product ordered' },
        { key: 'quantity', label: 'Quantity', type: 'DECIMAL', required: true, description: 'Quantity ordered' },
        { key: 'rate', label: 'Rate', type: 'CURRENCY', required: false, description: 'Agreed rate' },
      ];
      keyFields = ['orderId'];
    }

    const draft: AutomationDraft = {
      name: `${schemaName} Extraction`,
      description: `Generated from: "${input.prompt.slice(0, 160)}"`,
      suggestedGroupIds: pickGroups(input.availableGroups, p),
      categories,
      processingMode: monthly ? 'MONTHLY' : weekly ? 'WEEKLY' : daily ? 'DAILY' : 'REAL_TIME',
      dateRangeMode: monthly
        ? 'LAST_MONTH'
        : weekly
          ? 'LAST_WEEK'
          : daily
            ? 'TODAY'
            : 'SINCE_LAST_SUCCESSFUL_RUN',
      schema: { name: schemaName, fields },
      output: {
        type: /google\s*sheet/.test(p) ? 'GOOGLE_SHEETS' : /api|website|crm/.test(p) ? 'REST_API' : 'EXCEL',
        operation: wantsUpdate ? 'UPSERT' : 'CREATE_NEW',
        keyFields,
      },
      reasoning: `Rule-based draft (no AI provider configured). Detected ${schemaName.toLowerCase()} intent${wantsUpdate ? ' with an update-existing requirement' : ''}. Review every field before activating.`,
    };

    return { data: draft, meta: meta(input.prompt, JSON.stringify(draft), Date.now() - started) };
  }

  async validateExtraction(input: ValidationInput): Promise<AiResponse<ValidationVerdict>> {
    const started = Date.now();
    await delay();

    const issues: ValidationVerdict['issues'] = [];
    const lowerText = input.originalText.toLowerCase();

    for (const field of input.fields) {
      const value = input.data[field.key];
      if (field.required && (value === undefined || value === null || value === '')) {
        issues.push({ field: field.key, issue: `${field.label} is required but was not extracted.`, severity: 'error' });
        continue;
      }
      if (value === undefined || value === null || value === '') continue;

      // A string value that appears nowhere in the source text is the classic
      // hallucination signature — worth flagging even from a rule engine.
      if (typeof value === 'string' && value.length > 3 && !/(note|remark|description|detail|status)/i.test(field.key)) {
        if (!lowerText.includes(value.toLowerCase().slice(0, Math.min(value.length, 12)))) {
          issues.push({
            field: field.key,
            issue: `"${value}" does not appear in the original message.`,
            severity: 'warning',
          });
        }
      }
      if (typeof value === 'number' && value < 0) {
        issues.push({ field: field.key, issue: `${field.label} is negative.`, severity: 'warning' });
      }
    }

    const verdict: ValidationVerdict = {
      valid: !issues.some((i) => i.severity === 'error'),
      issues,
      confidence: issues.length === 0 ? 0.9 : Math.max(0.3, 0.9 - issues.length * 0.15),
    };

    return {
      data: verdict,
      meta: meta(input.originalText, JSON.stringify(verdict), Date.now() - started),
    };
  }

  async proposeSchemaFromImage(
    input: SchemaFromImageInput,
  ): Promise<AiResponse<SchemaFromImageResult>> {
    const started = Date.now();
    await delay();
    // The mock cannot see. It returns a plausible business-tracking schema so
    // the upload flow is demonstrable end-to-end without an API key, and says
    // so in the reasoning rather than pretending it read the image.
    const proposal: SchemaFromImageResult = {
      name: 'Tracked enquiries',
      fields: [
        { key: 'date', label: 'Date', type: 'DATE', required: true, isKeyField: true },
        { key: 'partyName', label: 'Party Name', type: 'STRING', required: true, isKeyField: true },
        { key: 'productName', label: 'Product Name', type: 'STRING', required: true },
        { key: 'quantity', label: 'Quantity', type: 'NUMBER', required: false },
        { key: 'rate', label: 'Rate', type: 'CURRENCY', required: false },
        { key: 'remarks', label: 'Remarks', type: 'STRING', required: false },
      ] as SchemaFromImageResult['fields'],
      reasoning:
        'Mock provider: no vision available, so this is a generic enquiry-tracking schema. Configure a real AI provider to have the image actually read.',
    };
    return {
      data: proposal,
      meta: meta(input.hint ?? 'image', JSON.stringify(proposal), Date.now() - started),
    };
  }
}

function pickGroups(groups: Array<{ id: string; name: string }>, prompt: string): string[] {
  if (groups.length === 0) return [];
  const scored = groups
    .map((g) => {
      const words = g.name.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const score = words.reduce((acc, w) => acc + (prompt.includes(w) ? 1 : 0), 0);
      return { id: g.id, score };
    })
    .filter((g) => g.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((g) => g.id);
}
