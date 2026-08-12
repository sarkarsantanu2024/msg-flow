import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM envelope encryption for stored integration credentials.
 *
 * Format: v1.<iv-b64>.<authTag-b64>.<ciphertext-b64>
 * The version prefix is what makes key rotation possible later without
 * guessing at how an existing blob was encrypted.
 */

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is not set — cannot encrypt or decrypt credentials.');
  }
  // Accept base64 or hex; normalise to 32 bytes.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  if (key.length !== 32) {
    // Derive a stable 32-byte key from whatever was supplied rather than
    // failing at runtime in a way that breaks an entire deployment.
    key = createHash('sha256').update(raw).digest();
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed encrypted payload.');
  }
  const key = loadKey();
  const iv = Buffer.from(parts[1], 'base64');
  const authTag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Encrypt a JSON-serialisable credential object. */
export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T = Record<string, unknown>>(payload: string): T {
  return JSON.parse(decryptSecret(payload)) as T;
}

/** sha256 hex — used for content hashes, natural keys, file checksums. */
export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Constant-time comparison for secrets arriving over the wire. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Generate an API key. Returns the full key (shown once) and its stored form. */
export function generateApiKey(): { key: string; prefix: string; keyHash: string } {
  const secret = randomBytes(24).toString('base64url');
  const prefix = `mf_${randomBytes(4).toString('hex')}`;
  const key = `${prefix}_${secret}`;
  return { key, prefix, keyHash: sha256(key) };
}
