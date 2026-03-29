# QuickBooks Online API - Complete Surface Area Reference

> Compiled for MCP server design. Covers ALL known API endpoints, entities, operations, and capabilities.

---

## Table of Contents

1. [Base URLs and Authentication](#1-base-urls-and-authentication)
2. [Accounting API - Entity Endpoints](#2-accounting-api---entity-endpoints)
3. [Reports API](#3-reports-api)
4. [Payments API](#4-payments-api)
5. [Payroll & Time API (Premium)](#5-payroll--time-api-premium)
6. [Premium APIs](#6-premium-apis)
7. [Query Language](#7-query-language)
8. [Batch Operations](#8-batch-operations)
9. [Change Data Capture (CDC)](#9-change-data-capture-cdc)
10. [Webhooks](#10-webhooks)
11. [Special Operations](#11-special-operations)
12. [Rate Limits and Throttling](#12-rate-limits-and-throttling)
13. [Known Gotchas and Limitations](#13-known-gotchas-and-limitations)

---

## 1. Base URLs and Authentication

### Base URLs

| Environment | URL |
|---|---|
| Production (Accounting) | `https://quickbooks.api.intuit.com` |
| Sandbox (Accounting) | `https://sandbox-quickbooks.api.intuit.com` |
| Production (Payments) | `https://api.intuit.com` |
| Sandbox (Payments) | `https://sandbox.api.intuit.com` |
| Production (GraphQL/Payroll) | `https://qb.api.intuit.com/graphql` |

### API Path Pattern

```
{baseUrl}/v3/company/{realmId}/{entityName}
{baseUrl}/v3/company/{realmId}/{entityName}/{entityId}
{baseUrl}/v3/company/{realmId}/query?query={sql-like-query}
{baseUrl}/v3/company/{realmId}/reports/{reportName}
```

### Minor Versions

- Pass `?minorversion=XX` on every request
- As of Aug 2025, versions 1-74 are deprecated; use **minorversion=75** or higher
- Latest version is in the 70s range (check release notes for exact current number)

### OAuth 2.0 Authentication

| Endpoint | URL |
|---|---|
| Authorization | `https://appcenter.intuit.com/connect/oauth2` |
| Token Exchange | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` |
| Token Revocation | `https://developer.api.intuit.com/v2/oauth2/tokens/revoke` |
| UserInfo (OpenID) | `https://accounts.platform.intuit.com/v1/openid_connect/userinfo` |
| Discovery Document | `https://developer.api.intuit.com/.well-known/openid_configuration` |

### OAuth Scopes

| Scope | Purpose |
|---|---|
| `com.intuit.quickbooks.accounting` | Full access to Accounting API |
| `com.intuit.quickbooks.payment` | Access to Payments API |
| `payroll.compensation.read` | Read payroll compensation data (Premium) |
| `project-management.project` | Read/write project data (Premium) |
| `openid` | OpenID Connect authentication |
| `profile` | User profile info |
| `email` | User email |
| `phone` | User phone |
| `address` | User address |

### Token Lifetimes

| Token Type | Lifetime |
|---|---|
| Access Token | **1 hour** (non-configurable) |
| Refresh Token | **100 days** rolling (extends each use); max 5 years absolute |
| Authorization Code | **5 minutes** |

### OAuth Flow Steps

1. Redirect user to authorization URL with `client_id`, `scope`, `redirect_uri`, `response_type=code`, `state`
2. User authorizes, Intuit redirects back with `code` and `realmId`
3. Exchange `code` for access_token + refresh_token via POST to token endpoint
4. Use `Authorization: Bearer {access_token}` header on all API calls
5. Refresh token before expiry via POST to token endpoint with `grant_type=refresh_token`
6. Revoke tokens on disconnect via POST to revocation endpoint

---

## 2. Accounting API - Entity Endpoints

### 2A. Transaction Entities

These represent financial transactions. All support Query.

| Entity | Create | Read | Update | Delete | Void | Send/Email | PDF |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Bill** | Y | Y | Y | Y | - | - | - |
| **BillPayment** | Y | Y | Y | Y | Y | - | - |
| **CreditMemo** | Y | Y | Y | Y | - | Y | Y |
| **Deposit** | Y | Y | Y | Y | - | - | - |
| **Estimate** | Y | Y | Y | Y | - | Y | Y |
| **Invoice** | Y | Y | Y | Y | Y | Y | Y |
| **JournalEntry** | Y | Y | Y | Y | - | - | - |
| **Payment** | Y | Y | Y | Y | Y | - | - |
| **Purchase** | Y | Y | Y | Y | - | - | - |
| **PurchaseOrder** | Y | Y | Y | Y | - | Y | - |
| **RefundReceipt** | Y | Y | Y | Y | - | - | Y |
| **SalesReceipt** | Y | Y | Y | Y | Y | Y | Y |
| **TimeActivity** | Y | Y | Y | Y | - | - | - |
| **Transfer** | Y | Y | Y | Y | - | - | - |
| **VendorCredit** | Y | Y | Y | Y | - | - | - |

#### Endpoint Patterns for Transactions

```
POST   /v3/company/{realmId}/{entity}                          # Create
GET    /v3/company/{realmId}/{entity}/{id}                     # Read
POST   /v3/company/{realmId}/{entity}                          # Update (full or sparse)
POST   /v3/company/{realmId}/{entity}?operation=delete         # Delete
POST   /v3/company/{realmId}/{entity}?operation=void           # Void (Invoice, Payment, SalesReceipt, BillPayment)
POST   /v3/company/{realmId}/{entity}/{id}/send                # Send via email
POST   /v3/company/{realmId}/{entity}/{id}/send?sendTo=email   # Send to specific email
GET    /v3/company/{realmId}/{entity}/{id}/pdf                 # Download PDF
GET    /v3/company/{realmId}/query?query=SELECT * FROM Entity  # Query
```

### 2B. Name List Entities

These represent reference/master data. None support Delete (use Active=false to deactivate instead).

| Entity | Create | Read | Update | Query | Notes |
|---|:---:|:---:|:---:|:---:|---|
| **Account** | Y | Y | Y | Y | Chart of accounts |
| **Budget** | - | Y | - | Y | Read-only via API |
| **Class** | Y | Y | Y | Y | Transaction classification |
| **CompanyCurrency** | Y | Y | Y | Y | Multi-currency support |
| **Customer** | Y | Y | Y | Y | Supports sub-customers (ParentRef) |
| **Department** | Y | Y | Y | Y | Location/division tracking |
| **Employee** | Y | Y | Y | Y | Payroll employees |
| **Item** | Y | Y | Y | Y | Products and services |
| **JournalCode** | Y | Y | Y | Y | France locale only |
| **PaymentMethod** | Y | Y | Y | Y | Cash, check, credit card, etc. |
| **TaxAgency** | Y | Y | Y | Y | Tax collection agencies |
| **TaxCode** | - | Y | Y | Y | Cannot create directly; use TaxService |
| **TaxRate** | - | Y | Y | Y | Cannot create directly; use TaxService |
| **TaxService** | Y | - | - | - | Create-only proxy to generate TaxCode+TaxRate |
| **Term** | Y | Y | Y | Y | Payment terms (Net 30, etc.) |
| **Vendor** | Y | Y | Y | Y | Supports sub-vendors |

#### Deactivation Pattern (Name List Entities)

```json
// POST /v3/company/{realmId}/customer?operation=update
{
  "Id": "123",
  "SyncToken": "0",
  "Active": false,
  "sparse": true
}
```

### 2C. Supporting Entities

| Entity | Create | Read | Update | Delete | Query | Notes |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **Attachable** | Y | Y | Y | Y | Y | File attachments + metadata-only notes |
| **CompanyInfo** | - | Y | Y | - | Y | Company settings (single record) |
| **Entitlements** | - | Y | - | - | - | Subscription/plan info (read-only) |
| **ExchangeRate** | - | Y | Y | - | Y | Currency exchange rates |
| **Preferences** | - | Y | Y | - | Y | Company preferences (single record) |

#### Attachable - File Upload

```
POST /v3/company/{realmId}/upload
Content-Type: multipart/form-data

Part 1: file_metadata (application/json) - Attachable object with AttachableRef
Part 2: file_content (application/octet-stream) - The actual file
```

Supported file types: AI, CSV, DOC, DOCX, EPS, GIF, JPEG, JPG, ODS, PDF, PNG, RTF, TIF, TXT, XLS, XLSX, XML.
Max file size: 100 MB per file, 1 GB total per company.

---

## 3. Reports API

### Endpoint Pattern

```
GET /v3/company/{realmId}/reports/{ReportName}?{parameters}
```

Reports are **read-only** (GET only). No create/update/delete.

### Complete List of Report Endpoints

#### Financial Statements

| Report Name | Endpoint Path | Key Parameters |
|---|---|---|
| **Profit and Loss** | `/reports/ProfitAndLoss` | `start_date`, `end_date`, `accounting_method`, `summarize_column_by` |
| **Profit and Loss Detail** | `/reports/ProfitAndLossDetail` | `start_date`, `end_date`, `accounting_method`, `columns` |
| **Balance Sheet** | `/reports/BalanceSheet` | `date_macro`, `start_date`, `end_date`, `accounting_method` |
| **Cash Flow** | `/reports/CashFlow` | `start_date`, `end_date`, `summarize_column_by` |
| **Trial Balance** | `/reports/TrialBalance` | `start_date`, `end_date`, `accounting_method` |
| **Trial Balance (FR)** | `/reports/TrialBalanceFR` | France-specific trial balance |
| **General Ledger** | `/reports/GeneralLedger` | `start_date`, `end_date`, `columns`, `account` |
| **General Ledger Detail** | `/reports/GeneralLedgerDetail` | Same as above, more detail |
| **Journal Report** | `/reports/JournalReport` | `start_date`, `end_date` |

#### Accounts Receivable

| Report Name | Endpoint Path | Key Parameters |
|---|---|---|
| **AR Aging Summary** | `/reports/AgedReceivables` | `report_date`, `aging_period`, `num_periods` |
| **AR Aging Detail** | `/reports/AgedReceivableDetail` | `report_date`, `start_duedate`, `end_duedate` |
| **Customer Balance** | `/reports/CustomerBalance` | `report_date`, `accounting_method` |
| **Customer Balance Detail** | `/reports/CustomerBalanceDetail` | `report_date`, `start_date`, `end_date` |
| **Customer Income** | `/reports/CustomerIncome` | `start_date`, `end_date` |
| **Customer Sales** | `/reports/CustomerSales` | `start_date`, `end_date` |

#### Accounts Payable

| Report Name | Endpoint Path | Key Parameters |
|---|---|---|
| **AP Aging Summary** | `/reports/AgedPayables` | `report_date`, `aging_period`, `num_periods` |
| **AP Aging Detail** | `/reports/AgedPayableDetail` | `report_date`, `start_duedate`, `end_duedate` |
| **Vendor Balance** | `/reports/VendorBalance` | `report_date` |
| **Vendor Balance Detail** | `/reports/VendorBalanceDetail` | `report_date`, `start_date`, `end_date` |
| **Vendor Expenses** | `/reports/VendorExpenses` | `start_date`, `end_date` |

#### Sales and Inventory

| Report Name | Endpoint Path | Key Parameters |
|---|---|---|
| **Item Sales** | `/reports/ItemSales` | `start_date`, `end_date` |
| **Inventory Valuation Summary** | `/reports/InventoryValuationSummary` | `report_date` |
| **Department Sales** | `/reports/DepartmentSales` | `start_date`, `end_date` |
| **Class Sales** | `/reports/ClassSales` | `start_date`, `end_date` |

#### Transaction Lists

| Report Name | Endpoint Path | Key Parameters |
|---|---|---|
| **Transaction List** | `/reports/TransactionList` | `start_date`, `end_date`, `columns`, `transaction_type` |
| **Transaction List with Splits** | `/reports/TransactionListWithSplits` | Same as above |
| **Transaction List by Customer** | `/reports/TransactionListByCustomer` | `start_date`, `end_date`, `customer` |
| **Transaction List by Vendor** | `/reports/TransactionListByVendor` | `start_date`, `end_date`, `vendor` |

#### Tax

| Report Name | Endpoint Path | Key Parameters |
|---|---|---|
| **Tax Summary** | `/reports/TaxSummary` | `start_date`, `end_date` |

#### Other

| Report Name | Endpoint Path | Key Parameters |
|---|---|---|
| **Account List Detail** | `/reports/AccountListDetail` | `accounting_method` |

### Common Report Parameters

| Parameter | Description |
|---|---|
| `start_date` | Start date (YYYY-MM-DD) |
| `end_date` | End date (YYYY-MM-DD) |
| `date_macro` | Predefined date range (Today, ThisMonth, ThisFiscalYear, etc.) |
| `accounting_method` | `Accrual` or `Cash` |
| `summarize_column_by` | `Total`, `Month`, `Week`, `Days`, `Quarter`, `Year`, `Customers`, etc. |
| `columns` | Comma-separated column names to include |
| `department` | Filter by department ID(s) |
| `customer` | Filter by customer ID |
| `vendor` | Filter by vendor ID |
| `account` | Filter by account ID |
| `qzurl` | `true` to include drill-down URLs |
| `aging_period` | Number of days per aging period |
| `num_periods` | Number of aging periods |

### Report Response Structure

All reports return a standard structure:
```json
{
  "Header": { "Time": "...", "ReportName": "...", "ReportBasis": "...", "StartPeriod": "...", "EndPeriod": "...", "Currency": "..." },
  "Columns": { "Column": [{ "ColTitle": "...", "ColType": "..." }] },
  "Rows": { "Row": [{ "ColData": [{ "value": "...", "id": "..." }], "group": "...", "Summary": {...} }] }
}
```

### Report Limitations

- **400,000 cell hard limit** per response (cells = rows x columns)
- **25+ columns** significantly increases risk of 504 Gateway Timeout
- Reports do NOT support pagination; you must reduce date ranges or columns
- **Date chunking**: Limit to 6-month windows to avoid cell limits
- Some reports use `start_duedate`/`end_duedate` instead of `start_date`/`end_date`
- Check company's `Preferences` entity for `ReportBasis` (Accrual vs Cash) to match

---

## 4. Payments API

### Base URL

| Environment | URL |
|---|---|
| Production | `https://api.intuit.com/quickbooks/v4/payments` |
| Sandbox | `https://sandbox.api.intuit.com/quickbooks/v4/payments` |

### Required Headers

```
Authorization: Bearer {access_token}
Company-Id: {realmId}
Content-Type: application/json
Request-Id: {unique-uuid}
```

### Charges (Credit Card Payments)

| Operation | Method | Endpoint |
|---|---|---|
| Create charge | POST | `/charges` |
| Read charge | GET | `/charges/{chargeId}` |
| Capture charge | POST | `/charges/{chargeId}/capture` |
| Refund charge | POST | `/charges/{chargeId}/refunds` |
| Read refund | GET | `/charges/{chargeId}/refunds/{refundId}` |

### eChecks (ACH/Bank Transfers)

| Operation | Method | Endpoint |
|---|---|---|
| Create eCheck | POST | `/echecks` |
| Read eCheck | GET | `/echecks/{echeckId}` |
| Refund eCheck | POST | `/echecks/{echeckId}/refunds` |
| Read eCheck refund | GET | `/echecks/{echeckId}/refunds/{refundId}` |

### Tokens (PCI Tokenization)

| Operation | Method | Endpoint |
|---|---|---|
| Create token | POST | `/tokens` |

Tokens are single-use opaque tokens created from raw card/bank data for PCI compliance.

### Cards (Saved Customer Cards)

| Operation | Method | Endpoint |
|---|---|---|
| List cards | GET | `/customers/{customerId}/cards` |
| Read card | GET | `/customers/{customerId}/cards/{cardId}` |
| Create card | POST | `/customers/{customerId}/cards` |
| Create from token | POST | `/customers/{customerId}/cards/createFromToken` |
| Delete card | DELETE | `/customers/{customerId}/cards/{cardId}` |

### Bank Accounts (Saved Customer Bank Accounts)

| Operation | Method | Endpoint |
|---|---|---|
| List accounts | GET | `/customers/{customerId}/bank-accounts` |
| Read account | GET | `/customers/{customerId}/bank-accounts/{bankAccountId}` |
| Create account | POST | `/customers/{customerId}/bank-accounts` |
| Create from token | POST | `/customers/{customerId}/bank-accounts/createFromToken` |
| Delete account | DELETE | `/customers/{customerId}/bank-accounts/{bankAccountId}` |

---

## 5. Payroll & Time API (Premium)

Access requires Gold/Silver/Platinum tier in Intuit App Partner Program.

### Architecture

Uses a **dual-layer** approach:
- **GraphQL layer** for payroll compensation queries (scope: `payroll.compensation.read`)
- **REST layer** for TimeActivity operations (standard Accounting API)

### GraphQL Endpoint

```
POST https://qb.api.intuit.com/graphql
Authorization: Bearer {access_token}
```

**Note**: No sandbox environment for Payroll GraphQL.

### Key Operations

| Operation | Layer | Details |
|---|---|---|
| List employee compensations | GraphQL | `payrollEmployeeCompensations` query |
| Read pay types | GraphQL | Returns salary, hourly, overtime, holiday, etc. |
| Create time entry | REST | `POST /v3/company/{realmId}/timeactivity?minorversion=70` |
| Read time entries | REST | Standard TimeActivity CRUD |
| Link to payroll item | REST | Use `PayrollItemRef` with compensation type ID |

### TimeActivity Entity (REST)

Standard Accounting API entity with payroll extensions:
- `EmployeeRef` - Link to employee
- `PayrollItemRef` - Compensation type from GraphQL
- `CustomerRef` - Billable customer
- `ItemRef` - Service item
- `ProjectRef` - Project link (Premium)

---

## 6. Premium APIs

Requires Gold/Platinum tier (Silver for some). Announced July 2025.

### Projects API

**Scope**: `project-management.project`

| Operation | Layer | Details |
|---|---|---|
| Create project | GraphQL | `projectManagementCreateProject` mutation |
| List projects | GraphQL | `projectManagementProjects` query (with filters, pagination) |
| Update project | GraphQL | Mutation with id, name, status, dates |
| Delete project | GraphQL | Mutation |
| Link transaction | REST | Add `ProjectRef` to Invoice, Bill, TimeActivity, etc. |

### Custom Fields API

- Up to 12 custom fields per company
- Available across multiple transaction types
- GraphQL-based access
- Can be attached to Invoices, Estimates, Sales Receipts, etc.

### Sales Tax API (Automated)

- Automated Sales Tax (AST) engine calculates tax based on address
- `TaxService` entity used as proxy to create TaxCode objects
- Tax is computed server-side; apps provide shipping address

---

## 7. Query Language

### Syntax

```sql
SELECT * FROM EntityName
  WHERE FieldName = 'value'
  AND FieldName > 'value'
  ORDERBY FieldName [ASC|DESC]
  STARTPOSITION 1
  MAXRESULTS 1000
```

### Endpoint

```
GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE TxnDate > '2024-01-01' MAXRESULTS 100
```

### Supported Operators

| Operator | Example |
|---|---|
| `=` | `WHERE DisplayName = 'John'` |
| `!=` | `WHERE Active != true` |
| `<` | `WHERE TxnDate < '2024-01-01'` |
| `>` | `WHERE Balance > '0'` |
| `<=` | `WHERE TxnDate <= '2024-12-31'` |
| `>=` | `WHERE Balance >= '100'` |
| `LIKE` | `WHERE DisplayName LIKE 'John%'` (% wildcard only) |
| `IN` | `WHERE Id IN ('1', '2', '3')` |

### COUNT Queries

```sql
SELECT COUNT(*) FROM Invoice
-- Returns: { "QueryResponse": { "totalCount": 42 } }
```

### Pagination

| Parameter | Default | Maximum |
|---|---|---|
| `MAXRESULTS` | 100 | 1000 |
| `STARTPOSITION` | 1 | No limit |

**Pagination pattern:**
1. `SELECT COUNT(*) FROM Entity` to get total
2. Loop with `STARTPOSITION {n} MAXRESULTS 1000`
3. Continue until `STARTPOSITION > totalCount`

### Query Rules

- String comparison values MUST use **single quotes** (not double quotes)
- Entity names, attributes, and reserved words are **NOT case sensitive**
- `LIKE` only supports `%` wildcard (no `_` wildcard)
- `OR` is NOT supported; use `IN` instead
- Not all fields are queryable; check entity docs for queryable fields
- Date format: `'YYYY-MM-DD'`
- DateTime format: `'YYYY-MM-DDTHH:MM:SS-HH:MM'` (with timezone offset)

---

## 8. Batch Operations

### Endpoint

```
POST /v3/company/{realmId}/batch
```

### Request Format

```json
{
  "BatchItemRequest": [
    {
      "bId": "1",
      "operation": "create",
      "Invoice": { ... }
    },
    {
      "bId": "2",
      "operation": "query",
      "Query": "SELECT * FROM Customer WHERE DisplayName = 'John'"
    },
    {
      "bId": "3",
      "operation": "update",
      "Customer": { "Id": "5", "SyncToken": "0", "DisplayName": "Updated Name", "sparse": true }
    },
    {
      "bId": "4",
      "operation": "delete",
      "Invoice": { "Id": "10", "SyncToken": "2" }
    }
  ]
}
```

### Supported Operations in Batch

- `create`
- `update`
- `delete`
- `query`

### Constraints

- **Maximum 30 operations** per batch request
- **40 batch requests per minute** per realmId
- Operations execute **serially** within a batch
- Operations **cannot reference** earlier operations in the same batch (e.g., create Customer then create Invoice for that Customer in the same batch will fail)
- Each operation is independent; one failure does not roll back others

### Response Format

```json
{
  "BatchItemResponse": [
    { "bId": "1", "Invoice": { ... } },
    { "bId": "2", "QueryResponse": { ... } },
    { "bId": "3", "Customer": { ... } },
    { "bId": "4", "Fault": { "Error": [{ "Message": "...", "code": "..." }] } }
  ]
}
```

---

## 9. Change Data Capture (CDC)

### Endpoint

```
GET /v3/company/{realmId}/cdc?entities={comma-separated-list}&changedSince={ISO-datetime}
```

### Example

```
GET /v3/company/1234/cdc?entities=Invoice,Customer,Payment&changedSince=2024-01-01T00:00:00-08:00
```

### Response Format

```json
{
  "CDCResponse": [
    {
      "QueryResponse": [
        {
          "Invoice": [ { "Id": "1", ... }, { "Id": "2", ... } ]
        },
        {
          "Customer": [ { "Id": "5", ... } ]
        }
      ]
    }
  ]
}
```

### Constraints

- **Maximum 1,000 objects** returned per entity type per request
- **Look-back period**: Up to **30 days** maximum from `changedSince`
- All entity types that support Query also support CDC
- Deleted entities are returned with `status: "Deleted"` metadata
- Combine with webhooks for a robust sync architecture

### Supported Entities

All entities that support the Query operation also support CDC. This includes all Transaction entities, all Name List entities, and supporting entities like Attachable, CompanyInfo, ExchangeRate, and Preferences.

---

## 10. Webhooks

### Setup

Configured in the Intuit Developer Portal (not via API). You register:
1. A webhook endpoint URL (HTTPS required)
2. Which entities to subscribe to
3. Intuit provides a **Verifier Token** for HMAC validation

### Notification Payload

```json
{
  "eventNotifications": [
    {
      "realmId": "1234567890",
      "dataChangeEvent": {
        "entities": [
          {
            "name": "Invoice",
            "id": "123",
            "operation": "Create",
            "lastUpdated": "2024-01-15T10:30:00.000Z",
            "deletedId": null
          }
        ]
      }
    }
  ]
}
```

### Supported Operations

| Operation | Description |
|---|---|
| `Create` | New entity created |
| `Update` | Existing entity modified |
| `Delete` | Entity deleted |
| `Merge` | Entities merged (includes `deletedId` of merged-away entity) |
| `Void` | Transaction voided |

### Supported Entity Types

Webhooks support most (but not all) entities. Confirmed supported:
- Account, Bill, BillPayment, Budget, Class, CreditMemo, Currency, Customer, Department, Deposit, Employee, Estimate, Invoice, Item, JournalEntry, Payment, PaymentMethod, Preferences, Purchase, PurchaseOrder, RefundReceipt, SalesReceipt, TaxCode, Term, TimeActivity, Transfer, Vendor, VendorCredit

**Not supported**: Reports, Entitlements, CompanyInfo, ExchangeRate, Attachable (verify in developer portal).

### HMAC-SHA256 Verification

```
1. Compute HMAC-SHA256 of the raw request body using the Verifier Token as the key
2. Base64-encode the result
3. Compare with the `intuit-signature` header value
4. Reject if they don't match
```

### Webhook Rules

- Respond with **HTTP 200 within 3 seconds** or Intuit retries
- Do NOT process the notification synchronously; enqueue for async processing
- **Best-effort delivery** with retries (not guaranteed exactly-once)
- After receiving a webhook, call the Read/CDC API to get the actual entity data (webhooks only notify, they don't include the full entity)
- Combine with periodic CDC calls to catch any missed webhooks
- Webhooks are NOT metered (free)

---

## 11. Special Operations

### Void

```
POST /v3/company/{realmId}/invoice?operation=void
Body: { "Id": "123", "SyncToken": "2" }
```

**Entities that support Void**: Invoice, Payment, SalesReceipt, BillPayment

When voided:
- Transaction remains in the system (not deleted)
- All amounts and quantities are zeroed out
- "Voided" is appended to `PrivateNote`

### Send (Email)

```
POST /v3/company/{realmId}/invoice/{id}/send
POST /v3/company/{realmId}/invoice/{id}/send?sendTo=customer@email.com
```

**Entities that support Send**: Invoice, Estimate, CreditMemo, SalesReceipt, PurchaseOrder

After sending:
- `EmailStatus` is set to `EmailSent`
- `DeliveryInfo` is populated with send details
- `BillEmail.Address` is updated if `sendTo` was specified

### PDF Download

```
GET /v3/company/{realmId}/invoice/{id}/pdf
Accept: application/pdf
```

**Entities that support PDF**: Invoice, Estimate, CreditMemo, SalesReceipt, RefundReceipt

Returns the document formatted according to company's custom form styles.

### Sparse Update

```
POST /v3/company/{realmId}/customer
{
  "Id": "123",
  "SyncToken": "0",
  "DisplayName": "Updated Name Only",
  "sparse": true
}
```

- Supported on ALL entities that support Update
- Only specified fields are modified; unspecified fields are left untouched
- Always use `sparse: true` to avoid accidentally blanking fields
- **SyncToken is always required** for updates (optimistic concurrency control)

### Delete

```
POST /v3/company/{realmId}/invoice?operation=delete
Body: { "Id": "123", "SyncToken": "2" }
```

**Three ways to "remove" entities:**
1. **Delete** - Permanent removal (transactions only)
2. **Void** - Zero out amounts but keep record (transactions only)
3. **Deactivate** - Set `Active: false` (name list entities only)

Name list entities (Customer, Vendor, Item, etc.) do NOT support delete; use deactivation.

---

## 12. Rate Limits and Throttling

### API Rate Limits

| Limit Type | Value |
|---|---|
| Standard requests | **500 per minute** per realmId |
| Concurrent requests | **10 simultaneous** per realmId |
| Batch requests | **40 per minute** per realmId |
| Resource-intensive endpoints | **200 per minute** per realmId |

### Error Response

HTTP 429 Too Many Requests when rate limited.

### Metering (API Usage Costs)

| API Category | Metering Status |
|---|---|
| Core APIs (create/update) | **Currently unmetered** |
| CorePlus APIs (read/query) | **Metered** (potential charges) |
| Payments API | **Not metered** |
| Payroll API | **Not metered** |
| OAuth endpoints | **Not metered** |
| Sandbox endpoints | **Not metered** |
| Webhooks (receiving) | **Not metered** |

### Best Practices

- Use Batch API to consolidate multiple reads into one call
- Use CDC instead of polling individual entities
- Use webhooks for real-time notifications
- Implement exponential backoff on 429 errors
- Cache frequently-read reference data (Accounts, Items, TaxCodes)

---

## 13. Known Gotchas and Limitations

### General

1. **SyncToken required for all updates** - If you send the wrong SyncToken, you get a stale object error. Always read before update.
2. **POST for everything** - Creates, updates, deletes, and voids all use POST (not PUT/DELETE). Only reads and queries use GET.
3. **No partial/filtered reads** - You cannot request specific fields when reading a single entity; you always get the full object.
4. **Minor version matters** - Different minor versions return different fields and behaviors. Pin to a specific version.
5. **Single quotes in queries** - String values MUST be in single quotes, not double quotes.
6. **No OR in queries** - Use `IN` operator instead.
7. **LIKE only supports %** - No underscore wildcard, no regex.
8. **Name list entities cannot be deleted** - Only deactivated via `Active: false`.
9. **France-specific: JournalCode required** - All JournalEntries in France locale must reference a JournalCode or validation fails.

### Reports

10. **400,000 cell limit** - Reports exceeding this hard limit will error.
11. **No pagination for reports** - You must narrow date ranges or reduce columns.
12. **Different date parameters** - AP/AR aging reports use `start_duedate`/`end_duedate`, not `start_date`/`end_date`.
13. **Compliance dates vs transaction dates** - Reports use compliance dates for revenue recognition, which may differ from `TxnDate`.
14. **NoReportData** - When a report returns no data, it still returns the full structure with `NoReportData: true`.

### Webhooks

15. **Best-effort delivery** - Webhooks can be missed; always pair with CDC.
16. **3-second response timeout** - Process asynchronously.
17. **No entity data in payload** - Webhooks only contain entity ID and operation; you must call the API to get the full entity.
18. **Not all entities supported** - Some entities cannot trigger webhooks.

### OAuth

19. **Access token is only 1 hour** - Must refresh proactively.
20. **Refresh token is 100 days rolling, 5 years absolute** - If refresh token expires, user must re-authorize.
21. **RealmId can change** - After company migration, realmId may change (rare but possible).

### Payments

22. **Request-Id header required** - Must be a unique UUID per request for idempotency.
23. **No sandbox for Payroll GraphQL** - Test payroll in production only.

### Data

24. **Default query limit is 100** - Always specify `MAXRESULTS 1000` for bulk retrieval.
25. **Max 1000 results per query** - Must paginate for large datasets.
26. **CDC max 30-day lookback** - Cannot retrieve changes older than 30 days.
27. **CDC max 1000 objects per entity** - Must paginate if more than 1000 changes.
28. **Batch max 30 operations** - Operations within a batch are serial and independent.
29. **Automated Sales Tax** - Cannot directly control tax calculation for US companies using AST; use TaxService proxy approach.
30. **Multi-currency** - Must enable in CompanyInfo; once enabled, cannot be disabled. ExchangeRate entity only available with multi-currency enabled.

---

## Appendix: Complete Entity Index

### All Accounting Entities (Alphabetical)

| # | Entity | Category | C | R | U | D | Q | Void | Send | PDF |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | Account | Name List | Y | Y | Y | - | Y | - | - | - |
| 2 | Attachable | Supporting | Y | Y | Y | Y | Y | - | - | - |
| 3 | Bill | Transaction | Y | Y | Y | Y | Y | - | - | - |
| 4 | BillPayment | Transaction | Y | Y | Y | Y | Y | Y | - | - |
| 5 | Budget | Name List | - | Y | - | - | Y | - | - | - |
| 6 | Class | Name List | Y | Y | Y | - | Y | - | - | - |
| 7 | CompanyCurrency | Name List | Y | Y | Y | - | Y | - | - | - |
| 8 | CompanyInfo | Supporting | - | Y | Y | - | Y | - | - | - |
| 9 | CreditMemo | Transaction | Y | Y | Y | Y | Y | - | Y | Y |
| 10 | Customer | Name List | Y | Y | Y | - | Y | - | - | - |
| 11 | Department | Name List | Y | Y | Y | - | Y | - | - | - |
| 12 | Deposit | Transaction | Y | Y | Y | Y | Y | - | - | - |
| 13 | Employee | Name List | Y | Y | Y | - | Y | - | - | - |
| 14 | Entitlements | Supporting | - | Y | - | - | - | - | - | - |
| 15 | Estimate | Transaction | Y | Y | Y | Y | Y | - | Y | Y |
| 16 | ExchangeRate | Supporting | - | Y | Y | - | Y | - | - | - |
| 17 | Invoice | Transaction | Y | Y | Y | Y | Y | Y | Y | Y |
| 18 | Item | Name List | Y | Y | Y | - | Y | - | - | - |
| 19 | JournalCode | Name List | Y | Y | Y | - | Y | - | - | - |
| 20 | JournalEntry | Transaction | Y | Y | Y | Y | Y | - | - | - |
| 21 | Payment | Transaction | Y | Y | Y | Y | Y | Y | - | - |
| 22 | PaymentMethod | Name List | Y | Y | Y | - | Y | - | - | - |
| 23 | Preferences | Supporting | - | Y | Y | - | Y | - | - | - |
| 24 | Purchase | Transaction | Y | Y | Y | Y | Y | - | - | - |
| 25 | PurchaseOrder | Transaction | Y | Y | Y | Y | Y | - | Y | - |
| 26 | RefundReceipt | Transaction | Y | Y | Y | Y | Y | - | - | Y |
| 27 | SalesReceipt | Transaction | Y | Y | Y | Y | Y | Y | Y | Y |
| 28 | TaxAgency | Name List | Y | Y | Y | - | Y | - | - | - |
| 29 | TaxCode | Name List | - | Y | Y | - | Y | - | - | - |
| 30 | TaxRate | Name List | - | Y | Y | - | Y | - | - | - |
| 31 | TaxService | Name List | Y | - | - | - | - | - | - | - |
| 32 | Term | Name List | Y | Y | Y | - | Y | - | - | - |
| 33 | TimeActivity | Transaction | Y | Y | Y | Y | Y | - | - | - |
| 34 | Transfer | Transaction | Y | Y | Y | Y | Y | - | - | - |
| 35 | Vendor | Name List | Y | Y | Y | - | Y | - | - | - |
| 36 | VendorCredit | Transaction | Y | Y | Y | Y | Y | - | - | - |

### All Report Types (29 Reports)

| # | Report Name | API Path |
|---|---|---|
| 1 | Profit and Loss | ProfitAndLoss |
| 2 | Profit and Loss Detail | ProfitAndLossDetail |
| 3 | Balance Sheet | BalanceSheet |
| 4 | Cash Flow | CashFlow |
| 5 | Trial Balance | TrialBalance |
| 6 | Trial Balance (France) | TrialBalanceFR |
| 7 | General Ledger | GeneralLedger |
| 8 | General Ledger Detail | GeneralLedgerDetail |
| 9 | Journal Report | JournalReport |
| 10 | AR Aging Summary | AgedReceivables |
| 11 | AR Aging Detail | AgedReceivableDetail |
| 12 | AP Aging Summary | AgedPayables |
| 13 | AP Aging Detail | AgedPayableDetail |
| 14 | Customer Balance | CustomerBalance |
| 15 | Customer Balance Detail | CustomerBalanceDetail |
| 16 | Customer Income | CustomerIncome |
| 17 | Customer Sales | CustomerSales |
| 18 | Vendor Balance | VendorBalance |
| 19 | Vendor Balance Detail | VendorBalanceDetail |
| 20 | Vendor Expenses | VendorExpenses |
| 21 | Item Sales | ItemSales |
| 22 | Inventory Valuation Summary | InventoryValuationSummary |
| 23 | Department Sales | DepartmentSales |
| 24 | Class Sales | ClassSales |
| 25 | Transaction List | TransactionList |
| 26 | Transaction List with Splits | TransactionListWithSplits |
| 27 | Transaction List by Customer | TransactionListByCustomer |
| 28 | Transaction List by Vendor | TransactionListByVendor |
| 29 | Tax Summary | TaxSummary |
| 30 | Account List Detail | AccountListDetail |

### All Payments API Endpoints

| # | Operation | Method | Path |
|---|---|---|---|
| 1 | Create charge | POST | /payments/charges |
| 2 | Read charge | GET | /payments/charges/{chargeId} |
| 3 | Capture charge | POST | /payments/charges/{chargeId}/capture |
| 4 | Refund charge | POST | /payments/charges/{chargeId}/refunds |
| 5 | Read refund | GET | /payments/charges/{chargeId}/refunds/{refundId} |
| 6 | Create eCheck | POST | /payments/echecks |
| 7 | Read eCheck | GET | /payments/echecks/{echeckId} |
| 8 | Refund eCheck | POST | /payments/echecks/{echeckId}/refunds |
| 9 | Read eCheck refund | GET | /payments/echecks/{echeckId}/refunds/{refundId} |
| 10 | Create token | POST | /payments/tokens |
| 11 | List cards | GET | /payments/customers/{id}/cards |
| 12 | Read card | GET | /payments/customers/{id}/cards/{cardId} |
| 13 | Create card | POST | /payments/customers/{id}/cards |
| 14 | Create card from token | POST | /payments/customers/{id}/cards/createFromToken |
| 15 | Delete card | DELETE | /payments/customers/{id}/cards/{cardId} |
| 16 | List bank accounts | GET | /payments/customers/{id}/bank-accounts |
| 17 | Read bank account | GET | /payments/customers/{id}/bank-accounts/{bankAcctId} |
| 18 | Create bank account | POST | /payments/customers/{id}/bank-accounts |
| 19 | Create bank from token | POST | /payments/customers/{id}/bank-accounts/createFromToken |
| 20 | Delete bank account | DELETE | /payments/customers/{id}/bank-accounts/{bankAcctId} |

---

## MCP Server Design Considerations

For an MCP server covering the entire QuickBooks API:

1. **Tool count**: ~36 entity CRUD tools + 30 report tools + 20 payments tools + batch + CDC + query = ~100+ tools
2. **Auth handling**: OAuth 2.0 with automatic token refresh; store refresh token securely
3. **Error mapping**: Map QBO error codes to structured MCP errors
4. **Pagination abstraction**: Provide auto-pagination option for queries
5. **Sparse updates**: Default to sparse updates to prevent data loss
6. **Minor version pinning**: Always pass minorversion parameter
7. **Rate limit handling**: Built-in retry with exponential backoff on 429
8. **Webhook receiver**: Optional HTTP server for webhook processing
9. **CDC sync**: Provide a sync tool that combines webhooks + CDC
10. **Report date chunking**: Auto-chunk large report date ranges

---

*Last updated: 2026-03-29*
*Sources: Intuit Developer Documentation, node-quickbooks library, community SDKs, Intuit blog posts*
