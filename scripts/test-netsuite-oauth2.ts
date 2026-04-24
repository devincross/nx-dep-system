/**
 * Standalone NetSuite OAuth 2.0 M2M debug script.
 *
 * Builds the JWT client assertion, posts to NetSuite's token endpoint,
 * and prints every piece of information needed to diagnose `invalid_grant`
 * / `invalid_client` failures.
 *
 * Usage:
 *   # Option A — load from a file:
 *   env $(grep -v '^#' .env.netsuite-oauth2 | xargs) npx tsx scripts/test-netsuite-oauth2.ts
 *
 *   # Option B — pull from the DB using the existing verify-cert script's flow
 *   (not included here — keep this script self-contained).
 *
 * Required env vars:
 *   NS_ACCOUNT        e.g. 4325477_SB1  (underscore form, will be normalized)
 *   NS_CLIENT_ID      Client ID from the Integration record (hex, ~64 chars)
 *   NS_CERTIFICATE_ID Certificate ID from the M2M Setup list (base64url)
 *   NS_PRIVATE_KEY    PEM-formatted private key (use \n for newlines if
 *                     single-lining in env), OR path via NS_PRIVATE_KEY_FILE
 *
 * Optional:
 *   NS_PRIVATE_KEY_FILE  path to a .pem file — preferred over NS_PRIVATE_KEY
 *   NS_SCOPE             space-separated scopes. Default: "restlets"
 *   NS_CERT_FILE         path to the public cert .pem — enables kid recomputation
 *                        so we can compare against NS_CERTIFICATE_ID
 *   NS_AUD_OVERRIDE      override the `aud` claim (for experimentation)
 */

import crypto from 'crypto';
import { readFileSync } from 'fs';
import * as jwt from 'jsonwebtoken';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function normalizeAccount(account: string): string {
  return account.toLowerCase().replace('_', '-');
}

