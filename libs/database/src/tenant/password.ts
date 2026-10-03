import * as crypto from 'crypto';

/**
 * Hash a tenant user's password for storage/comparison. Shared so every app
 * that writes tenant users (client-api, admin-api) stays compatible with the
 * client-api login check.
 * Using SHA-256 for password hashing.
 * In production, consider using bcrypt or argon2.
 */
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}
