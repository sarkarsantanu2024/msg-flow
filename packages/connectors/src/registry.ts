import { AppError } from '@msgflow/types';
import type { OutputConnector } from '@msgflow/types';
import { excelConnector } from './excel.js';
import { csvConnector } from './csv.js';
import { googleSheetsConnector } from './sheets.js';
import { webhookConnector } from './webhook.js';
import { restApiConnector } from './rest-api.js';
import { pdfConnector } from './pdf.js';
import { pptxConnector } from './pptx.js';

/**
 * Output type → connector.
 *
 * CLIENT_WEBSITE and CLIENT_ADMIN are the REST connector under friendlier
 * names: from the platform's point of view "update the client's admin panel"
 * and "call the client's API" are the same operation with different labels in
 * the UI.
 */
const REGISTRY: Record<string, OutputConnector> = {
  EXCEL: excelConnector,
  CSV: csvConnector,
  GOOGLE_SHEETS: googleSheetsConnector,
  WEBHOOK: webhookConnector,
  REST_API: restApiConnector,
  CLIENT_WEBSITE: restApiConnector,
  CLIENT_ADMIN: restApiConnector,
  PDF: pdfConnector,
  POWERPOINT: pptxConnector,
};

export function getConnector(outputType: string): OutputConnector {
  const connector = REGISTRY[outputType];
  if (!connector) {
    throw new AppError('VALIDATION_FAILED', `No connector is registered for output type "${outputType}".`);
  }
  return connector;
}

export function listConnectorTypes(): string[] {
  return Object.keys(REGISTRY);
}

/** Which operations genuinely make sense for each output type. */
export const SUPPORTED_OPERATIONS: Record<string, string[]> = {
  EXCEL: ['CREATE_NEW', 'APPEND', 'UPDATE_EXISTING', 'UPSERT', 'REPLACE', 'GENERATE_NEW_VERSION'],
  CSV: ['CREATE_NEW', 'APPEND', 'UPDATE_EXISTING', 'UPSERT', 'REPLACE', 'GENERATE_NEW_VERSION'],
  GOOGLE_SHEETS: ['CREATE_NEW', 'APPEND', 'UPDATE_EXISTING', 'UPSERT', 'REPLACE'],
  REST_API: ['CREATE_NEW', 'APPEND', 'UPDATE_EXISTING', 'UPSERT'],
  CLIENT_WEBSITE: ['CREATE_NEW', 'APPEND', 'UPDATE_EXISTING', 'UPSERT'],
  CLIENT_ADMIN: ['CREATE_NEW', 'APPEND', 'UPDATE_EXISTING', 'UPSERT'],
  WEBHOOK: ['CREATE_NEW', 'APPEND'],
  PDF: ['CREATE_NEW', 'GENERATE_NEW_VERSION', 'REPLACE'],
  POWERPOINT: ['CREATE_NEW', 'GENERATE_NEW_VERSION', 'REPLACE'],
};

export function operationSupported(outputType: string, operation: string): boolean {
  return (SUPPORTED_OPERATIONS[outputType] ?? []).includes(operation);
}

/** Output types that keep a versioned file in storage. */
export const FILE_OUTPUT_TYPES = ['EXCEL', 'CSV', 'PDF', 'POWERPOINT'];

export function isFileOutput(outputType: string): boolean {
  return FILE_OUTPUT_TYPES.includes(outputType);
}
