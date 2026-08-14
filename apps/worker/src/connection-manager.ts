import fs from 'node:fs';
import path from 'node:path';
import { createLogger, describeError } from '@msgflow/logger';
import type { MessageProvider, NormalizedMessage } from '@msgflow/types';
import { config } from './config.js';
import { WhatsAppWebProvider } from './providers/whatsapp-web.js';
import { reportConnectionState, sendMessages, syncGroups } from './api-client.js';

const log = createLogger('worker:connections');

/**
 * Owns the live provider instances and the outbound message buffer.
 *
 * Messages are batched before being posted: a busy group produces bursts, and
 * one HTTP request per message would be both slow and rate-limit bait. A batch
 * that fails to deliver stays in the buffer and is retried, so a temporary
 * outage in the web app does not lose captured messages.
 */

interface ManagedConnection {
  provider: MessageProvider;
  tenantId: string;
  buffer: NormalizedMessage[];
  flushTimer: NodeJS.Timeout | null;
  messagesSeen: number;
}

const FLUSH_INTERVAL_MS = 2_000;
const MAX_BATCH = 100;
/** Beyond this the buffer is trimmed oldest-first rather than growing forever. */
const MAX_BUFFER = 5_000;

export class ConnectionManager {
  private connections = new Map<string, ManagedConnection>();

  list(): Array<{ connectionId: string; tenantId: string; state: string; messagesSeen: number }> {
    return [...this.connections.entries()].map(([connectionId, managed]) => ({
      connectionId,
      tenantId: managed.tenantId,
      state: managed.provider.getStatus().state,
      messagesSeen: managed.messagesSeen,
    }));
  }

  count(): number {
    return this.connections.size;
  }

  totalMessagesSeen(): number {
    return [...this.connections.values()].reduce((sum, c) => sum + c.messagesSeen, 0);
  }

  queueDepth(): number {
    return [...this.connections.values()].reduce((sum, c) => sum + c.buffer.length, 0);
  }

  getStatus(connectionId: string) {
    return this.connections.get(connectionId)?.provider.getStatus() ?? null;
  }

  private getOrCreate(tenantId: string, connectionId: string): ManagedConnection {
    const existing = this.connections.get(connectionId);
    if (existing) return existing;

    const provider = new WhatsAppWebProvider({ tenantId, connectionId });

    const managed: ManagedConnection = {
      provider,
      tenantId,
      buffer: [],
      flushTimer: null,
      messagesSeen: 0,
    };

    provider.onStateChange(async (status) => {
      try {
        await reportConnectionState({
          tenantId,
          connectionId,
          state: status.state,
          phoneNumber: status.phoneNumber,
          displayName: status.displayName,
          qrCode: status.qrCode,
          lastError: status.lastError,
        });
      } catch (err) {
        log.error('Failed to report connection state', { connectionId, ...describeError(err) });
      }

      // Discovering groups the moment the session is ready means the user does
      // not have to hunt for a "sync" button before anything works.
      if (status.state === 'READY') {
        try {
          const groups = await provider.listGroups();
          const result = await syncGroups(tenantId, connectionId, groups);
          log.info('Groups synced on ready', { connectionId, synced: result.synced });
        } catch (err) {
          log.warn('Automatic group sync failed', { connectionId, ...describeError(err) });
        }
      }
    });

    provider.onMessage((message) => {
      managed.messagesSeen++;
      managed.buffer.push(message);

      if (managed.buffer.length > MAX_BUFFER) {
        const dropped = managed.buffer.length - MAX_BUFFER;
        managed.buffer.splice(0, dropped);
        log.error('Message buffer overflow — oldest messages dropped', { connectionId, dropped });
      }

      this.scheduleFlush(connectionId);
    });

    this.connections.set(connectionId, managed);
    return managed;
  }

  private scheduleFlush(connectionId: string): void {
    const managed = this.connections.get(connectionId);
    if (!managed || managed.flushTimer) return;

    managed.flushTimer = setTimeout(() => {
      managed.flushTimer = null;
      void this.flush(connectionId);
    }, FLUSH_INTERVAL_MS);
  }

