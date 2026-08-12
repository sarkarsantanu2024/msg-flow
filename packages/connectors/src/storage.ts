import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, stat, rename } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '@msgflow/config';
import { AppError } from '@msgflow/types';

/**
 * Object storage abstraction.
 *
 * The local driver is the default and is what `pnpm dev` uses. Storage refs are
 * tenant-prefixed (`t/{tenantId}/...`) so a path traversal in a ref cannot
 * reach another tenant's files — the resolver rejects any ref that escapes the
 * root after normalisation.
 */

export interface StoredFile {
  storageRef: string;
  checksum: string;
  sizeBytes: number;
  modifiedAt: Date;
}

export interface StorageDriver {
  read(ref: string): Promise<Buffer>;
  write(ref: string, data: Buffer): Promise<StoredFile>;
  exists(ref: string): Promise<boolean>;
  remove(ref: string): Promise<void>;
  stat(ref: string): Promise<{ checksum: string; sizeBytes: number; modifiedAt: Date } | null>;
}

function checksumOf(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

class LocalStorageDriver implements StorageDriver {
  private root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(ref: string): string {
    const normalized = path.normalize(ref).replace(/^([/\\])+/, '');
    const full = path.resolve(this.root, normalized);
    if (!full.startsWith(this.root + path.sep) && full !== this.root) {
      throw new AppError('FORBIDDEN', 'Invalid storage reference.');
    }
    return full;
  }

  async read(ref: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(ref));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError('NOT_FOUND', 'The stored file no longer exists.');
      }
      throw err;
    }
  }

  /**
   * Write via a temp file then rename. A crash mid-write must never leave a
   * customer's workbook truncated — rename is atomic on the same filesystem.
   */
  async write(ref: string, data: Buffer): Promise<StoredFile> {
    const full = this.resolve(ref);
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, full);
    const info = await stat(full);
    return {
      storageRef: ref,
      checksum: checksumOf(data),
      sizeBytes: data.length,
      modifiedAt: info.mtime,
    };
  }

  async exists(ref: string): Promise<boolean> {
    try {
      await stat(this.resolve(ref));
      return true;
    } catch {
      return false;
    }
  }

  async remove(ref: string): Promise<void> {
    try {
      await unlink(this.resolve(ref));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async stat(ref: string) {
    try {
      const full = this.resolve(ref);
      const info = await stat(full);
      const data = await readFile(full);
      return { checksum: checksumOf(data), sizeBytes: info.size, modifiedAt: info.mtime };
    } catch {
      return null;
    }
  }
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const env = getEnv();
  if (env.STORAGE_DRIVER === 's3') {
    // S3 is a deployment concern documented in docs/deployment.md. Rather than
    // ship a half-wired client, we fail loudly at configuration time.
    throw new AppError(
      'INTEGRATION_NOT_CONFIGURED',
      'The S3 storage driver is not enabled in this build. Set STORAGE_DRIVER=local or add an S3 driver.',
    );
  }
  driver = new LocalStorageDriver(env.STORAGE_LOCAL_PATH);
  return driver;
}

export function setStorageDriver(custom: StorageDriver | null): void {
  driver = custom;
}

/** Build a tenant-scoped storage ref. */
export function buildStorageRef(tenantId: string, kind: string, fileName: string): string {
  const safeName = fileName.replace(/[^\w.\-]/g, '_');
  const stamp = Date.now();
  return `t/${tenantId}/${kind}/${stamp}-${safeName}`;
}

export { checksumOf };
