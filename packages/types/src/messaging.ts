/**
 * The provider-independent message contract.
 *
 * Everything downstream of ingestion speaks this shape. whatsapp-web.js is
 * confined to one file (apps/worker/src/providers/whatsapp-web.ts) which
 * produces NormalizedMessage; the official Cloud API provider will produce the
 * same shape, and nothing else in the codebase needs to change.
 */

export type NormalizedMessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'DOCUMENT'
  | 'LOCATION'
  | 'CONTACT_CARD'
  | 'STICKER'
  | 'SYSTEM'
  | 'OTHER';

export interface NormalizedMessage {
  /** Provider-side message id. Must be stable for the same message. */
  externalId: string;
  /** Provider-side chat id, e.g. "120363...@g.us". */
  groupExternalId: string;
  groupName: string;
  senderId: string;
  senderName: string;
  senderPhone: string | null;
  text: string;
  messageType: NormalizedMessageType;
  /** Author's own timestamp (ms since epoch). The ordering authority. */
  timestamp: number;
  isFromMe: boolean;
  quotedMessageId: string | null;
  metadata: Record<string, unknown>;
}

export type ProviderConnectionState =
  | 'DISCONNECTED'
  | 'QR_REQUIRED'
  | 'CONNECTING'
  | 'AUTHENTICATED'
  | 'READY'
  | 'RECONNECTING'
  | 'ERROR'
  | 'LOGGED_OUT';

export interface ProviderGroup {
  externalId: string;
  name: string;
  description: string | null;
  participantCount: number;
  isGroup: boolean;
}

export interface ProviderStatus {
  connectionId: string;
  state: ProviderConnectionState;
  phoneNumber: string | null;
  displayName: string | null;
  /** Data-URL PNG, present only while state is QR_REQUIRED. */
  qrCode: string | null;
  qrExpiresAt: number | null;
  connectedAt: number | null;
  lastMessageAt: number | null;
  lastError: string | null;
}

/**
 * The interface every message source implements.
 *
 * Nothing outside a provider implementation may import whatsapp-web.js.
 */
export interface MessageProvider {
  readonly type: 'WHATSAPP_WEB' | 'WHATSAPP_CLOUD' | 'DEMO';
  readonly connectionId: string;

  /** Boot the session. Emits QR_REQUIRED if authentication is needed. */
  connect(): Promise<void>;
  /** Tear down the client but keep the stored session for a later reconnect. */
  disconnect(): Promise<void>;
  /** Destroy the stored session — the user must scan a new QR to return. */
  logout(): Promise<void>;
  /** Force a fresh QR (used when the current one expired). */
  refreshQr(): Promise<void>;

  getStatus(): ProviderStatus;
  listGroups(): Promise<ProviderGroup[]>;

  onMessage(handler: (message: NormalizedMessage) => void | Promise<void>): void;
  onStateChange(handler: (status: ProviderStatus) => void | Promise<void>): void;
}

/** Payload the worker POSTs to the web app's ingest endpoint. */
export interface IngestPayload {
  tenantId: string;
  connectionId: string;
  messages: NormalizedMessage[];
  source: 'LIVE' | 'BACKLOG';
}

export interface IngestResult {
  received: number;
  stored: number;
  duplicates: number;
  skipped: number;
  errors: string[];
}