  async flush(connectionId: string): Promise<void> {
    const managed = this.connections.get(connectionId);
    if (!managed || managed.buffer.length === 0) return;

    const batch = managed.buffer.slice(0, MAX_BATCH);

    try {
      const result = await sendMessages(managed.tenantId, connectionId, batch, 'LIVE');
      // Only drop what was actually accepted.
      managed.buffer.splice(0, batch.length);

      log.info('Flushed messages', {
        connectionId,
        sent: batch.length,
        stored: result.stored,
        duplicates: result.duplicates,
        skipped: result.skipped,
        remaining: managed.buffer.length,
      });

      if (managed.buffer.length > 0) this.scheduleFlush(connectionId);
    } catch (err) {
      log.error('Failed to deliver messages; will retry', {
        connectionId,
        buffered: managed.buffer.length,
        ...describeError(err),
      });
      // Back off before the next attempt rather than hammering a failing app.
      setTimeout(() => this.scheduleFlush(connectionId), 10_000);
    }
  }

  async connect(tenantId: string, connectionId: string): Promise<void> {
    const managed = this.getOrCreate(tenantId, connectionId);
    this.remember(tenantId, connectionId);
    await managed.provider.connect();
  }

  /**
   * Persist which connections this worker runs, so a restart resumes them.
   *
   * Without this, every process restart (deploy, crash, file-watch reload)
   * silently stopped ALL capture until someone clicked Connect in the
   * dashboard — a paired session on disk was sitting there unused while
   * messages were being missed.
   */
  private registryPath(): string {
    return path.join(config.WORKER_SESSION_PATH, 'connections.json');
  }

  private remember(tenantId: string, connectionId: string): void {
    try {
      const entries = this.readRegistry();
      entries[connectionId] = tenantId;
      fs.mkdirSync(config.WORKER_SESSION_PATH, { recursive: true });
      fs.writeFileSync(this.registryPath(), JSON.stringify(entries, null, 2));
    } catch (err) {
      log.warn('Could not persist connection registry', describeError(err));
    }
  }

  private readRegistry(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this.registryPath(), 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  /** Called once at startup: resume every previously-running connection. */
  async resumeAll(): Promise<void> {
    const entries = Object.entries(this.readRegistry());
    if (entries.length === 0) return;
    log.info('Resuming connections from registry', { count: entries.length });
    for (const [connectionId, tenantId] of entries) {
      this.connect(tenantId, connectionId).catch((err) =>
        log.error('Auto-resume failed', { connectionId, ...describeError(err) }),
      );
    }
  }

  async reconnect(tenantId: string, connectionId: string): Promise<void> {
    const managed = this.connections.get(connectionId);
    if (managed) await managed.provider.disconnect();
    await this.connect(tenantId, connectionId);
  }

  async disconnect(connectionId: string): Promise<void> {
    const managed = this.connections.get(connectionId);
    if (!managed) return;
    // Deliver whatever is buffered before tearing the session down.
    await this.flush(connectionId).catch(() => undefined);
    await managed.provider.disconnect();
  }

  async logout(connectionId: string): Promise<void> {
    const managed = this.connections.get(connectionId);
    if (!managed) return;
    await this.flush(connectionId).catch(() => undefined);
    await managed.provider.logout();
    if (managed.flushTimer) clearTimeout(managed.flushTimer);
    this.connections.delete(connectionId);
  }

  async refreshQr(tenantId: string, connectionId: string): Promise<void> {
    const managed = this.getOrCreate(tenantId, connectionId);
    await managed.provider.refreshQr();
  }

  async syncGroups(tenantId: string, connectionId: string): Promise<{ synced: number }> {
    const managed = this.connections.get(connectionId);
    if (!managed) throw new Error('That connection is not running on this worker. Connect it first.');

    const groups = await managed.provider.listGroups();
    return syncGroups(tenantId, connectionId, groups);
  }

  async shutdown(): Promise<void> {
    log.info('Shutting down connections', { count: this.connections.size });
    for (const [connectionId, managed] of this.connections) {
      if (managed.flushTimer) clearTimeout(managed.flushTimer);
      await this.flush(connectionId).catch(() => undefined);
      await managed.provider.disconnect().catch(() => undefined);
    }
    this.connections.clear();
  }
}

export const connectionManager = new ConnectionManager();
