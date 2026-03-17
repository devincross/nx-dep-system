/**
 * Standalone NetSuite OAuth 1.0a test script
 *
 * Usage:
 *   npx tsx scripts/test-netsuite-oauth1.ts
 *
 * Required env vars:
 *   NS_RESTLET_HOST    - e.g. https://1234567.restlets.api.netsuite.com/app/site/hosting/restlet.nl
 *   NS_CONSUMER_KEY
 *   NS_CONSUMER_SECRET
 *   NS_TOKEN
 *   NS_TOKEN_SECRET
 *   NS_REALM           - e.g. 1234567
 *   NS_ORDER_SCRIPT    - e.g. customscript_dep_orders
 *   NS_ACCOUNT_SCRIPT  - e.g. customscript_dep_accounts
 *   NS_DEPLOY_ID       - e.g. 1
 *
 * You can put these in a .env.netsuite-test file and run:
 *   env $(cat .env.netsuite-test | xargs) npx tsx scripts/test-netsuite-oauth1.ts
 */

import crypto from 'crypto';

// ---- Inline OAuth 1.0a signing (no external dep needed) ----

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

function buildOAuth1Header(
  url: string,
  method: string,
  consumerKey: string,
  consumerSecret: string,
  token: string,
  tokenSecret: string,
  realm: string,
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();

  // Parse URL to separate base URL and query params
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.origin}${urlObj.pathname}`;

  // Collect all params (query + oauth)
  const params: [string, string][] = [];
  urlObj.searchParams.forEach((value, key) => {
    params.push([key, value]);
  });

  params.push(['oauth_consumer_key', consumerKey]);
  params.push(['oauth_nonce', nonce]);
  params.push(['oauth_signature_method', 'HMAC-SHA256']);
  params.push(['oauth_timestamp', timestamp]);
  params.push(['oauth_token', token]);
  params.push(['oauth_version', '1.0']);

  // Sort params
  params.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

  // Build parameter string
  const paramString = params
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .join('&');

  // Build signature base string
  const signatureBase = `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;

  // Sign
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(signatureBase)
    .digest('base64');

  // Build Authorization header
  const headerParts = [
    `realm="${percentEncode(realm)}"`,
    `oauth_consumer_key="${percentEncode(consumerKey)}"`,
    `oauth_nonce="${percentEncode(nonce)}"`,
    `oauth_signature="${percentEncode(signature)}"`,
    `oauth_signature_method="HMAC-SHA256"`,
    `oauth_timestamp="${timestamp}"`,
    `oauth_token="${percentEncode(token)}"`,
    `oauth_version="1.0"`,
  ];

  return `OAuth ${headerParts.join(', ')}`;
}

// ---- Config ----

const required = [
  'NS_RESTLET_HOST',
  'NS_CONSUMER_KEY',
  'NS_CONSUMER_SECRET',
  'NS_TOKEN',
  'NS_TOKEN_SECRET',
  'NS_REALM',
  'NS_ORDER_SCRIPT',
  'NS_DEPLOY_ID',
] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
}

const baseUrl = process.env.NS_RESTLET_HOST!.replace(/\/$/, '');
const deployId = process.env.NS_DEPLOY_ID!;
const realm = process.env.NS_REALM!;
const consumerKey = process.env.NS_CONSUMER_KEY!;
const consumerSecret = process.env.NS_CONSUMER_SECRET!;
const token = process.env.NS_TOKEN!;
const tokenSecret = process.env.NS_TOKEN_SECRET!;

// ---- Test runner ----

async function testScript(name: string, scriptId: string, type: string, extraParams?: Record<string, string>) {
  let url = `${baseUrl}?script=${scriptId}&deploy=${deployId}&realm=${realm}&type=${type}`;
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      url += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`URL: ${url}`);
  console.log(`Method: GET`);

  const authHeader = buildOAuth1Header(
    url, 'GET', consumerKey, consumerSecret, token, tokenSecret, realm,
  );
  console.log(`Auth header (first 80 chars): ${authHeader.slice(0, 80)}...`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
    });

    console.log(`\nHTTP Status: ${response.status} ${response.statusText}`);
    console.log(`Response headers:`);
    response.headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`);
    });

    const body = await response.text();
    console.log(`\nResponse body (first 1000 chars):`);
    console.log(body.slice(0, 1000));

    if (response.ok) {
      try {
        const data = JSON.parse(body);
        console.log(`\nParsed: type=${typeof data}, isArray=${Array.isArray(data)}`);
        if (Array.isArray(data)) {
          console.log(`Count: ${data.length}`);
          if (data.length > 0) {
            console.log(`First record:`, JSON.stringify(data[0], null, 2));
          }
        }
      } catch {
        console.log(`(not valid JSON)`);
      }
    }
  } catch (error: any) {
    console.error(`\nNetwork error:`, error.message ?? error);
  }
}

async function main() {
  console.log('NetSuite OAuth 1.0a Connection Test');
  console.log(`Host: ${baseUrl}`);
  console.log(`Realm: ${realm}`);
  console.log(`Consumer Key: ${consumerKey.slice(0, 8)}...`);
  console.log(`Token: ${token.slice(0, 8)}...`);

  // Use last_modified from 30 days ago by default, or pass NS_LAST_MODIFIED env var
  const lastModified = process.env.NS_LAST_MODIFIED
    ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  console.log(`\nlast_modified: ${lastModified}`);

  if (process.env.NS_ORDER_SCRIPT) {
    await testScript('Orders', process.env.NS_ORDER_SCRIPT!, 'orders', {
      last_modified: lastModified,
    });
  }

  if (process.env.NS_ACCOUNT_SCRIPT) {
    await testScript('Accounts', process.env.NS_ACCOUNT_SCRIPT!, 'customers', {
      last_modified: lastModified,
    });
  }
}

main().catch(console.error);
