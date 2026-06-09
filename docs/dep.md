# Apple Device Enrollment Program (DEP) - Technical Design Document

## Overview

Apple Device Enrollment allows businesses to deploy institutionally owned iOS, tvOS, and macOS devices purchased from participating Apple Authorized Resellers. Integration is via the AppleCare Connect (ACC) web services APIs.

All APIs use **certificate-based authentication** (mTLS). The SSL certificate must correspond to the SoldTo account. ACC validates the certificate against the SoldTo before processing.

All communication is **asynchronous** — Bulk Enroll posts a transaction, and Check Transaction Status must be polled to get the result.

---

## Environments

| Environment | URL | Notes |
|---|---|---|
| Dev/Test (Sandbox) | `https://acc-ipt.apple.com/enroll-service/1.0/` | Static, pre-defined responses |
| Joint UAT (even SoldTo) | `https://api-applecareconnect-ept.apple.com/enroll-service/1.0/` | Fully dynamic, production-like |
| Joint UAT (odd SoldTo) | `https://api-applecareconnect-ept2.apple.com/enroll-service/1.0/` | Fully dynamic, production-like |
| Production | Provided by Apple PM | Live system |

---

## APIs

### 1. Bulk Enroll Devices

**Endpoint:** `POST /enroll-service/1.0/bulk-enroll-devices`

Posts device details into Device Enrollment. Asynchronous — returns a `deviceEnrollmentTransactionId` on success. Must poll Check Transaction Status afterward.

#### Request Structure

```json
{
  "requestContext": {
    "shipTo": "0000052010",        // Required - SoldTo/ShipTo account number
    "timeZone": "420",             // Required - timezone offset (see Timezone table)
    "langCode": "en"               // Required - language code (see Language table)
  },
  "transactionId": "TXN_001122",   // Required - unique transaction ID from reseller
  "depResellerId": "16FCE4A0",     // Required - DEP reseller ID assigned by Apple
  "orders": [                      // Required - one or more orders
    {
      "orderNumber": "ORDER_900123",     // Required - unique order identifier
      "orderDate": "2014-08-28T10:10:10Z", // Required - UTC format
      "orderType": "OR",                 // Required - OR, RE, VD, or OV
      "customerId": "19827",             // Required - customer's Apple organization ID
      "poNumber": "PO_12345",            // Optional - purchase order number
      "deliveries": [                    // Required for OR, RE, OV. Empty/absent for VD
        {
          "deliveryNumber": "D1.2",                  // Required
          "shipDate": "2014-10-10T05:10:00Z",        // Required - must be >= orderDate
          "devices": [                                // Required - one or more devices
            {
              "deviceId": "33645004YAM",             // Required - serial number
              "assetTag": "A123456"                  // Optional
            }
          ]
        }
      ]
    }
  ]
}
```

#### Success Response

```json
{
  "deviceEnrollmentTransactionId": "9acc1cf5-e41d-44d4-a066-78162a389da2_1413529391461",
  "enrollDevicesResponse": {
    "statusCode": "SUCCESS",
    "statusMessage": "Transaction posted successfully in DEP"
  }
}
```

#### Error Responses

Single error:
```json
{
  "enrollDeviceErrorResponse": {
    "errorCode": "GRX-1056",
    "errorMessage": "DEP Reseller ID missing..."
  }
}
```

Multiple errors (array):
```json
{
  "enrollDeviceErrorResponse": [
    { "errorCode": "GRX-1056", "errorMessage": "..." },
    { "errorCode": "DEP-ERR-3003", "errorMessage": "..." }
  ]
}
```

ShipTo error:
```json
{
  "errorCode": "GRX-50025",
  "errorMessage": "Ship-To entered is not valid.",
  "transactionId": "..."
}
```

---

### 2. Check Transaction Status

**Endpoint:** `POST /enroll-service/1.0/check-transaction-status`

Checks the status of a previously submitted Bulk Enroll transaction. Poll every hour until complete.

#### Request

```json
{
  "requestContext": {
    "shipTo": "0000052010",
    "timeZone": "420",
    "langCode": "en"
  },
  "depResellerId": "16FCE4A0",
  "deviceEnrollmentTransactionId": "9acc1cf5-e41d-44d4-a066-78162a389da2_1413529391461"
}
```

#### Success Response

```json
{
  "deviceEnrollmentTransactionID": "cf0ecb03-2993-479b-a891-9e973d3ec6ec_1413530075665",
  "transactionId": "TXN_001122",
  "completedOn": "2014-10-17T07:14:39Z",
  "statusCode": "COMPLETE",
  "orders": [
    {
      "orderNumber": "ORDER_900123",
      "orderPostStatus": "COMPLETE",
      "deliveries": [
        {
          "deliveryNumber": "D1.2",
          "deliveryPostStatus": "COMPLETE",
          "devices": [
            {
              "deviceId": "33645004YAM",
              "devicePostStatus": "COMPLETE"
            }
          ]
        }
      ]
    }
  ]
}
```

