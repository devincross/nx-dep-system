#!/usr/bin/env node
/**
 * Export a tenant's NetSuite credential from the DB to local files.
 *
 * Writes:
 *   ./netsuite_private.pem
 *   ./netsuite_public.pem   (if certificate_pem is stored)
 *   ./.env.netsuite-oauth2  (ready to source for test-netsuite-oauth2.ts)
 *
 * Usage:
 *   env $(grep -v '^#' .env.production | xargs) \
 *     node scripts/export-netsuite-credential.mjs byu
 *
 *   # or against local:
 *   env $(grep -v '^#' .env | xargs) \
 *     node scripts/export-netsuite-credential.mjs byu
 *
 * Required env:
 *   ENCRYPTION_KEYS      (same format as the app uses)
 *   LANDLORD_DB_HOST / PORT / USER / PASSWORD / NAME
 *
 * Arg:
 *   tenant slug substring (matched with LIKE %slug%)
 *
 * SECURITY: This writes plaintext private keys to disk. Run only on a
 * trusted workstation, and delete the files (or the whole folder) when done.
 */
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { writeFileSync, chmodSync } from 'fs';

function decrypt(encryptedData, encryptionKey) {
  const parts = encryptedData.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted data format');
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node scripts/export-netsuite-credential.mjs <tenant-slug>');
    process.exit(1);
  }

  const keysEnv = process.env.ENCRYPTION_KEYS;
  if (!keysEnv) { console.error('ENCRYPTION_KEYS not set'); process.exit(1); }
  const [, hexKey] = keysEnv.split(',')[0].trim().split(':');
  const encryptionKey = Buffer.from(hexKey, 'hex');
  if (encryptionKey.length !== 32) {
    console.error(`Decoded encryption key is ${encryptionKey.length} bytes, expected 32`);
    process.exit(1);
  }

  const landlord = await mysql.createConnection({
    host: process.env.LANDLORD_DB_HOST || 'localhost',
    port: parseInt(process.env.LANDLORD_DB_PORT || '3307'),
    user: process.env.LANDLORD_DB_USER || 'dep_user',
    password: process.env.LANDLORD_DB_PASSWORD || '',
    database: process.env.LANDLORD_DB_NAME || 'landlord_db',
  });

  const [domains] = await landlord.query(
    `SELECT d.* FROM domains d JOIN tenants t ON t.id = d.tenant_id
     WHERE t.slug LIKE ? AND d.is_primary = 1 LIMIT 1`,
    [`%${slug}%`]
  );
  if (domains.length === 0) { console.error(`No tenant matching slug "%${slug}%"`); process.exit(1); }
  const domain = domains[0];
  console.log(`Tenant: ${domain.domain} (db: ${domain.db_name} on ${domain.db_host}:${domain.db_port})`);
  await landlord.end();

  const tenant = await mysql.createConnection({
    host: domain.db_host, port: domain.db_port,
    user: domain.db_user, password: domain.db_password,
    database: domain.db_name,
  });

  const [rows] = await tenant.query(
    `SELECT * FROM credentials
     WHERE type = 'netsuite' AND status = 'current' AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  );
  await tenant.end();
  if (rows.length === 0) { console.error('No active NetSuite credential'); process.exit(1); }

  const data = JSON.parse(decrypt(rows[0].connection_data, encryptionKey));

  console.log('\nCredential summary:');
  console.log(`  auth_type:        ${data.auth_type}`);
  console.log(`  netsuite_account: ${data.netsuite_account}`);
  console.log(`  client_id:        ${data.client_id}`);
  console.log(`  certificate_id:   ${data.certificate_id}`);
  console.log(`  has private_key:  ${!!data.private_key}`);
  console.log(`  has cert_pem:     ${!!data.certificate_pem}`);

  if (!data.private_key) { console.error('No private_key stored'); process.exit(1); }

  writeFileSync('netsuite_private.pem', data.private_key);
  chmodSync('netsuite_private.pem', 0o600);
  console.log('\nWrote ./netsuite_private.pem (mode 0600)');

  if (data.certificate_pem) {
    writeFileSync('netsuite_public.pem', data.certificate_pem);
    chmodSync('netsuite_public.pem', 0o644);
    console.log('Wrote ./netsuite_public.pem');
  }

  const envLines = [
    `NS_ACCOUNT=${data.netsuite_account}`,
    `NS_CLIENT_ID=${data.client_id ?? ''}`,
    `NS_CERTIFICATE_ID=${data.certificate_id ?? ''}`,
    `NS_PRIVATE_KEY_FILE=./netsuite_private.pem`,
    data.certificate_pem ? `NS_CERT_FILE=./netsuite_public.pem` : `# NS_CERT_FILE=./netsuite_public.pem  (not stored)`,
    `# NS_SCOPE=restlets`,
  ];
  writeFileSync('.env.netsuite-oauth2', envLines.join('\n') + '\n');
  chmodSync('.env.netsuite-oauth2', 0o600);
  console.log('Wrote ./.env.netsuite-oauth2 (mode 0600)');

  console.log('\nNext:');
  console.log('  env $(grep -v "^#" .env.netsuite-oauth2 | xargs) npx tsx scripts/test-netsuite-oauth2.ts');
  console.log('\nDelete the exported files when done:');
  console.log('  rm -f netsuite_private.pem netsuite_public.pem .env.netsuite-oauth2');
}

main().catch((e) => { console.error(e); process.exit(1); });
