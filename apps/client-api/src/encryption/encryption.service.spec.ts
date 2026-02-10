import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    process.env['ENCRYPTION_KEYS'] =
      'v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    service = new EncryptionService();
    service.onModuleInit();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('onModuleInit', () => {
    it('should throw error when ENCRYPTION_KEYS is not set', () => {
      delete process.env['ENCRYPTION_KEYS'];
      const newService = new EncryptionService();

      expect(() => newService.onModuleInit()).toThrow(
        'ENCRYPTION_KEYS environment variable is not set'
      );
    });

    it('should throw error for invalid key format', () => {
      process.env['ENCRYPTION_KEYS'] = 'invalid-format';
      const newService = new EncryptionService();

      expect(() => newService.onModuleInit()).toThrow('Invalid key format');
    });

    it('should throw error for invalid key length', () => {
      process.env['ENCRYPTION_KEYS'] = 'v1:tooshort';
      const newService = new EncryptionService();

      expect(() => newService.onModuleInit()).toThrow('Invalid key length');
    });
  });

  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt a string', () => {
      const plaintext = 'Hello, World!';

      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const plaintext = 'Hello, World!';

      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should include version prefix in encrypted data', () => {
      const plaintext = 'Hello, World!';

      const encrypted = service.encrypt(plaintext);

      expect(encrypted.startsWith('v1:')).toBe(true);
    });

    it('should throw error for invalid encrypted data format', () => {
      expect(() => service.decrypt('invalid')).toThrow(
        'Invalid encrypted data format'
      );
    });

    it('should throw error for unknown version', () => {
      expect(() =>
        service.decrypt('v99:aWludmFsaWQ=:aWludmFsaWQ=:aWludmFsaWQ=')
      ).toThrow('No encryption key found for version "v99"');
    });
  });

  describe('encryptJson/decryptJson', () => {
    it('should encrypt and decrypt JSON objects', () => {
      const data = { key: 'value', nested: { foo: 'bar' } };

      const encrypted = service.encryptJson(data);
      const decrypted = service.decryptJson(encrypted);

      expect(decrypted).toEqual(data);
    });

    it('should handle complex JSON structures', () => {
      const data = {
        string: 'hello',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        null: null,
      };

      const encrypted = service.encryptJson(data);
      const decrypted = service.decryptJson(encrypted);

      expect(decrypted).toEqual(data);
    });
  });

  describe('getCurrentVersion', () => {
    it('should return the current key version', () => {
      expect(service.getCurrentVersion()).toBe('v1');
    });
  });

  describe('multiple keys', () => {
    it('should decrypt data encrypted with older key version', () => {
      // Set up with two keys
      process.env['ENCRYPTION_KEYS'] =
        'v2:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210,' +
        'v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const newService = new EncryptionService();
      newService.onModuleInit();

      // Encrypt with v1 key (using original service)
      const encrypted = service.encrypt('test data');
      expect(encrypted.startsWith('v1:')).toBe(true);

      // Decrypt with new service that has both keys
      const decrypted = newService.decrypt(encrypted);
      expect(decrypted).toBe('test data');

      // New encryptions should use v2
      const newEncrypted = newService.encrypt('new data');
      expect(newEncrypted.startsWith('v2:')).toBe(true);
    });
  });
});

