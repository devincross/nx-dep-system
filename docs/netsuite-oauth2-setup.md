# NetSuite OAuth 2.0 M2M Setup Guide

This guide covers setting up OAuth 2.0 Machine-to-Machine (M2M) authentication for NetSuite RESTlet integration.

## NetSuite Configuration

### Step 1: Enable OAuth 2.0

1. Go to **Setup → Company → Enable Features**
2. Click the **SuiteCloud** tab
3. Check **OAuth 2.0** under "Manage Authentication"
4. Click **Save**

### Step 2: Create Integration Record

1. Go to **Setup → Integration → Manage Integrations → New**
2. Fill in the fields:
   - **Name**: `DEP Platform` (or your preferred name)
   - **State**: Enabled
   - **Uncheck**: "TBA: Authorization Flow"
   - **Uncheck**: "Authorization Code Grant"
   - **Check**: ✅ "Client Credentials (Machine to Machine) Grant"
3. Click **Save**
4. **Important**: Copy the `Client ID` shown after saving (only displayed once!)

### Step 3: Generate Certificate

Run these commands on your local machine to generate a key pair:

```bash
# Generate 4096-bit RSA private key
openssl genrsa -out netsuite_private.pem 4096

# Generate public certificate (valid for 2 years)
openssl req -new -x509 -key netsuite_private.pem -out netsuite_public.pem -days 730 \
  -subj "/CN=DEP Platform/O=Your Company Name"

# View the public certificate (you'll paste this in NetSuite)
cat netsuite_public.pem
```

**Keep `netsuite_private.pem` secure!** You'll need its contents for the API credentials.

### Step 4: Create M2M Client Mapping

1. Go to **Setup → Integration → OAuth 2.0 Client Credentials (M2M) Setup**
2. Click **Create New**
3. Fill in the fields:
   - **Entity**: Select the user/employee the integration will run as
   - **Role**: Select a role with RESTlet access permissions
   - **Integration**: Select the integration created in Step 2
   - **Certificate**: Paste the entire contents of `netsuite_public.pem` (including BEGIN/END lines)
4. Click **Save**
5. **Copy the `Certificate ID`** from the list view

### Step 5: Note Your Account ID

Find your NetSuite Account ID:
- Go to **Setup → Company → Company Information**
- Or check your NetSuite URL: `https://XXXXXX.app.netsuite.com` (XXXXXX is your account ID)
- For sandbox accounts, it's formatted like: `XXXXXX_SB1`

---

## API Credential Payloads

### Create NetSuite Credential (OAuth 2.0 M2M)

**Endpoint**: `POST /api/credentials`

```json
{
  "type": "netsuite",
  "status": "current",
  "connectionData": {
    "auth_type": "oauth2",
    "netsuite_restlet_host": "https://ACCOUNT_ID.restlets.api.netsuite.com/app/site/hosting/restlet.nl",
    "netsuite_account": "ACCOUNT_ID",
    "client_id": "your-client-id-from-step-2",
    "certificate_id": "your-certificate-id-from-step-4",
    "private_key": "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
    "certificate_pem": "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJ...\n-----END CERTIFICATE-----",
    "netsuite_deploy_id": 1,
    "netsuite_order_script_id": "customscript_your_order_script",
    "netsuite_account_script_id": "customscript_your_account_script",
    "mapping_class": "App\\Repositories\\Tenant\\Netsuite\\Mappings\\YourMapping"
  }
}
```