#### In-Progress Response

Returns `DEP-ERR-4003` until processing is complete.

#### Error Response (per device)

```json
{
  "devicePostStatus": "DEP-ERR-DE-4305",
  "devicePostStatusMessage": "Device unavailable. The device is assigned to another reseller..."
}
```

#### Transaction Error Response

```json
{
  "checkTransactionErrorResponse": [
    { "errorCode": "GRX-90004", "errorMessage": "Access denied..." }
  ]
}
```

---

### 3. Show Order Details

**Endpoint:** `POST /enroll-service/1.0/show-order-details`

Returns the **current** enrollment status of devices for given order numbers. Used for auditing and reconciliation — not for checking transaction status.

#### Request

```json
{
  "requestContext": {
    "shipTo": "0000052010",
    "timeZone": "420",
    "langCode": "en"
  },
  "depResellerId": "16FCE4A0",
  "orderNumbers": ["123445", "ORD-67890"]
}
```

#### Success Response

```json
{
  "statusCode": "COMPLETE",
  "respondedOn": "2014-10-17T07:22:53Z",
  "orders": [
    {
      "orderNumber": "ORDER_900123",
      "orderDate": "2014-08-28T17:10:10Z",
      "orderType": "OR",
      "customerId": "19827",
      "poNumber": "PO_12345",
      "deliveries": [
        {
          "deliveryNumber": "D1.2",
          "shipDate": "2014-10-10T12:10:00Z",
          "devices": [
            { "deviceId": "33645004YAM", "assetTag": "A123456" }
          ]
        }
      ]
    }
  ]
}
```

#### Order-level errors (mixed response)

```json
{
  "orders": [
    { "orderNumber": "12345", "orderDate": "...", "deliveries": [...] },
    { "orderNumber": "invalid", "showOrderStatusCode": "DEP-ERR-5002", "showOrderStatusMessage": "Unable to locate order." }
  ],
  "statusCode": "COMPLETE"
}
```

#### Transaction Error Response

```json
{
  "showOrderErrorResponse": [
    { "errorCode": "GRX-1056", "errorMessage": "..." }
  ]
}
```

---

## Order Types

### OR (Order) — Standard Enrollment

- Enrolls devices into DEP for a customer's Apple Business Manager account
- Can also add new devices to an existing order number (same order number, new delivery)
- Requires: requestContext, transactionId, depResellerId, orders with deliveries and devices

### RE (Return) — Un-enroll Devices

- Removes specific devices from DEP (device-level, not whole order)
- Order number must be unique — append "Return" or "RE" prefix to original
- Timestamp for RE must be greater than timestamp for original OR
- De-enrolls device, profile revoked, managed content erased
- Does NOT affect replacement devices linked to the original
- Using RE removes ability to use OV or VD on other devices linked to same order number

### VD (Void) — Reverse a Transaction

- Reverses a previous OR, RE, or OV transaction
- Void OR: entire order and all devices revoked from DEP
- Void RE: return nullified, devices put back into DEP (profile may need reinstall)
- Void OV: override reversed, devices removed from DEP
- No deliveries in request body (empty or absent)

### OV (Override) — Replace Entire Order

- Rewrites the entire device list for an order number (OV = VD + OR)
- Can change: devices, delivery info, organization ID, order date
- WARNING: If order has 100 devices and OV is posted with 1 device, the other 99 are removed
- Delivery number should be "SELF" for overrides

### Data Requirements by Order Type

| Field | OR | RE | VD | OV |
|---|---|---|---|---|
| requestContext | Required | Required | Required | Required |
| transactionId | Required | Required | Required | Required |
| depResellerId | Required | Required | Required | Required |
| orderNumber | Required | Required | Required | Required |
| orderDate | Required | Required | Required | Required |
| orderType | Required | Required | Required | Required |
| customerId | Required | Required | Required | Required |
| poNumber | Optional | Optional | Optional | Optional |
| deliveries | Required | Required | Empty/None | Required |
| deliveryNumber | Required | Required | — | Required |
| shipDate | Required | Required | — | Required |
| devices | Required | Required | — | Required |
| deviceId | Required | Required | — | Required |
| assetTag | Optional | Optional | — | Optional |

---

## Key Behaviors & Best Practices

### Asynchronous Processing

- Bulk Enroll is async — poll Check Transaction Status every hour until complete
- Processing can take several hours
- `DEP-ERR-4003` = still in progress, keep polling
- Check Transaction Status returns the result of a specific transaction, not the current state of a device
- Show Order Details returns the current state of a device, not a transaction result

