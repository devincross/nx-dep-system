import * as crypto from 'crypto';
import { parseConnectionData, resetKeyCache } from './credential-decrypt.util';

// Mirror of the client-api EncryptionService encrypt path
function encryptLikeClientApi(plaintext: string, version: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [version, iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

describe('parseConnectionData', () => {
  const originalEnv = process.env;
  const hexKey = crypto.randomBytes(32).toString('hex');

  beforeEach(() => {
    process.env = { ...originalEnv, ENCRYPTION_KEYS: `v1:${hexKey}` };
    resetKeyCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetKeyCache();
  });

  it('parses plaintext JSON directly', () => {
    expect(parseConnectionData('{"apple_api_url":"https://dep.example"}')).toEqual({
      apple_api_url: 'https://dep.example',
    });
  });

  it('decrypts data encrypted by the client-api format', () => {
    const data = { dep_reseller_id: '1437BE70', sap_ship_to: '0000034451' };
    const encrypted = encryptLikeClientApi(JSON.stringify(data), 'v1', Buffer.from(hexKey, 'hex'));

    expect(parseConnectionData(encrypted)).toEqual(data);
  });

  it('throws a clear error when ENCRYPTION_KEYS is missing', () => {
    delete process.env['ENCRYPTION_KEYS'];
    resetKeyCache();

    expect(() => parseConnectionData('v1:abc:def:ghi')).toThrow(/ENCRYPTION_KEYS is not set/);
  });

  it('throws for an unknown key version', () => {
    const encrypted = encryptLikeClientApi('{}', 'v9', Buffer.from(hexKey, 'hex'));
    expect(() => parseConnectionData(encrypted)).toThrow(/No encryption key found for version "v9"/);
  });
});
