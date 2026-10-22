import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { IEncryptionProvider } from './interface.js';
import { LocktekError, ErrorCode } from '../types/common.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const ALGORITHM = 'aes-256-gcm';
/** 96 bits is the GCM standard: it is used directly as the nonce with no extra hashing pass. */
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const MIN_KEY_CHARS = 16;

/** Ciphertext layout marker, so the format can change without ambiguity. */
const FORMAT_VERSION = 0x01;
/** Legacy layout: [16b IV][16b tag][ct], no version byte and no key version. */
const LEGACY_IV_LENGTH = 16;

const DEFAULT_SALT = 'locktek-plug-salt';

/** One key in the rotation set. `version` identifies it inside a ciphertext. */
export interface EncryptionKeyMaterial {
  readonly key: string;
  /** 0-255. Stamped into every ciphertext this key produces. */
  readonly version: number;
  /**
   * Per-key scrypt salt; omit for the shared default. A salt is not secret, so it
   * does not limit what a leaked key exposes — only a distinct key per tenant does.
   */
  readonly salt?: string;
}

export interface AesGcmOptions {
  /** Keys accepted for decryption, in addition to the primary. Enables rotation. */
  readonly previousKeys?: readonly EncryptionKeyMaterial[];
  /** scrypt salt for the primary key. Defaults to a package-wide constant (not secret). */
  readonly salt?: string;
  /** Version stamped into new ciphertexts. Defaults to 1. */
  readonly version?: number;
}

/**
 * AES-256-GCM provider with a 96-bit random IV and versioned ciphertexts.
 *
 * Ciphertext layout: `base64([1b format][1b keyVersion][12b IV][16b tag][ciphertext])`.
 * The key version makes rotation possible: introduce a new primary key, keep the old
 * one in `previousKeys`, and existing wallets stay decryptable while new writes use
 * the new key.
 *
 * Key derivation is asynchronous and memoised, so constructing a provider does not
 * block the event loop on scrypt.
 *
 * @security A single key protects every wallet encrypted with it, and the salt is not
 * secret, so changing it does not contain a leaked key. For multi-tenant deployments,
 * use a distinct key per tenant or a custom {@link IEncryptionProvider} backed by a KMS.
 */
export class AesGcmEncryptionProvider implements IEncryptionProvider {
  private readonly primary: Required<Omit<EncryptionKeyMaterial, 'salt'>> & { salt: string };
  private readonly keyring: Map<number, { key: string; salt: string }>;
  private readonly derived = new Map<number, Promise<Buffer>>();

  constructor(encryptionKey: string, options: AesGcmOptions = {}) {
    assertKeyStrength(encryptionKey);

    this.primary = {
      key: encryptionKey,
      version: options.version ?? 1,
      salt: options.salt ?? DEFAULT_SALT,
    };

    this.keyring = new Map([
      [this.primary.version, { key: this.primary.key, salt: this.primary.salt }],
    ]);

    for (const previous of options.previousKeys ?? []) {
      assertKeyStrength(previous.key);
      if (this.keyring.has(previous.version)) {
        throw new LocktekError(
          `Duplicate encryption key version ${previous.version}. Each key needs a distinct version.`,
          ErrorCode.INVALID_CONFIG,
        );
      }
      this.keyring.set(previous.version, {
        key: previous.key,
        salt: previous.salt ?? DEFAULT_SALT,
      });
    }
  }

  /** The version stamped into ciphertexts written by this provider. */
  get keyVersion(): number {
    return this.primary.version;
  }

