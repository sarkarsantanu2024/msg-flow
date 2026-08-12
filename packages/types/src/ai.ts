export const MESSAGE_CATEGORIES = [
  'SALES',
  'ORDER',
  'PURCHASE',
  'INVENTORY',
  'PAYMENT',
  'CUSTOMER',
  'COMPLAINT',
  'MEETING',
  'TASK',
  'HR',
  'FINANCE',
  'DELIVERY',
  'LOGISTICS',
  'ANNOUNCEMENT',
  'OTHER',
  'IGNORE',
] as const;

export type AiCategory = (typeof MESSAGE_CATEGORIES)[number];

export const IMPORTANCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW', 'IGNORE'] as const;
export type AiImportance = (typeof IMPORTANCE_LEVELS)[number];

export interface ClassificationInput {
  text: string;
  groupName?: string;
  senderName?: string;
  /** Restrict the model to the categories this tenant actually cares about. */
  allowedCategories?: AiCategory[];
}

export interface ClassificationResult {
  category: AiCategory;
  importance: AiImportance;
  confidence: number;
  reasoning: string;
  entities: Record<string, unknown>;
}

export interface ExtractionFieldSpec {
  key: string;
  label: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
}

export interface ExtractionInput {
  text: string;
  fields: ExtractionFieldSpec[];
  schemaName: string;
  systemPrompt?: string;
  examples?: Array<{ message: string; expected: Record<string, unknown> }>;
  groupName?: string;
  senderName?: string;
  /** Message timestamp in ISO form, so the model can resolve "tomorrow". */
  messageDate?: string;
}

export interface ExtractionResult {
  /** Zero, one or many records — a single message can mention several orders. */
  records: Array<{ data: Record<string, unknown>; confidence: number }>;
  confidence: number;
  reasoning: string;
}

export interface AutomationDraftInput {
  prompt: string;
  availableGroups: Array<{ id: string; name: string }>;
}

export interface AutomationDraft {
  name: string;
  description: string;
  suggestedGroupIds: string[];
  categories: AiCategory[];
  processingMode: 'REAL_TIME' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM' | 'MANUAL';
  dateRangeMode: string;
  schema: {
    name: string;
    fields: ExtractionFieldSpec[];
  };
  output: {
    type: string;
    operation: string;
    keyFields: string[];
  };
  reasoning: string;
}

export interface ValidationInput {
  data: Record<string, unknown>;
  fields: ExtractionFieldSpec[];
  originalText: string;
}

export interface ValidationVerdict {
  valid: boolean;
  issues: Array<{ field: string; issue: string; severity: 'error' | 'warning' }>;
  correctedData?: Record<string, unknown>;
  confidence: number;
}

export interface AiCallMetadata {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface AiResponse<T> {
  data: T;
  meta: AiCallMetadata;
}

/**
 * The AI contract. Four operations, three real providers plus a deterministic
 * mock. Nothing in the application imports a vendor SDK directly.
 */
export interface AIProvider {
  readonly name: 'openai' | 'gemini' | 'anthropic' | 'mock';
  readonly model: string;
  /** False when the provider has no API key — callers fall back to mock. */
  readonly isConfigured: boolean;

  classifyMessage(input: ClassificationInput): Promise<AiResponse<ClassificationResult>>;
  extractStructuredData(input: ExtractionInput): Promise<AiResponse<ExtractionResult>>;
  generateAutomation(input: AutomationDraftInput): Promise<AiResponse<AutomationDraft>>;
  validateExtraction(input: ValidationInput): Promise<AiResponse<ValidationVerdict>>;
}
