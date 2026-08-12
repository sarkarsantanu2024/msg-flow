import path from 'node:path';
import QRCode from 'qrcode';
import pkg from 'whatsapp-web.js';
import { createLogger, describeError } from '@msgflow/logger';
import type {
  MessageProvider,
  NormalizedMessage,
  NormalizedMessageType,
  ProviderGroup,
  ProviderStatus,
  ProviderConnectionState,
} from '@msgflow/types';
import { config } from '../config.js';

/**
 * WhatsApp Web provider.
 *
 * THIS IS THE ONLY FILE IN THE CODEBASE THAT MAY IMPORT whatsapp-web.js.
 *
 * Everything downstream speaks NormalizedMessage / MessageProvider, so adding
 * the official WhatsApp Business Platform later means writing one more file
 * that implements the same interface — no changes anywhere else.
 *
 * whatsapp-web.js is CommonJS, hence the default-import destructuring.
 */
const { Client, LocalAuth } = pkg;
type WwebClient = InstanceType<typeof Client>;
type WwebMessage = pkg.Message;

const log = createLogger('provider:whatsapp-web');

/** whatsapp-web.js message types → our vocabulary. */
function normalizeType(type: string): NormalizedMessageType {
  switch (type) {
    case 'chat':
      return 'TEXT';
    case 'image':
      return 'IMAGE';
    case 'video':
      return 'VIDEO';
    case 'ptt':
    case 'audio':
      return 'AUDIO';
    case 'document':
      return 'DOCUMENT';
    case 'location':
      return 'LOCATION';
    case 'vcard':
    case 'multi_vcard':
      return 'CONTACT_CARD';
    case 'sticker':
      return 'STICKER';
    case 'e2e_notification':
    case 'notification_template':
    case 'gp2':
      return 'SYSTEM';
    default:
      return 'OTHER';
  }
}

export interface WhatsAppWebProviderOptions {
  tenantId: string;
  connectionId: string;
  sessionPath?: string;
}

export class WhatsAppWebProvider implements MessageProvider {
  readonly type = 'WHATSAPP_WEB' as const;
  readonly connectionId: string;
  readonly tenantId: string;

  private client: WwebClient | null = null;
  private state: ProviderConnectionState = 'DISCONNECTED';
  private qrDataUrl: string | null = null;
  private qrExpiresAt: number | null = null;
  private phoneNumber: string | null = null;
  private displayName: string | null = null;
  private connectedAt: number | null = null;
  private lastMessageAt: number | null = null;
  private lastError: string | null = null;
  private starting = false;

  private messageHandlers: Array<(message: NormalizedMessage) => void | Promise<void>> = [];
  private stateHandlers: Array<(status: ProviderStatus) => void | Promise<void>> = [];

  constructor(options: WhatsAppWebProviderOptions) {
    this.tenantId = options.tenantId;
    this.connectionId = options.connectionId;
    this.sessionPath = options.sessionPath ?? config.WORKER_SESSION_PATH;
  }

  private sessionPath: string;

  private setState(next: ProviderConnectionState, error?: string | null) {
    if (this.state === next && error === undefined) return;
    this.state = next;
    if (error !== undefined) this.lastError = error;

    log.info('Connection state changed', { connectionId: this.connectionId, state: next, error });

    const status = this.getStatus();
    for (const handler of this.stateHandlers) {
      void Promise.resolve(handler(status)).catch((err) =>
        log.error('State handler failed', describeError(err)),
      );
    }
  }

  getStatus(): ProviderStatus {
    return {
      connectionId: this.connectionId,
      state: this.state,
      phoneNumber: this.phoneNumber,
      displayName: this.displayName,
      qrCode: this.state === 'QR_REQUIRED' ? this.qrDataUrl : null,
      qrExpiresAt: this.qrExpiresAt,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError,
    };
  }

  onMessage(handler: (message: NormalizedMessage) => void | Promise<void>): void {
    this.messageHandlers.push(handler);
  }

  onStateChange(handler: (status: ProviderStatus) => void | Promise<void>): void {
    this.stateHandlers.push(handler);
  }