> **Note**: Including `certificate_pem` (the public certificate) allows the system to automatically track the certificate expiration date and display warnings in the dashboard.
```

### Update NetSuite Credential

**Endpoint**: `PUT /api/credentials/:id`

```json
{
  "status": "current",
  "connectionData": {
    "auth_type": "oauth2",
    "netsuite_restlet_host": "https://ACCOUNT_ID.restlets.api.netsuite.com/app/site/hosting/restlet.nl",
    "netsuite_account": "ACCOUNT_ID",
    "client_id": "your-client-id",
    "certificate_id": "your-certificate-id",
    "private_key": "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
    "certificate_pem": "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJ...\n-----END CERTIFICATE-----",
    "netsuite_deploy_id": 1,
    "netsuite_order_script_id": "customscript_your_order_script",
    "netsuite_account_script_id": "customscript_your_account_script",
    "mapping_class": "App\\Repositories\\Tenant\\Netsuite\\Mappings\\YourMapping"
  }
}
```

### Create NetSuite Credential (OAuth 1.0a TBA - Legacy)

For backwards compatibility with Token-Based Authentication:

```json
{
  "type": "netsuite",
  "status": "current",
  "connectionData": {
    "auth_type": "oauth1",
    "netsuite_restlet_host": "https://ACCOUNT_ID.restlets.api.netsuite.com/app/site/hosting/restlet.nl",
    "netsuite_account": "ACCOUNT_ID",
    "netsuite_realm": "ACCOUNT_ID",
    "netsuite_consumer_key": "your-consumer-key",
    "netsuite_consumer_secret": "your-consumer-secret",
    "netsuite_token": "your-token",
    "netsuite_token_secret": "your-token-secret",
    "netsuite_signature_algorithm": "HMAC-SHA256",
    "netsuite_deploy_id": 1,
    "netsuite_order_script_id": "customscript_your_order_script",
    "netsuite_account_script_id": "customscript_your_account_script",
    "mapping_class": "App\\Repositories\\Tenant\\Netsuite\\Mappings\\YourMapping"
  }
}
```

---

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `auth_type` | No | `"oauth2"` for M2M, `"oauth1"` for TBA (default: oauth1) |
| `netsuite_restlet_host` | Yes | RESTlet base URL |
| `netsuite_account` | Yes | NetSuite account ID (e.g., `4325477` or `4325477_SB1`) |
| `client_id` | OAuth2 | Client ID from integration record |
| `certificate_id` | OAuth2 | Certificate ID from M2M setup |
| `private_key` | OAuth2 | PEM-formatted private key |
| `certificate_pem` | OAuth2 (recommended) | PEM-formatted public certificate for expiration tracking |
| `netsuite_realm` | OAuth1 | Usually same as account ID |
| `netsuite_consumer_key` | OAuth1 | Consumer key from integration |
| `netsuite_consumer_secret` | OAuth1 | Consumer secret from integration |
| `netsuite_token` | OAuth1 | Access token |
| `netsuite_token_secret` | OAuth1 | Access token secret |
| `netsuite_deploy_id` | Yes | RESTlet deployment ID (usually `1`) |
| `netsuite_order_script_id` | Yes | Script ID for orders RESTlet |
| `netsuite_account_script_id` | Yes | Script ID for accounts/customers RESTlet |
| `mapping_class` | Yes | PHP mapping class name (for legacy compatibility) |

### Certificate Expiration Tracking

When you include `certificate_pem` in your credentials, the system will:

1. **Automatically parse** the certificate expiration date
2. **Store** it as `certificate_expires_at` in the connection data
3. **Display** the expiration date in the client portal dashboard
4. **Show warnings** when the certificate is expiring within 30 days
5. **Show errors** when the certificate has already expired

---

## How OAuth 2.0 M2M Works

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   DEP Platform  │         │  NetSuite OAuth │         │ NetSuite RESTlet│
│   (client-api)  │         │     Server      │         │                 │
└────────┬────────┘         └────────┬────────┘         └────────┬────────┘
         │                           │                           │
         │  1. POST /token           │                           │
         │  (JWT signed with         │                           │
         │   private key)            │                           │
         │ ─────────────────────────>│                           │
         │                           │                           │
         │  2. Returns access_token  │                           │
         │     (valid ~60 minutes)   │                           │
         │ <─────────────────────────│                           │
         │                           │                           │
         │  3. GET /restlet          │                           │
         │  Authorization: Bearer    │                           │
         │     {access_token}        │                           │
         │ ──────────────────────────────────────────────────────>
         │                           │                           │
         │  4. Returns data          │                           │
         │ <──────────────────────────────────────────────────────
```

**Token Caching**: The platform automatically caches access tokens and refreshes them 5 minutes before expiry.

---

## Troubleshooting

### 403 Forbidden
- Verify the role assigned in M2M setup has RESTlet permissions
- Check that the certificate hasn't expired
- Ensure the account ID format is correct (use underscore for sandbox: `XXXXX_SB1`)

### Invalid Signature
- Verify the private key matches the public certificate uploaded to NetSuite
- Ensure the private key is properly PEM-formatted with newlines

### Token Request Failed
- Check that OAuth 2.0 is enabled in NetSuite features
- Verify the integration has M2M grant enabled
- Ensure the M2M client mapping is active