### Check Transaction Status vs Show Order Details

- **Check Transaction Status**: "Was my request successful?" — status of a specific `deviceEnrollmentTransactionId`
- **Show Order Details**: "What is enrolled right now?" — current state of devices under an order number
- If multiple Bulk Enroll requests affect the same device, Check Transaction Status for each returns that transaction's result (not the net effect)

### Overlapping Transactions Example

```
00:00 — POST OR for Order 001, Device 12345 → txnId 01001
01:00 — POST RE for Order 001, Device 12345 → txnId 01002
09:00 — Check Status txnId 01001 → SUCCESS (but device is actually unenrolled by txn 01002)
         Show Order Details for Order 001 → device NOT enrolled (reflects current state)
```

---

## Authentication

- **Certificate-based (mTLS)** — SSL client certificate required for every API call
- Certificate must correspond to the SoldTo account
- ACC validates the certificate against the SoldTo
- Credentials stored per tenant: `ssl_key`, `ssl_cert` in DEP credential type

---

## Date Format

All dates use UTC format: `YYYY-MM-DDThh:mm:ssTZD`

Example: `2014-08-28T10:10:10Z`

---

## Timezone Values

| Timezone | Offset | Canonical ID |
|---|---|---|
| Pacific Standard Time | 480 | America/Los_Angeles |
| Mountain Time | 420 | America/Phoenix |
| Central Standard Time | 360 | America/Chicago |
| Eastern Standard Time | 300 | EST |
| Greenwich Mean Time | 0 | Europe/London |
| Central European Time | -60 | Europe/Berlin |
| Japan Standard Time | -540 | Asia/Tokyo |
| Australian Eastern Standard Time | -600 | Australia/Melbourne |

(Full table includes 40+ timezone entries)

---

## Language Codes

| Language | Code |
|---|---|
| English | en |
| French | fr |
| German | de |
| Spanish | es |
| Japanese | ja |
| Korean | ko |
| Simple Chinese | zh |
| Traditional Chinese | zf |
| Dutch | nl |
| Italian | it |
| Swedish | sv |
| Portuguese | pt |
| Brazilian Portuguese | br |

(Full table includes 25 language codes)

---

## Error Codes

### Transaction Errors (3xxx)

| Code | Description |
|---|---|
| DEP-ERR-3001 | Transaction ID missing |
| DEP-ERR-3002 | Transaction ID character limit exceeded |
| DEP-ERR-3003 | Order information missing (need one or more valid orders) |
| DEP-ERR-3004 | Order number missing |
| DEP-ERR-3005 | Device limit for transaction exceeded |
| DEP-ERR-3006 | Order number character limit exceeded |
| DEP-ERR-3007 | Order limit for transaction exceeded |

### Check Status Errors (4xxx)

| Code | Description |
|---|---|
| DEP-ERR-4001 | Device Enrollment Transaction ID missing |
| DEP-ERR-4002 | Device Enrollment Transaction ID character limit exceeded |
| DEP-ERR-4003 | Enrollment request still in progress |
| DEP-ERR-4004 | Device Enrollment Transaction ID invalid |
| DEP-ERR-4005 | Unable to process request (server error) |

### Order Errors (OR-4xxx)