function tokenUrl(account: string): string {
  return `https://${normalizeAccount(account)}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
}

function loadPrivateKey(): string {
  const file = process.env.NS_PRIVATE_KEY_FILE;
  if (file) return readFileSync(file, 'utf8');
  const raw = required('NS_PRIVATE_KEY');
  if (raw.includes('-----BEGIN')) return raw.replace(/\\n/g, '\n');
  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  if (decoded.includes('-----BEGIN')) return decoded;
  console.error('❌ NS_PRIVATE_KEY is not PEM and not base64-encoded PEM');
  process.exit(1);
}

function computeCertThumbprints(certPem: string): { sha1b64url: string; sha256b64url: string; sha1hex: string; sha256hex: string } {
  const b64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  const der = Buffer.from(b64, 'base64');
  const sha1 = crypto.createHash('sha1').update(der).digest();
  const sha256 = crypto.createHash('sha256').update(der).digest();
  const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { sha1b64url: b64url(sha1), sha256b64url: b64url(sha256), sha1hex: sha1.toString('hex'), sha256hex: sha256.toString('hex') };
}

async function main() {
  const account = required('NS_ACCOUNT');
  const clientId = required('NS_CLIENT_ID');
  const certificateId = required('NS_CERTIFICATE_ID');
  const scope = process.env.NS_SCOPE ?? 'restlets';
  const privateKey = loadPrivateKey();
  const aud = process.env.NS_AUD_OVERRIDE ?? tokenUrl(account);

  console.log('──────────── NetSuite OAuth2 Debug ────────────');
  console.log(`Account (raw):        ${account}`);
  console.log(`Account (normalized): ${normalizeAccount(account)}`);
  console.log(`Token URL:            ${tokenUrl(account)}`);
  console.log(`aud (JWT):            ${aud}`);
  console.log(`Client ID (iss):      ${clientId}`);
  console.log(`  length=${clientId.length} looks-like-hex=${/^[0-9a-f]+$/.test(clientId)}`);
  console.log(`Certificate ID (kid): ${certificateId}`);
  console.log(`  length=${certificateId.length}`);
  console.log(`Scope:                ${scope}`);
  console.log(`Private key header:   ${privateKey.split('\n')[0]}`);

  if (process.env.NS_CERT_FILE) {
    const certPem = readFileSync(process.env.NS_CERT_FILE, 'utf8');
    const tp = computeCertThumbprints(certPem);
    console.log('\n── Certificate thumbprints computed from NS_CERT_FILE ──');
    console.log(`  SHA-1   hex:       ${tp.sha1hex}`);
    console.log(`  SHA-1   b64url:    ${tp.sha1b64url}`);
    console.log(`  SHA-256 hex:       ${tp.sha256hex}`);
    console.log(`  SHA-256 b64url:    ${tp.sha256b64url}`);
    const match =
      certificateId === tp.sha1b64url ? 'SHA-1 base64url' :
      certificateId === tp.sha256b64url ? 'SHA-256 base64url' :
      certificateId === tp.sha1hex ? 'SHA-1 hex' :
      certificateId === tp.sha256hex ? 'SHA-256 hex' : null;
    if (match) console.log(`  ✅ NS_CERTIFICATE_ID matches ${match} of this cert`);
    else console.log('  ⚠️  NS_CERTIFICATE_ID does NOT match any standard thumbprint of this cert — it may be a NetSuite-assigned ID, which is fine, but verify it matches the M2M Setup list column.');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: clientId, scope, aud, iat: now, exp: now + 300 };

  let assertion: string;
  try {
    assertion = jwt.sign(payload, privateKey, {
      algorithm: 'PS256',
      header: { alg: 'PS256', typ: 'JWT', kid: certificateId },
    });
  } catch (err) {
    console.error('\n❌ Failed to sign JWT with PS256:', err);
    console.error('Trying RS256 fallback…');
    assertion = jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      header: { alg: 'RS256', typ: 'JWT', kid: certificateId },
    });
  }

  const [headerB64, payloadB64] = assertion.split('.');
  console.log('\n── JWT (decoded) ──');
  console.log('header:  ', JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')));
  console.log('payload: ', JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')));
  console.log(`assertion.length=${assertion.length}`);

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
  });

  console.log('\n── POST to token endpoint ──');
  console.log(`  ${tokenUrl(account)}`);
  const t0 = Date.now();
  const response = await fetch(tokenUrl(account), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString(),
  });
  const elapsed = Date.now() - t0;
  const text = await response.text();

  console.log(`\n── Response (${elapsed}ms) ──`);
  console.log(`  status: ${response.status} ${response.statusText}`);
  console.log(`  headers:`);
  response.headers.forEach((v, k) => console.log(`    ${k}: ${v}`));
  console.log(`  body: ${text}`);

  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }

  if (response.ok && parsed && typeof parsed === 'object') {
    console.log('\n✅ Token obtained successfully');
    const p = parsed as { access_token?: string; expires_in?: number; token_type?: string };
    console.log(`  token_type: ${p.token_type}`);
    console.log(`  expires_in: ${p.expires_in}s`);
    console.log(`  access_token (first 40): ${p.access_token?.slice(0, 40)}…`);
    return;
  }

  console.log('\n❌ Token request failed');
  if (parsed && typeof parsed === 'object') {
    const e = parsed as { error?: string; error_description?: string };
    console.log(`  error:             ${e.error}`);
    console.log(`  error_description: ${e.error_description ?? '(none)'}`);
  }

  console.log(`\n── Interpretation of "${(parsed as { error?: string })?.error}" ──`);
  const err = (parsed as { error?: string })?.error;
  if (err === 'invalid_client') {
    console.log('  JWT signature failed OR the kid / iss is not recognized by NetSuite.');
    console.log('  • Check that the kid matches the M2M Setup Certificate ID exactly.');
    console.log('  • Check that the iss matches the Integration record Client ID exactly.');
    console.log('  • Check that the private key matches the uploaded public certificate.');
  } else if (err === 'invalid_grant') {
    console.log('  JWT was parsed and identifiers are recognized, but NetSuite refuses to issue a grant.');
    console.log('  • No active M2M mapping row links this Integration + Certificate + User + Role.');
    console.log('  • Mapping exists but User or Role is inactive.');
    console.log('  • Role lacks "Log in using OAuth 2.0 Access Tokens" permission.');
    console.log('  • Requested scope is not enabled on the Integration.');
    console.log('  • Integration State is not "Enabled" OR "Client Credentials" grant is unchecked.');
  } else if (err === 'invalid_scope') {
    console.log('  The requested scope is not enabled on the Integration. Try NS_SCOPE=restlets.');
  }

  process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
