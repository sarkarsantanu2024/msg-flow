import { GoogleGenerativeAI } from '@google/generative-ai';
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
  SchemaFromImageInput,
  SchemaFromImageResult,
  ValidationInput,
  ValidationVerdict,
} from '@msgflow/types';
import { parseJsonResponse, normalizeConfidence } from '../json.js';
import { estimateCostUsd, estimateTokens } from '../pricing.js';
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

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini' as const;
  readonly model: string;
  readonly isConfigured: boolean;
  private client: GoogleGenerativeAI | null;

  constructor(apiKey: string, model = 'gemini-2.0-flash') {
    this.model = model;
    this.isConfigured = apiKey.length > 0;
    this.client = this.isConfigured ? new GoogleGenerativeAI(apiKey) : null;
  }

  private async call(system: string, prompt: string, maxTokens: number) {
    if (!this.client) {
      throw new AppError('AI_NOT_CONFIGURED', 'GEMINI_API_KEY is not set.');
    }
    const started = Date.now();
    try {
      const model = this.client.getGenerativeModel({
        model: this.model,
        systemInstruction: system,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
        },
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      const usage = result.response.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? estimateTokens(system + prompt);
      const outputTokens = usage?.candidatesTokenCount ?? estimateTokens(text);

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
      const retryable = /rate|429|500|502|503|504|timeout|overload|quota/i.test(message);
      throw new AppError('AI_FAILED', `Gemini request failed: ${message}`, { retryable });
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

  async proposeSchemaFromImage(
    _input: SchemaFromImageInput,
  ): Promise<AiResponse<SchemaFromImageResult>> {
    // Image-to-schema is implemented for the Anthropic provider (and mocked).
    // Wire this provider's vision API here when it is needed; until then a
    // clear error beats a silently wrong proposal.
    throw new AppError(
      'AI_NOT_CONFIGURED',
      `Schema-from-image is not implemented for the ${this.name} provider yet. Set AI_PROVIDER=anthropic to use it.`,
    );
  }
}