| Code | Description |
|---|---|
| DEP-ERR-OR-4101 | Customer ID missing |
| DEP-ERR-OR-4102 | Customer ID invalid |
| DEP-ERR-OR-4103 | Customer ID character limit exceeded |
| DEP-ERR-OR-4104 | Order date missing |
| DEP-ERR-OR-4105 | Order date invalid |
| DEP-ERR-OR-4106 | Order type missing |
| DEP-ERR-OR-4107 | Order type invalid |
| DEP-ERR-OR-4108 | PO number character limit exceeded |
| DEP-ERR-OR-4109 | Order number not found (can't void/override non-existent order) |
| DEP-ERR-OR-4110 | Order header mismatch (resubmit as OV or VD first) |
| DEP-ERR-OR-4111 | Delivery number missing |
| DEP-ERR-OR-4112 | Delivery number character limit exceeded |
| DEP-ERR-OR-4113 | Void order invalid (VD must not contain deliveries) |
| DEP-ERR-OR-4114 | Unable to process — invalid or missing info |

### Delivery Errors (DL-4xxx)

| Code | Description |
|---|---|
| DEP-ERR-DL-4201 | Ship date missing |
| DEP-ERR-DL-4202 | Ship date invalid |
| DEP-ERR-DL-4203 | Ship date conflicts with order date (must be >= order date) |
| DEP-ERR-DL-4205 | Device ID missing |
| DEP-ERR-DL-4206 | Device ID character limit exceeded |
| DEP-ERR-DL-4207 | Delivery information invalid |

### Device Errors (DE-4xxx)

| Code | Description |
|---|---|
| DEP-ERR-DE-4301 | Device ID invalid |
| DEP-ERR-DE-4302 | Asset tag character limit exceeded |
| DEP-ERR-DE-4303 | Device ID reused across different OR/OV orders |
| DEP-ERR-DE-4304 | Device assigned to another customer |
| DEP-ERR-DE-4305 | Device assigned to another reseller |
| DEP-ERR-DE-4306 | Device information cannot be located |

### Show Order Errors (5xxx)

| Code | Description |
|---|---|
| DEP-ERR-5001 | Order number required |
| DEP-ERR-5002 | Unable to locate order |
| DEP-ERR-5003 | Unable to process request |
| DEP-ERR-5004 | Unable to process request |
| DEP-ERR-5005 | Auto Whitelisting error — SoldTo(s) not onboarded to DEP |

### General Errors (GRX)

| Code | Description |
|---|---|
| GRX-1000 | Invalid JSON format |
| GRX-1056 | DEP Reseller ID missing |
| GRX-5004 | Data type mismatch |
| GRX-16001 | Server processing error |
| GRX-16002 | Invalid content type (must be text/xml or application/json) |
| GRX-50001 | Not authorized for this operation |
| GRX-50020 | ShipTo is required |
| GRX-50022 | Invalid timezone |
| GRX-50025 | ShipTo not valid |
| GRX-50026 | ShipTo account no longer active |
| GRX-50028 | Language not valid for sales org |
| GRX-50031 | Language code required |
| GRX-50038 | API client certificate not provided or not valid |
| GRX-50072 | System error (urgent — report to DEPSystemDown@group.apple.com) |
| GRX-90004 | Access denied — no permission for this DEP reseller ID |
| GRX-90041 | ShipTo does not have access for this action |

---

## Design Requirements

### Mandatory Requirements

1. **ERP Integration** — All DEP API calls must be automated through the ERP system, not manual processes
2. **Transaction Activity Log** — Maintain accurate records of all API transactions (request + response JSON) for 3-5 years (7 years recommended)
3. **DEP vs Non-DEP Distinction** — System must distinguish which orders/devices are DEP-eligible
4. **Implement ALL Four Order Types** — OR, RE, VD, OV are all mandatory
5. **Returns Must Sync** — When a device is returned, RE must be posted automatically as soon as return IDs are generated
6. **Use Show Order Details** — For validation/reconciliation against Apple's system
7. **Handle Async Complexity** — Track overlapping transactions, poll status, manage multiple orders per transaction

### Operational Requirements

- Poll Check Transaction Status every hour after Bulk Enroll
- Treat unsuccessful orders with urgency — escalate within 24 hours
- For RE orders: use a unique order number (append "Return" to original)
- For VD orders: do not include deliveries
- For OV orders: include ALL devices (it replaces the entire list)

---

## Production Support

### Routine Escalations

Email: cdep.escalations@apple.com

Always include:
- Context and expected resolution
- Device Enrollment Transaction ID
- JSON request
- JSON response

### System Down Escalations (Urgent)

Email: DEPSystemDown@group.apple.com

Qualifies when: error prevents placing orders (e.g., GRX-50072)

Include: request/response JSON, date/time, URL

### Support Hours

AMR: 8:00 AM - 7:00 PM US Central Time, Monday-Friday (excluding US Federal holidays)

### SLAs

- Urgent issues: response within 8 hours
- Routine issues: response within 36 hours
- Updates every 1-2 business days until resolved

---

## Order Scenario Matrix

### Standard Scenarios

| Scenario | Action | Notes |
|---|---|---|
| Standard order | OR with devices | Customer sees devices in ABM within 24h |
| Device return | RE for specific devices | Append "Return" to order number. RE date close to actual return date |
| Add devices to existing order | OR with same order number, new delivery number | Do not change order number |
| Legacy devices with service replacements | OR with original device IDs | Apple auto-updates to replacement serial numbers |

### Error Correction Scenarios

| Scenario | Action | Notes |
|---|---|---|
| Wrong organization ID | OV with correct customerId | Devices move to correct ABM account |
| Wrong order number | VD the wrong order, then OR with correct number | Customer must re-assign devices to MDM |
| Wrong PO/delivery/ship date/asset tag | OV with corrected fields, same devices and order number | Customer may need to re-assign to MDM |
| Devices omitted from order | OR with missing devices, same order and delivery number | Adds to existing order |
| Extra devices posted incorrectly | RE for incorrect devices | Append "Return" to order number |
| Wrong devices in a return | VD the incorrect RE, then RE with correct devices | Two-step correction |
