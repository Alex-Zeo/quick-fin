/**
 * Key Management Service abstraction with envelope encryption.
 *
 * Provides a pluggable KMS interface. The `LocalKMS` implementation uses
 * Node.js crypto (AES-256-GCM) for development; production deployments
 * should swap in AWS KMS, Azure Key Vault, or HashiCorp Vault adapters.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';
import type { Config } from '../config/schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EncryptedPayload {
  /** hex-encoded ciphertext */
  ciphertext: string;
  /** hex-encoded IV */
  iv: string;
  /** hex-encoded GCM auth tag */
  tag: string;
  /** hex-encoded encrypted data key (envelope encryption) */
  encryptedDataKey: string;
  /** Key ID used for encryption */
  keyId: string;
}

export interface KMSAdapter {
  /** Encrypt plaintext using a managed key. Returns an envelope with encrypted data key. */
  encrypt(plaintext: Buffer, keyId: string): Promise<EncryptedPayload>;
  /** Decrypt an envelope-encrypted payload. */
  decrypt(payload: EncryptedPayload): Promise<Buffer>;
  /** Rotate the master key. Returns the new key ID (may be same ID if the provider handles versioning). */
  rotateKey(keyId: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 16;
const DATA_KEY_BYTES = 32; // 256 bits

// ---------------------------------------------------------------------------
// Local KMS (development)
// ---------------------------------------------------------------------------

/**
 * Local KMS backed by a master key stored in memory (derived from config).
 *
 * Uses envelope encryption:
 * 1. Generate a random data encryption key (DEK)
 * 2. Encrypt the plaintext with the DEK (AES-256-GCM)
 * 3. Encrypt the DEK with the master key (KEK)
 * 4. Return both encrypted data and encrypted DEK
 */
export class LocalKMS implements KMSAdapter {
  private readonly masterKeys: Map<string, Buffer> = new Map();

  /**
   * @param masterKeyHex  Hex-encoded 256-bit master key, or a passphrase
   *                      that will be SHA-256 hashed to derive the key.
   * @param keyId         Logical key identifier.
   */
  constructor(masterKeyHex: string, keyId: string = 'local-master-1') {
    const key = this.deriveKey(masterKeyHex);
    this.masterKeys.set(keyId, key);
  }

  async encrypt(plaintext: Buffer, keyId: string): Promise<EncryptedPayload> {
    const masterKey = this.getMasterKey(keyId);

    // Generate a random DEK
    const dataKey = randomBytes(DATA_KEY_BYTES);

    // Encrypt plaintext with DEK
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Encrypt DEK with master key (envelope)
    const dekIv = randomBytes(IV_BYTES);
    const dekCipher = createCipheriv(ALGORITHM, masterKey, dekIv);
    const encryptedDek = Buffer.concat([dekCipher.update(dataKey), dekCipher.final()]);
    const dekTag = dekCipher.getAuthTag();

    // Pack encrypted DEK: iv + tag + ciphertext
    const encryptedDataKey = Buffer.concat([dekIv, dekTag, encryptedDek]);

    return {
      ciphertext: ciphertext.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      encryptedDataKey: encryptedDataKey.toString('hex'),
      keyId,
    };
  }

  async decrypt(payload: EncryptedPayload): Promise<Buffer> {
    const masterKey = this.getMasterKey(payload.keyId);

    // Unpack and decrypt the DEK
    const encDekBuf = Buffer.from(payload.encryptedDataKey, 'hex');
    const dekIv = encDekBuf.subarray(0, IV_BYTES);
    const dekTag = encDekBuf.subarray(IV_BYTES, IV_BYTES + 16);
    const dekCiphertext = encDekBuf.subarray(IV_BYTES + 16);

    const dekDecipher = createDecipheriv(ALGORITHM, masterKey, dekIv);
    dekDecipher.setAuthTag(dekTag);
    const dataKey = Buffer.concat([dekDecipher.update(dekCiphertext), dekDecipher.final()]);

    // Decrypt the actual data with the DEK
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');
    const ciphertext = Buffer.from(payload.ciphertext, 'hex');

    const decipher = createDecipheriv(ALGORITHM, dataKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  async rotateKey(keyId: string): Promise<string> {
    // Generate a new master key and store under a versioned ID
    const newKey = randomBytes(DATA_KEY_BYTES);
    const version = Date.now();
    const newKeyId = `${keyId}-v${version}`;
    this.masterKeys.set(newKeyId, newKey);
    return newKeyId;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private deriveKey(input: string): Buffer {
    // If input looks like a valid 64-char hex string, use it directly
    if (/^[0-9a-fA-F]{64}$/.test(input)) {
      return Buffer.from(input, 'hex');
    }
    // Otherwise, derive via SHA-256
    return createHash('sha256').update(input).digest();
  }

  private getMasterKey(keyId: string): Buffer {
    const key = this.masterKeys.get(keyId);
    if (!key) {
      throw new Error(`KMS: unknown key ID "${keyId}"`);
    }
    return key;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a KMS adapter based on configuration.
 *
 * Currently only 'local' is implemented. AWS/Azure/Vault adapters
 * would be added here as additional cases.
 */
export function createKMS(config: Config): KMSAdapter {
  const provider = config.security.kmsProvider;
  const keyId = config.security.kmsKeyId ?? 'local-master-1';

  switch (provider) {
    case 'local': {
      const masterKey = config.security.tokenEncryptionKey
        ?? randomBytes(32).toString('hex');
      return new LocalKMS(masterKey, keyId);
    }

    case 'aws':
    case 'azure':
    case 'vault':
      throw new Error(
        `KMS provider "${provider}" is not yet implemented. Use "local" for development.`,
      );

    default:
      throw new Error(`Unknown KMS provider: ${provider as string}`);
  }
}
