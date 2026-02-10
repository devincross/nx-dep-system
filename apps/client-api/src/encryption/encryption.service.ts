import { Injectable, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';

interface EncryptionKey {
  version: string;
  key: Buffer;
}

@Injectable()
export class EncryptionService implements OnModuleInit {
  private keys: EncryptionKey[] = [];
  private currentKey!: EncryptionKey;

  // AES-256-GCM configuration
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12; // 96 bits for GCM
  private readonly authTagLength = 16; // 128 bits

  onModuleInit() {
    this.loadKeys();
  }

  /**
   * Load encryption keys from environment variable
   * Format: v1:hex_key,v2:hex_key
   */
  private loadKeys(): void {
    const keysEnv = process.env['ENCRYPTION_KEYS'];

    if (!keysEnv) {
      throw new Error(
        'ENCRYPTION_KEYS environment variable is not set. ' +
          'Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }

    const keyPairs = keysEnv.split(',');

    for (const keyPair of keyPairs) {
      const [version, hexKey] = keyPair.trim().split(':');

      if (!version || !hexKey) {
        throw new Error(
          `Invalid key format: "${keyPair}". Expected format: "v1:hex_key"`
        );
      }

      if (hexKey.length !== 64) {
        throw new Error(
          `Invalid key length for ${version}. Expected 64 hex characters (256 bits), got ${hexKey.length}`
        );
      }

      this.keys.push({
        version,
        key: Buffer.from(hexKey, 'hex'),
      });
    }

    if (this.keys.length === 0) {
      throw new Error('No valid encryption keys found');
    }

    // First key is the current key for encryption
    this.currentKey = this.keys[0];
  }

  /**
   * Encrypt data and return versioned encrypted string
   * Format: version:iv:authTag:ciphertext (all base64 encoded except version)
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(this.ivLength);

    const cipher = crypto.createCipheriv(
      this.algorithm,
      this.currentKey.key,
      iv,
      { authTagLength: this.authTagLength }
    );

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Format: version:iv:authTag:ciphertext
    return [
      this.currentKey.version,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  /**
   * Decrypt versioned encrypted string
   * Tries all keys matching the version prefix
   */
  decrypt(encryptedData: string): string {
    const parts = encryptedData.split(':');

    if (parts.length !== 4) {
      throw new Error(
        'Invalid encrypted data format. Expected: version:iv:authTag:ciphertext'
      );
    }

    const [version, ivBase64, authTagBase64, ciphertextBase64] = parts;

    // Find the key for this version
    const keyEntry = this.keys.find((k) => k.version === version);

    if (!keyEntry) {
      throw new Error(
        `No encryption key found for version "${version}". ` +
          `Available versions: ${this.keys.map((k) => k.version).join(', ')}`
      );
    }

    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const ciphertext = Buffer.from(ciphertextBase64, 'base64');

    const decipher = crypto.createDecipheriv(
      this.algorithm,
      keyEntry.key,
      iv,
      { authTagLength: this.authTagLength }
    );

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Encrypt a JSON object
   */
  encryptJson(data: Record<string, unknown>): string {
    return this.encrypt(JSON.stringify(data));
  }

  /**
   * Decrypt to a JSON object
   */
  decryptJson<T = Record<string, unknown>>(encryptedData: string): T {
    const decrypted = this.decrypt(encryptedData);
    return JSON.parse(decrypted) as T;
  }

  /**
   * Get the current encryption key version
   */
  getCurrentVersion(): string {
    return this.currentKey.version;
  }
}