  async encrypt(plaintext: string): Promise<string> {
    if (!plaintext) {
      throw new LocktekError('Cannot encrypt empty string', ErrorCode.ENCRYPTION_ERROR);
    }

    try {
      const key = await this.keyFor(this.primary.version);
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return Buffer.concat([
        Buffer.from([FORMAT_VERSION, this.primary.version]),
        iv,
        authTag,
        encrypted,
      ]).toString('base64');
    } catch (error) {
      if (error instanceof LocktekError) throw error;
      throw new LocktekError(
        'Encryption failed. Ensure the encryption key is valid and at least 16 characters.',
        ErrorCode.ENCRYPTION_ERROR,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  async decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext) {
      throw new LocktekError('Cannot decrypt empty string', ErrorCode.ENCRYPTION_ERROR);
    }

    const combined = Buffer.from(ciphertext, 'base64');

    if (combined[0] === FORMAT_VERSION) {
      try {
        return await this.decryptVersioned(combined);
      } catch (error) {
        if (error instanceof LocktekError && error.code === ErrorCode.ENCRYPTION_KEY_REQUIRED) {
          throw error;
        }
        // Fall through: a legacy ciphertext can begin with 0x01 by chance.
      }
    }

    return this.decryptLegacy(combined);
  }

  /** True when this ciphertext was written by a key other than the current primary. */
  needsRotation(ciphertext: string): boolean {
    const combined = Buffer.from(ciphertext, 'base64');
    if (combined[0] !== FORMAT_VERSION) return true;
    return combined[1] !== this.primary.version;
  }

  /**
   * Re-encrypt a ciphertext under the current primary key.
   *
   * Idempotent: a ciphertext already at the primary version is returned unchanged, so
   * an interrupted rotation can simply be re-run.
   */
  async rotate(ciphertext: string): Promise<string> {
    if (!this.needsRotation(ciphertext)) return ciphertext;
    return this.encrypt(await this.decrypt(ciphertext));
  }

  private async decryptVersioned(combined: Buffer): Promise<string> {
    const minLength = 2 + IV_LENGTH + AUTH_TAG_LENGTH + 1;
    if (combined.length < minLength) throw new Error('Invalid ciphertext: too short');

    const keyVersion = combined[1];
    const entry = this.keyring.get(keyVersion);

    if (!entry) {
      throw new LocktekError(
        `Ciphertext was encrypted with key version ${keyVersion}, which is not configured. ` +
          'Supply it via the previousKeys option to decrypt data written before a rotation.',
        ErrorCode.ENCRYPTION_KEY_REQUIRED,
      );
    }

    const key = await this.keyFor(keyVersion);
    const iv = combined.subarray(2, 2 + IV_LENGTH);
    const authTag = combined.subarray(2 + IV_LENGTH, 2 + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(2 + IV_LENGTH + AUTH_TAG_LENGTH);

    return this.open(key, iv, authTag, encrypted);
  }

  /** Read the pre-versioning layout so data written by an earlier build still opens. */
  private async decryptLegacy(combined: Buffer): Promise<string> {
    const minLength = LEGACY_IV_LENGTH + AUTH_TAG_LENGTH + 1;
    if (combined.length < minLength) {
      throw new LocktekError(
        'Decryption failed — wrong key or corrupted data',
        ErrorCode.ENCRYPTION_ERROR,
      );
    }

    const key = await this.keyFor(this.primary.version);
    const iv = combined.subarray(0, LEGACY_IV_LENGTH);
    const authTag = combined.subarray(LEGACY_IV_LENGTH, LEGACY_IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(LEGACY_IV_LENGTH + AUTH_TAG_LENGTH);

    return this.open(key, iv, authTag, encrypted);
  }

  private open(key: Buffer, iv: Buffer, authTag: Buffer, encrypted: Buffer): string {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch (error) {
      throw new LocktekError(
        'Decryption failed — wrong key or corrupted data',
        ErrorCode.ENCRYPTION_ERROR,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  private keyFor(version: number): Promise<Buffer> {
    const cached = this.derived.get(version);
    if (cached) return cached;

    const entry = this.keyring.get(version);
    if (!entry) {
      return Promise.reject(
        new LocktekError(
          `No encryption key configured for version ${version}.`,
          ErrorCode.ENCRYPTION_KEY_REQUIRED,
        ),
      );
    }

    const promise = scryptAsync(entry.key, entry.salt, KEY_LENGTH);
    this.derived.set(version, promise);
    return promise;
  }
}

function assertKeyStrength(encryptionKey: string): void {
  if (!encryptionKey || encryptionKey.length < MIN_KEY_CHARS) {
    throw new LocktekError(
      `Encryption key must be at least ${MIN_KEY_CHARS} characters`,
      ErrorCode.ENCRYPTION_ERROR,
    );
  }
}

/** Constant-time comparison helper for callers verifying their own key material. */
export function secureEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
