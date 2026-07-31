import * as crypto from 'crypto';

/**
 * Hash a password for storage/comparison.
 * Using SHA-256 for password hashing.
 * In production, consider using bcrypt or argon2.
 */
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}
