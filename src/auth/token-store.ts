/**
 * Encrypted token persistence with atomic file writes.
 *
 * Stores OAuth token pairs encrypted with AES-256-GCM, one file per realmId.
 * Uses write-then-rename for crash safety (no partial writes on disk).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: number;       // epoch ms
  refreshExpiresAt: number; // epoch ms
}

interface EncryptedEnvelope {
  /** hex-encoded initialisation vector */
  iv: string;
  /** hex-encoded auth tag */
  tag: string;
  /** hex-encoded ciphertext */
  data: string;
  /** hex-encoded salt used to derive the key */
  salt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 16;
const SALT_BYTES = 32;
const KEY_LENGTH = 32; // 256 bits
const SCRYPT_COST = 16384;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class TokenStore {
  private readonly dir: string;
  private readonly passphrase: string;

  /**
   * @param storageDir  Directory to persist token files (created if missing).
   * @param passphrase  Secret used to derive per-file AES-256 keys via scrypt.
   */
  constructor(storageDir: string = './data/tokens', passphrase: string) {
    this.dir = storageDir;
    this.passphrase = passphrase;

    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Encrypt and persist a token pair. Atomic: write to tmp, then rename. */
  save(realmId: string, tokens: TokenPair): void {
    const plaintext = JSON.stringify(tokens);
    const envelope = this.encrypt(plaintext);
    const filePath = this.pathFor(realmId);
    const tmpPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;

    writeFileSync(tmpPath, JSON.stringify(envelope), 'utf-8');
    renameSync(tmpPath, filePath);
  }

  /** Load and decrypt a token pair. Returns null if not found. */
  load(realmId: string): TokenPair | null {
    const filePath = this.pathFor(realmId);
    if (!existsSync(filePath)) return null;

    const raw = readFileSync(filePath, 'utf-8');
    const envelope: EncryptedEnvelope = JSON.parse(raw);
    const plaintext = this.decrypt(envelope);
    return JSON.parse(plaintext) as TokenPair;
  }

  /** Delete stored tokens for a realm. */
  delete(realmId: string): void {
    const filePath = this.pathFor(realmId);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  /** List all realmIds that have stored tokens. */
  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.enc'))
      .map((f) => f.replace(/\.enc$/, ''));
  }

  // ── Crypto helpers ──────────────────────────────────────────────────────

  private deriveKey(salt: Buffer): Buffer {
    return scryptSync(this.passphrase, salt, KEY_LENGTH, { N: SCRYPT_COST }) as Buffer;
  }

  private encrypt(plaintext: string): EncryptedEnvelope {
    const salt = randomBytes(SALT_BYTES);
    const key = this.deriveKey(salt);
    const iv = randomBytes(IV_BYTES);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted.toString('hex'),
      salt: salt.toString('hex'),
    };
  }

  private decrypt(envelope: EncryptedEnvelope): string {
    const salt = Buffer.from(envelope.salt, 'hex');
    const key = this.deriveKey(salt);
    const iv = Buffer.from(envelope.iv, 'hex');
    const tag = Buffer.from(envelope.tag, 'hex');
    const ciphertext = Buffer.from(envelope.data, 'hex');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf-8');
  }

  private pathFor(realmId: string): string {
    // Sanitise realmId to prevent directory traversal
    const safe = realmId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.dir, `${safe}.enc`);
  }
}
