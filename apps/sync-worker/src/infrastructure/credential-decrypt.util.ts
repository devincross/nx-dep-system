import * as crypto from 'crypto';

/**
 * Decrypt-and-parse for credentials.connection_data.
 *
 * The client-api encrypts connection data with AES-256-GCM using a
 * versioned key ring from ENCRYPTION_KEYS ("v1:hex_key,v2:hex_key"),
 * stored as "version:iv:authTag:ciphertext" (base64 fields). This mirrors
 * that format for reading. Plaintext JSON is still accepted so local/dev
 * databases with unencrypted rows keep working.
 */

interface EncryptionKey {
  version: string;
  key: Buffer;
}

const ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_LENGTH = 16;

let cachedKeys: EncryptionKey[] | null = null;

function loadKeys(): EncryptionKey[] {
  if (cachedKeys) return cachedKeys;

  const keysEnv = process.env['ENCRYPTION_KEYS'];
  if (!keysEnv) {
    throw new Error(
      'connection_data is encrypted but ENCRYPTION_KEYS is not set for the sync-worker',
    );
  }

  const keys: EncryptionKey[] = [];
  for (const keyPair of keysEnv.split(',')) {
    const [version, hexKey] = keyPair.trim().split(':');
    if (!version || !hexKey || hexKey.length !== 64) {
      throw new Error(`Invalid ENCRYPTION_KEYS entry: expected "v1:<64 hex chars>"`);
    }
    keys.push({ version, key: Buffer.from(hexKey, 'hex') });
  }

  cachedKeys = keys;
  return keys;
}

function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format. Expected: version:iv:authTag:ciphertext');
  }

  const [version, ivBase64, authTagBase64, ciphertextBase64] = parts;
  const keyEntry = loadKeys().find((k) => k.version === version);
  if (!keyEntry) {
    throw new Error(`No encryption key found for version "${version}"`);
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    keyEntry.key,
    Buffer.from(ivBase64, 'base64'),
    { authTagLength: AUTH_TAG_LENGTH },
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Parse a credentials.connection_data value, decrypting when necessary.
 */
export function parseConnectionData(connectionData: string): Record<string, unknown> {
  const trimmed = connectionData.trim();

  // Plaintext JSON (dev / legacy rows)
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }

  return JSON.parse(decrypt(trimmed)) as Record<string, unknown>;
}

/** Test hook: clear the cached key ring. */
export function resetKeyCache(): void {
  cachedKeys = null;
}
