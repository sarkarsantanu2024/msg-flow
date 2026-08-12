/** Shared output/sync contracts used by connectors and the workflow engine. */

export type OutputOperationName =
  | 'CREATE_NEW'
  | 'APPEND'
  | 'UPDATE_EXISTING'
  | 'UPSERT'
  | 'REPLACE'
  | 'GENERATE_NEW_VERSION';

export type UpdateStrategyName = 'ALWAYS_UPDATE' | 'UPDATE_IF_EMPTY' | 'NEVER_UPDATE' | 'UPDATE_IF_NEWER';

export interface MappingSpec {
  sourceField: string;
  targetField: string;
  targetColumn?: string | null;
  updateStrategy: UpdateStrategyName;
  transform: Record<string, unknown>;
  defaultValue?: string | null;
  isKeyPart: boolean;
  keyOrder?: number | null;
}

/** A record as handed to a connector: already mapped to target field names. */
export interface SyncRow {
  recordId: string;
  /** Composite unique key value, e.g. "ABC Traders|Product X". */
  keyValue: string;
  /** targetField → value */
  values: Record<string, unknown>;
  /** Row/resource id from a previous sync, when we already own one. */
  externalRowId: string | null;
  /** ExtractedRecord.version — written back on success for no-op filtering. */
  version: number;
  /** Drives UPDATE_IF_NEWER. */
  updatedAt: Date;
}

export interface SyncRowOutcome {
  recordId: string;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  externalRowId?: string | null;
  externalRecordId?: string | null;
  reason?: string;
  error?: string;
}

export interface SyncContext {
  tenantId: string;
  outputId: string;
  operation: OutputOperationName;
  mappings: MappingSpec[];
  /** Non-secret target configuration (file ref, worksheet, URL, …). */
  config: Record<string, unknown>;
  /** Decrypted credential payload, when the target needs one. */
  credentials?: Record<string, unknown>;
  /** Checksum recorded at the previous successful sync, for conflict detection. */
  lastKnownChecksum?: string | null;
  dryRun?: boolean;
}

export interface SyncOutcome {
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'CONFLICT';
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: SyncRowOutcome[];
  /** New checksum after the write, stored for the next conflict check. */
  checksum?: string;
  /** Storage pointer for the produced artefact (file outputs). */
  storageRef?: string;
  recordCount?: number;
  sizeBytes?: number;
  error?: string;
  conflict?: {
    expectedChecksum: string | null;
    actualChecksum: string | null;
    detail: Record<string, unknown>;
  };
  /** Human-readable notes surfaced in the run summary. */
  warnings: string[];
}

export interface ColumnPreview {
  index: number;
  /** Excel column letter (A, B, …) where applicable. */
  letter: string;
  header: string;
  sampleValues: string[];
  inferredType: 'string' | 'number' | 'date' | 'boolean' | 'empty';
}

export interface WorksheetPreview {
  name: string;
  rowCount: number;
  columnCount: number;
  columns: ColumnPreview[];
  /** Features present that a write cannot fully guarantee (spec §126). */
  warnings: string[];
}

export interface WorkbookPreview {
  fileName: string;
  worksheets: WorksheetPreview[];
  checksum: string;
  sizeBytes: number;
}

/** The interface every output connector implements. */
export interface OutputConnector {
  readonly type: string;
  /** False when required credentials are absent — UI shows a "connect" prompt. */
  isConfigured(context: SyncContext): boolean;
  sync(rows: SyncRow[], context: SyncContext): Promise<SyncOutcome>;
  /** Read the target's current fingerprint, for conflict detection. */
  fingerprint?(context: SyncContext): Promise<{ checksum: string | null; modifiedAt: Date | null }>;
}
