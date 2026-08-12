import OpenAI from 'openai';
import { AppError } from '@msgflow/types';
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
  ValidationVerdict,
} from '@msgflow/types';
import { parseJsonResponse, normalizeConfidence } from '../json.js';
import { estimateCostUsd } from '../pricing.js';
import {
  AUTOMATION_SYSTEM_PROMPT,
  CLASSIFICATION_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  VALIDATION_SYSTEM_PROMPT,
  buildAutomationPrompt,
  buildClassificationPrompt,
  buildExtractionPrompt,
  buildValidationPrompt,
} from '../prompts.js';
import { coerceClassification, coerceExtraction, coerceAutomationDraft, coerceVerdict } from './shared.js';

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  readonly isConfigured: boolean;
  private client: OpenAI | null;

  constructor(apiKey: string, model = 'gpt-4o') {
    this.model = model;
    this.isConfigured = apiKey.length > 0;
    this.client = this.isConfigured ? new OpenAI({ apiKey }) : null;
  }

  private async call(system: string, prompt: string, maxTokens: number) {
    if (!this.client) {
      throw new AppError('AI_NOT_CONFIGURED', 'OPENAI_API_KEY is not set.');
    }
    const started = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: maxTokens,
        temperature: 0,
        // Guarantees parseable output; the prompts already demand JSON, but the
        // response_format is what makes it structural rather than aspirational.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      });

      const text = response.choices[0]?.message?.content ?? '';
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;

      return {
        text,
        meta: {
          provider: this.name,
          model: this.model,
          inputTokens,
          outputTokens,
          costUsd: estimateCostUsd(this.model, inputTokens, outputTokens),
          durationMs: Date.now() - started,
        },
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const retryable = /rate|429|500|502|503|504|timeout|overload/i.test(message);
      throw new AppError('AI_FAILED', `OpenAI request failed: ${message}`, { retryable });
    }
  }

  async classifyMessage(input: ClassificationInput): Promise<AiResponse<ClassificationResult>> {
    const { text, meta } = await this.call(CLASSIFICATION_SYSTEM_PROMPT, buildClassificationPrompt(input), 1024);
    return { data: coerceClassification(parseJsonResponse(text)), meta };
  }

  async extractStructuredData(input: ExtractionInput): Promise<AiResponse<ExtractionResult>> {
    const { text, meta } = await this.call(EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt(input), 4096);
    return { data: coerceExtraction(parseJsonResponse(text)), meta };
  }

  async generateAutomation(input: AutomationDraftInput): Promise<AiResponse<AutomationDraft>> {
    const { text, meta } = await this.call(AUTOMATION_SYSTEM_PROMPT, buildAutomationPrompt(input), 4096);
    return { data: coerceAutomationDraft(parseJsonResponse(text)), meta };
  }

  async validateExtraction(input: ValidationInput): Promise<AiResponse<ValidationVerdict>> {
    const { text, meta } = await this.call(VALIDATION_SYSTEM_PROMPT, buildValidationPrompt(input), 2048);
    const parsed = parseJsonResponse<Record<string, unknown>>(text);
    return { data: coerceVerdict(parsed, normalizeConfidence(parsed.confidence)), meta };
  }
}
