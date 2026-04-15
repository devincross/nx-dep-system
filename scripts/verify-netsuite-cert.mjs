#!/usr/bin/env node
/**
 * Verify that the NetSuite private key matches the certificate.
 *
 * Usage:
 *   node scripts/verify-netsuite-cert.mjs
 *
 * Requires env vars: LANDLORD_DB_HOST, LANDLORD_DB_PORT, LANDLORD_DB_USER,
 *   LANDLORD_DB_PASSWORD, LANDLORD_DB_NAME, ENCRYPTION_KEYS
 *
 * Or: source .env && node scripts/verify-netsuite-cert.mjs
 */
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// --- Encryption (mirrors EncryptionService) ---
function decrypt(encryptedData, encryptionKey) {
  const parts = encryptedData.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted data format');
  const [, ivBase64, authTagBase64, ciphertextBase64] = parts;
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const ciphertext = Buffer.from(ciphertextBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

// --- Main ---
async function main() {
  const keysEnv = process.env.ENCRYPTION_KEYS;
  if (!keysEnv) { console.error('ENCRYPTION_KEYS not set'); process.exit(1); }
  const [, hexKey] = keysEnv.split(',')[0].trim().split(':');
  const encryptionKey = Buffer.from(hexKey, 'hex');

  // Connect to landlord DB
  const landlordConn = await mysql.createConnection({
    host: process.env.LANDLORD_DB_HOST || 'localhost',
    port: parseInt(process.env.LANDLORD_DB_PORT || '3307'),
    user: process.env.LANDLORD_DB_USER || 'dep_user',
    password: process.env.LANDLORD_DB_PASSWORD || '',
    database: process.env.LANDLORD_DB_NAME || 'landlord_db',
  });

  // Find BYU tenant domain
  const [domains] = await landlordConn.query(
    `SELECT d.* FROM domains d JOIN tenants t ON t.id = d.tenant_id WHERE t.slug LIKE '%byu%' AND d.is_primary = 1 LIMIT 1`
  );
  if (domains.length === 0) { console.error('No BYU tenant found'); process.exit(1); }
  const domain = domains[0];
  console.log(`Found tenant domain: ${domain.domain} -> ${domain.db_name}`);
  await landlordConn.end();

  // Connect to tenant DB
  const tenantConn = await mysql.createConnection({
    host: domain.db_host,
    port: domain.db_port,
    user: domain.db_user,
    password: domain.db_password,
    database: domain.db_name,
  });

  // Get active netsuite credential
  const [creds] = await tenantConn.query(
    `SELECT * FROM credentials WHERE type = 'netsuite' AND status = 'current' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`
  );
  if (creds.length === 0) { console.error('No active NetSuite credential found'); process.exit(1); }
  await tenantConn.end();

  // Decrypt
  const connectionData = JSON.parse(decrypt(creds[0].connection_data, encryptionKey));

  console.log('\n--- Credential Info ---');
  console.log(`Auth type: ${connectionData.auth_type}`);
  console.log(`Client ID: ${connectionData.client_id}`);
  console.log(`Certificate ID: ${connectionData.certificate_id}`);
  console.log(`Has private_key: ${!!connectionData.private_key}`);
  console.log(`Has certificate_pem: ${!!connectionData.certificate_pem}`);

  if (!connectionData.private_key) { console.error('\nNo private_key in credentials!'); process.exit(1); }
  if (!connectionData.certificate_pem) { console.error('\nNo certificate_pem in credentials!'); process.exit(1); }

  // Write to temp files
  const keyFile = join(tmpdir(), 'ns_privkey.pem');
  const certFile = join(tmpdir(), 'ns_cert.pem');
  writeFileSync(keyFile, connectionData.private_key);
  writeFileSync(certFile, connectionData.certificate_pem);

  console.log('\n--- Key Verification ---');
  try {
    const keyModulus = execSync(`openssl pkey -in ${keyFile} -pubout -outform DER 2>/dev/null | openssl md5`, { encoding: 'utf8' }).trim();
    const certModulus = execSync(`openssl x509 -in ${certFile} -pubkey -noout -outform DER 2>/dev/null | openssl md5`, { encoding: 'utf8' }).trim();

    console.log(`Private key hash:  ${keyModulus}`);
    console.log(`Certificate hash:  ${certModulus}`);

    if (keyModulus === certModulus) {
      console.log('\n✅ MATCH — private key and certificate are a valid pair');
    } else {
      console.log('\n❌ MISMATCH — private key does NOT match the certificate!');
      console.log('The certificate uploaded to NetSuite was generated with a different key.');
    }
  } catch (err) {
    console.error('OpenSSL error:', err.message);
    console.log('\nDumping key/cert for manual inspection:');
    console.log(`Private key file: ${keyFile}`);
    console.log(`Certificate file: ${certFile}`);
  }

  // Cleanup
  try { unlinkSync(keyFile); } catch {}
  try { unlinkSync(certFile); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