  async connect(): Promise<void> {
    if (this.starting) {
      log.debug('Connect already in progress', { connectionId: this.connectionId });
      return;
    }
    if (this.client && this.state === 'READY') return;

    this.starting = true;
    this.setState('CONNECTING', null);

    try {
      // LocalAuth persists the session to disk, so a worker restart reconnects
      // without a new QR scan. The path is per-connection so one tenant's
      // session can never be picked up by another's client.
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: this.connectionId,
          dataPath: path.resolve(this.sessionPath),
        }),
        puppeteer: {
          headless: config.PUPPETEER_HEADLESS,
          executablePath: config.PUPPETEER_EXECUTABLE_PATH,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
          ],
        },
      });

      client.on('qr', (qr: string) => {
        void (async () => {
          try {
            // Rendered to a data URL here so the browser never has to fetch it
            // from anywhere, and the raw string never leaves the worker.
            this.qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
            this.qrExpiresAt = Date.now() + 60_000;
            this.setState('QR_REQUIRED', null);
          } catch (err) {
            log.error('Failed to render QR code', describeError(err));
          }
        })();
      });

      client.on('authenticated', () => {
        this.qrDataUrl = null;
        this.qrExpiresAt = null;
        this.setState('AUTHENTICATED', null);
      });

      client.on('auth_failure', (message: string) => {
        this.setState('ERROR', `Authentication failed: ${message}`);
      });

      client.on('ready', () => {
        this.connectedAt = Date.now();
        this.qrDataUrl = null;
        this.qrExpiresAt = null;

        const info = client.info;
        this.phoneNumber = info?.wid?.user ? `+${info.wid.user}` : null;
        this.displayName = info?.pushname ?? null;

        this.setState('READY', null);
      });

      client.on('disconnected', (reason: string) => {
        this.connectedAt = null;
        // LOGGED_OUT is terminal — the session is gone and a new QR is needed.
        // Anything else is worth an automatic reconnection attempt.
        const loggedOut = String(reason).toUpperCase().includes('LOGOUT');
        this.setState(loggedOut ? 'LOGGED_OUT' : 'DISCONNECTED', `Disconnected: ${reason}`);

        if (!loggedOut) {
          setTimeout(() => {
            if (this.state === 'DISCONNECTED') {
              log.info('Attempting automatic reconnection', { connectionId: this.connectionId });
              this.setState('RECONNECTING', null);
              void this.connect().catch((err) =>
                log.error('Automatic reconnection failed', describeError(err)),
              );
            }
          }, 10_000);
        }
      });

      client.on('message', (message: WwebMessage) => {
        void this.handleMessage(message).catch((err) =>
          log.error('Message handling failed', describeError(err)),
        );
      });

      this.client = client;
      await client.initialize();
    } catch (err) {
      const detail = describeError(err);
      log.error('Failed to start WhatsApp client', { connectionId: this.connectionId, ...detail });
      this.setState('ERROR', detail.message);
      throw err;
    } finally {
      this.starting = false;
    }
  }

  private async handleMessage(message: WwebMessage): Promise<void> {
    // Only group traffic is of interest; direct chats are out of scope.
    const chat = await message.getChat();
    if (!chat.isGroup) return;

    const contact = await message.getContact().catch(() => null);

    const normalized: NormalizedMessage = {
      externalId: message.id._serialized,
      groupExternalId: chat.id._serialized,
      groupName: chat.name ?? 'Unnamed group',
      senderId: message.author ?? message.from,
      senderName: contact?.pushname || contact?.name || contact?.number || 'Unknown',
      senderPhone: contact?.number ? `+${contact.number}` : null,
      text: message.body ?? '',
      messageType: normalizeType(message.type),
      // whatsapp-web.js reports seconds; the rest of the system uses ms.
      timestamp: message.timestamp * 1_000,
      isFromMe: message.fromMe,
      quotedMessageId: message.hasQuotedMsg ? (message as unknown as { _data?: { quotedStanzaID?: string } })._data?.quotedStanzaID ?? null : null,
      metadata: {
        hasMedia: message.hasMedia,
        deviceType: message.deviceType,
        isForwarded: message.isForwarded,
      },
    };

    this.lastMessageAt = Date.now();

    for (const handler of this.messageHandlers) {
      await Promise.resolve(handler(normalized)).catch((err) =>
        log.error('Message handler failed', describeError(err)),
      );
    }
  }

  async listGroups(): Promise<ProviderGroup[]> {
    if (!this.client || this.state !== 'READY') {
      throw new Error('WhatsApp is not connected. Connect before discovering groups.');
    }

    const chats = await this.client.getChats();
    return chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({
        externalId: chat.id._serialized,
        name: chat.name ?? 'Unnamed group',
        description: null,
        participantCount:
          (chat as unknown as { participants?: unknown[] }).participants?.length ?? 0,
        isGroup: true,
      }));
  }

  async refreshQr(): Promise<void> {
    // whatsapp-web.js emits a fresh QR on its own cycle; the reliable way to
    // force one is to restart the client without destroying the session.
    await this.disconnect();
    this.qrDataUrl = null;
    this.qrExpiresAt = null;
    await this.connect();
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      this.setState('DISCONNECTED', null);
      return;
    }
    try {
      await this.client.destroy();
    } catch (err) {
      log.warn('Error while destroying client', describeError(err));
    } finally {
      this.client = null;
      this.connectedAt = null;
      this.setState('DISCONNECTED', null);
    }
  }

  async logout(): Promise<void> {
    if (this.client) {
      try {
        await this.client.logout();
      } catch (err) {
        log.warn('Logout failed; destroying the client instead', describeError(err));
      }
      try {
        await this.client.destroy();
      } catch {
        // already gone
      }
    }
    this.client = null;
    this.phoneNumber = null;
    this.displayName = null;
    this.connectedAt = null;
    this.qrDataUrl = null;
    this.setState('LOGGED_OUT', null);
  }
}
