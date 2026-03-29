# Quick-Fin: MCP Server for QuickBooks Online API

## Comprehensive Architecture Plan
### Synthesized from 30-Iteration Multi-Persona Audit (CPA x10, Data Engineer x10, CFO x10)

---

## 1. Project Overview

Quick-Fin is a TypeScript MCP (Model Context Protocol) server providing AI assistants with governed, auditable, and secure access to the complete QuickBooks Online API surface:

- **36 Accounting entities** (Invoice, Bill, Payment, Customer, Vendor, Account, JournalEntry, etc.)
- **30 Report types** (P&L, Balance Sheet, Cash Flow, Trial Balance, General Ledger, AR/AP Aging, etc.)
- **20 Payments API endpoints** (credit card charges, ACH/eChecks, PCI tokenization, saved payment methods)
- **Premium APIs**: Payroll (GraphQL), Projects, Custom Fields, Automated Sales Tax
- **Infrastructure**: OAuth 2.0, SQL-like query, Batch (30 ops), CDC (30-day lookback), Webhooks (HMAC-SHA256)

---

## 2. Integrated Audit Summary

| Persona | Iterations | Findings | Critical | High | Medium | Low |
|---------|-----------|----------|----------|------|--------|-----|
| CPA | 10 | 56 | 7 | 10 | 17 | 22 |
| Data Engineer | 10 | 25 | 5 | 8 | 9 | 7 |
| CFO | 10 | 16 | 4 | 5 | 6 | 4 |
| **Cross-Persona Deduplicated** | **30** | **~70 unique** | **12** | **16** | **22** | **20** |

---

## 3. Critical Findings (Must Ship Before v1.0)

### C-01: Authorization & Approval Controls [CPA F-01, CFO C-1]
**No authorization layer on financial transactions.** A single OAuth token grants unrestricted CRUD on all entities. AI can create $10M journal entries, fraudulent vendors, and drain accounts with zero human oversight.

**Fix — Approval Workflow Engine:**
- `ControlPolicy` configuration with dollar thresholds per entity type
- High-risk operations (JournalEntry, Vendor creation, Payment, Account modification, Void) require dual authorization
- `pending_approval` queue with notification, escalation timers, and TTL
- MCP tools: `list_pending_approvals`, `approve_operation`, `reject_operation`
- Transport-layer enforcement: payment endpoints return 403 unless a signed approval token (with expiry, approver identity, amount ceiling) is provided

### C-02: Segregation of Duties [CPA F-02, CFO M-1]
**Same AI session can create vendor + enter bill + approve bill + initiate payment.** Collapses fundamental internal controls.

**Fix — SoD Engine:**
- Conflict matrix enforced at runtime:
  - Vendor creation <-> Payment approval
  - Invoice creation <-> Payment receipt
  - JE creation <-> JE approval
  - Bank reconciliation <-> Transaction entry
  - User access management <-> Transaction processing
- Block conflicting operations by same session/user on same entity within configurable window
- Tier 3 (Transact) cannot execute payments; Tier 5 (Treasury) cannot create vendors

### C-03: Immutable Audit Trail [CPA F-07, CFO H-2, DE C-5]
**Self-attesting audit logs can be compromised, incomplete, or retroactively modified.** External auditors cannot rely on evidence.

**Fix — Cryptographic Append-Only Audit Log:**
- SHA-256 hash chain (each entry includes hash of previous entry)
- External NTP timestamps (not local clock)
- Write to immutable store (S3 Object Lock COMPLIANCE mode)
- Dual-write: local SQLite + external immutable store
- Fields: `entryId, previousHash, entryHash, ntpTimestamp, sessionId, userId, aiModelId, operation, requestPayloadEncrypted, responsePayload, qboTransactionId, approvalTokenRef`
- `verify_audit_chain` MCP tool for integrity validation
- Monthly completeness audit (API call counts vs log entry counts)

### C-04: OAuth Token Security [DE C-1, DE C-2, CFO C-3]
**Token refresh failure bricks connection. Concurrent refresh race condition. Token compromise = full account takeover.**

**Fix — Token Lifecycle Manager:**
- Write-ahead logging: persist new token atomically BEFORE using it (atomic file write: `write -> fsync -> rename`)
- Coalescing promise pattern: only one refresh in-flight per realmId (`Map<realmId, Promise<TokenPair>>`)
- AES-256 encryption at rest, IP range binding, device fingerprint
- Refresh tokens in platform keychain (macOS Keychain, etc.), never env vars
- Automatic rotation on every refresh
- Company-level kill switch for immediate revocation
- Proactive expiry alerts at 30/14/7/1 day
- Pre-operation freshness check before long operations
- Operation checkpointing for resume after re-auth

### C-05: Payment Execution Controls [CFO C-1]
**AI can initiate credit card charges, ACH payments, eChecks, and refunds — directly moving real money.**

**Fix — Treasury Controls:**
- ALL payment operations require dual human authorization (two separate approvers for >$1,000)
- Payments disabled by default; must be explicitly enabled per-company by a named officer
- Idempotency keys mandatory on all payment operations
- Payment velocity limits: 10/hour, $50,000/day aggregate
- No payment to vendors created within 72 hours (cooling period)
- Vendor bank detail changes require out-of-band verification

### C-06: Decimal Precision [DE C-4, CPA F-09]
**JavaScript `number` (IEEE 754) cannot represent $0.01 exactly.** `0.1 + 0.2 = 0.30000000000000004`. All monetary calculations produce rounding errors.

**Fix — Money Type:**
```typescript
// Option A: bigint cents
class Money { private cents: bigint; currency: string; }

// Option B: decimal.js
type QBOMoney = z.union([z.string(), z.number()])
  .transform(v => new Decimal(String(v)));
```
- All internal arithmetic via `Decimal` or integer cents
- Convert to/from QBO's decimal string format ONLY at API boundary
- Round to 2 decimal places with `Decimal.toFixed(2)` at serialization
- Mandatory test suite for classic floating-point failures

### C-07: Idempotency on Mutations [DE C-3, CPA F-10]
**Network timeouts after server-side processing create duplicate Invoices, Payments, Bills.**

**Fix — Idempotency Layer:**
- Deterministic fingerprint: `sha256(operationType + entityType + JSON.stringify(sortedKeyFields))`
- Persistent registry: `Map<fingerprint, {status, entityId, timestamp}>` with 1-hour TTL
- Check before every mutating call; if match exists and succeeded, return cached result
- For in-flight operations, await existing promise
- Disk-backed persistence for crash recovery
- Post-write verification query where QBO `requestid` not supported

### C-08: PCI-DSS Compliance [CPA F-05]
**Payments API handles card tokens/numbers. Any system transmitting/storing cardholder data is PCI-scoped.**

**Fix — PCI Layer:**
- NEVER log, store, or transmit full PANs
- Mask to last 4 digits in ALL outputs (API responses, logs, errors, cache)
- Direct clients to QBO's client-side tokenization (SAQ A eligible)
- `sensitive_data_scanner`: Luhn-check regex on all output paths, redacting matches
- Architectural documentation declaring SAQ scope

### C-09: PII/Payroll Protection [CPA F-06, CFO C-2]
**Payroll API exposes SSNs, compensation, bank accounts. AI conversation context may be logged/cached by model providers.**

**Fix — Data Classification & Masking:**
- Four-tier classification: Public, Internal, Confidential, Restricted
- Field-level classification map for ALL 36+ QBO entity types
- Restricted fields (SSN, TIN, bank account numbers, compensation) masked to last 4 everywhere
- Full values only via dedicated `retrieve_sensitive_field` tool with elevated auth + rate limit (10/hour)
- Payroll module disabled by default, requires officer authorization
- Write access to payroll permanently prohibited through MCP server
- AES-256 at-rest encryption with external KMS

### C-10: Period-Close Enforcement [CPA F-03]
**No server-side concept of periods being open/closed.** Transactions posted to closed periods corrupt previously issued financial statements.

**Fix — Period Controller:**
Five-stage workflow:
1. **Open** — All operations permitted per normal controls
2. **Preliminary Close** — Standard entries blocked, AJEs permitted with Controller approval
3. **Under Review** — Only Controller-approved AJEs
4. **Final Close** — No entries except audit adjustments with dual authorization
5. **Audit Adjustment** — Freeze for external audit; only auditor-approved adjustments

Period transitions require Controller-level authorization with immutable logging. Fiscal calendar derived from QBO `CompanyInfo`.

### C-11: Intuit ToS Compliance [CFO C-4]
**Intuit's Developer Terms may prohibit AI-agent-initiated API calls or automated transaction creation without direct user interaction.**

**Fix:**
- Obtain written confirmation from Intuit Developer Relations before production release
- Quarterly ToS review process
- Build API access revocation contingency plan
- Prominent user disclosure of platform dependency risk

### C-12: Management Override Detection [CPA F-04]
**All controls can be overridden by admins with no detection or external notification.**

**Fix — Override Detection System:**
- Separate "exception" (one-time with justification) from "disable" (turning off control)
- All overrides logged in dedicated override log replicated to external system (SIEM, email to audit committee)
- Critical overrides trigger immediate multi-party notification
- Override budget with escalation when exceeded

---

## 4. High-Priority Findings (Must Ship Before v1.1)

### H-01: SyncToken Conflict Resolution [DE H-1, DE M-1]
- Per-entity async mutex via `async-mutex` (lock key: `${entityType}:${entityId}`)
- 5-second acquisition timeout
- Field-type-aware conflict resolution:
  - Financial fields: never auto-merge, surface conflict with both versions
  - Metadata fields: last-write-wins with audit log
  - Status fields: monotonic transitions only (Draft->Sent ok, Sent->Draft rejected)

### H-02: Batch Partial Failure [DE H-2, CPA F-12, F-28]
- Per-item result tracking: `BatchResult { items: Array<{index, status, entity?, error?}> }`
- `retryFailed(previousResult)` helper (never re-sends successful items)
- Aggregate threshold checks (sum all amounts by type before submission)
- Flag batches with multiple items to same vendor/customer
- Dependent vs independent operation classification
- Compensating transactions on partial failure of dependent sets

### H-03: CDC Truncation Detection [DE H-3]
- CDC returns max 1000 per entity type with NO "more available" indicator
- On `count === 1000`: binary-search the time window (split at midpoint, recurse)
- Deduplicate by `(entityType, entityId)` keeping latest `LastUpdatedTime`
- Daily full reconciliation run
- 25-day staleness alert (CDC only looks back 30 days)

### H-04: Circuit Breaker [DE H-4]
- Per-endpoint-group via `cockatiel`: `accounting-crud`, `reports`, `payments`, `payroll`
- Open after 5 failures in 60 seconds
- Half-open after 30 seconds, close after 2 successes
- Descriptive error: "QBO Reports API experiencing issues, circuit breaker open — retry in ~30s"

### H-05: Rate Limit Management [DE H-5, DE H-6, CFO M-6]
- Per-realmId token bucket (500 tokens, refill 500/min)
- Priority queue: P0=mutations, P1=active reads, P2=bulk/reports
- Fair-share: `floor(500/activeSessions)` guaranteed per session
- AI operations capped at 300 req/min (60%), reserving 200 for human users
- `p-limit(10)` concurrency semaphore (separate from rate limiting)
- Adaptive calibration from `X-RateLimit-Remaining` response headers

### H-06: Webhook Reliability [DE H-7]
- Return 200 immediately after HMAC validation; enqueue to `BullMQ` (Redis-backed)
- Deduplication: `(realmId, entityType, entityId, lastUpdated)` via Redis SET with 24h TTL
- Fetch current entity state from QBO API (webhooks only contain IDs)
- CDC reconciliation loop every 5 minutes
- HMAC via `crypto.timingSafeEqual()`
- Dead-letter queue for persistent failures
- TLS 1.2+ only, 5-minute replay window

### H-07: Multi-Tenant Data Isolation [DE H-8]
- `TenantContext` with frozen `realmId` (Object.freeze)
- Required by construction in ALL subsystems (CacheManager, RateLimiter, HttpClient, AuditLogger)
- Cache keys auto-prefixed: `realm:${realmId}:`
- HTTP client validates response `realmId` matches context
- No subsystem can be instantiated without TenantContext

### H-08: Customer Communication Controls [CFO H-3]
- Email sending (Invoice, Estimate, CreditMemo, SalesReceipt, PurchaseOrder) disabled by default
- When enabled: mandatory draft-and-queue model — AI prepares, never sends
- Human reviews outbound queue with full preview
- Batch email approval requires minimum 10% sample review
- All sent emails logged with content, recipient, timestamp, approver

### H-09: Financial Report Integrity [CFO H-4]
- All AI-generated reports watermarked: "GENERATED VIA AI INTEGRATION — SUBJECT TO VERIFICATION"
- Metadata: timestamp, data freshness indicator, accounting basis, filters applied
- Reports for external distribution require Controller/CFO sign-off
- Report consistency tracker: hash on generation, flag changes on re-generation

### H-10: Vendor Master Protection (BEC Prevention) [CFO H-5]
- Vendor bank detail changes require out-of-band verification (phone call to vendor using number on file)
- New vendor creation requires supporting documentation and AP Manager approval
- 72-hour cooling period on new/modified vendors before payment eligibility
- Full before/after change logging for all vendor modifications

### H-11: Transaction Integrity Validation [CPA F-08]
- `PreSubmissionValidator` middleware chain:
  - JE balance check (integer cents arithmetic — debits must equal credits)
  - Active account validation
  - Required field enforcement
  - Tax code validity
  - Payment <= invoice balance
  - Configurable per-company via plugin interface

### H-12: Void Controls [CPA F-13]
- ALL voids require human approval regardless of amount
- Mandatory reason from controlled vocabulary
- `VoidCascadeEngine`: identifies all downstream impacts (linked payments, credits)
- Void ordering enforced (payments before source documents)
- Post-void consistency check
- Void rate anomaly detector vs rolling baseline

### H-13: Configuration Change Control [CPA F-11]
- Versioned, immutable configuration store
- Every change requires Controller authorization
- Logged with before/after values and justification
- Four-eyes principle for changes to control thresholds
- `config_drift_detector` comparing runtime vs baseline

### H-14: Audit Evidence Packaging [CPA F-14]
- Full evidence chain per transaction:
  - Original human instruction/trigger
  - AI reasoning chain
  - Source document references
  - Pre-submission validation results
  - Approval chain
- Linked to QBO transaction IDs
- Bulk export as PDF with SHA-256 manifest and digital signatures

### H-15: Key Management [CPA F-15]
- External KMS (AWS KMS, Azure Key Vault, or HashiCorp Vault)
- Separate keys: token encryption, PII encryption, audit signing, webhook HMAC
- Annual rotation with re-encryption
- Immediate rotation on compromise
- Envelope encryption: data key encrypted with master key
- Key access logging

### H-16: Disaster Recovery [CPA F-17]
- PostgreSQL with point-in-time recovery (RPO: 15min transactional, 1hr audit)
- S3 cross-region replication for audit logs
- Configuration in version control
- RTO: 4 hours
- Quarterly recovery testing with documented runbook

---

## 5. Permission Tier Model

| Tier | Name | Create | Read | Update | Delete | Payment | Payroll | Email Send | Reconcile | Batch >5 |
|------|------|--------|------|--------|--------|---------|---------|------------|-----------|----------|
| 1 | Analyst | No | Yes (masked) | No | No | No | No | No | No | No |
| 2 | Bookkeeper | Draft only | Yes | Draft only | No | No | No | No | No | No |
| 3 | Controller | Yes (limits) | Yes | Yes (limits) | With approval | No | No | No | No | With approval |
| 4 | CFO | Yes | Yes | Yes | Yes | With Tier 5 co-approval | Aggregate read | With approval | Yes | Yes (dry-run) |
| 5 | Treasury | No* | Yes (masked) | No | No | Yes (dual approval) | No | No | No | No |

*Tier 5 can only create payment records.

**Incompatibilities:** Tier 3 and Tier 5 cannot be held by the same user. Tier 4 payments require Tier 5 co-approval.

---

## 6. Dollar Thresholds and Limits

### Per-Transaction

| Operation | Auto-Execute (AI) | Single Approval | Dual Approval / Escalation |
|-----------|-------------------|-----------------|---------------------------|
| Invoice creation | Up to $5,000 | $5,001-$50,000 | >$50,000 |
| Bill entry | Up to $2,500 | $2,501-$25,000 | >$25,000 |
| Payment (any) | Never auto-execute | $1-$10,000 (dual) | >$10,000 (officer + dual) |
| Refund / Credit memo | Never auto-execute | $1-$5,000 (dual) | >$5,000 (officer + dual) |
| Journal entry | Up to $1,000 | $1,001-$25,000 | >$25,000 |
| Expense entry | Up to $500 | $501-$5,000 | >$5,000 |
| Estimate creation | Up to $10,000 | $10,001-$100,000 | >$100,000 |

### Daily Aggregates

| Metric | Limit | Escalation |
|--------|-------|------------|
| Total payments value | $25,000 | CFO approval for additional |
| Total invoices created value | $250,000 | Controller review |
| Total journal entries count | 50 | Auto-pause, Controller approval |
| Total records modified | 200 | Auto-pause, health review |
| Total records deleted | 10 | Each requires individual approval |
| Payment count | 10/hour, 40/day | Auto-pause with alerting |

### Cooling Periods

| Trigger | Period | Override |
|---------|--------|---------|
| New vendor created | 72 hours before payment eligible | CFO + documented justification |
| Vendor bank details changed | 72 hours | CFO + out-of-band verification |
| Bulk operation (>5 records) | 15-minute reversal window | Cannot be overridden |
| Payment batch completed | 48 hours before same-vendor re-payment | Controller override |
| Failed approval (3 consecutive) | Session suspended | Security team review |

---

## 7. Technical Architecture

### 7.1 System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        MCP Protocol Layer                        │
│  (Tool definitions, request/response serialization, transport)   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                     Governance Layer                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  Permission   │ │   Approval   │ │     SoD      │            │
│  │   Tier RBAC   │ │   Workflow   │ │    Engine    │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │   Period      │ │  Materiality │ │  Override    │            │
│  │  Controller   │ │   Engine     │ │  Detector    │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                     Validation Layer                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  Pre-Submit   │ │  Duplicate   │ │  Idempotency │            │
│  │  Validators   │ │  Detection   │ │    Layer     │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │   Schema      │ │    Money     │ │   PCI/PII    │            │
│  │  Validation   │ │    Type      │ │   Masking    │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                     API Client Layer                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │   Token       │ │    Rate      │ │   Circuit    │            │
│  │  Manager      │ │   Limiter    │ │   Breaker    │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  HTTP Pool    │ │  Concurrency │ │    Error     │            │
│  │  (undici)     │ │  Semaphore   │ │  Classifier  │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                     Observability Layer                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  Audit Log    │ │  Structured  │ │   Health     │            │
│  │ (immutable)   │ │   Logging    │ │   Checks     │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│  ┌──────────────┐ ┌──────────────┐                              │
│  │  Continuous   │ │   Anomaly    │                              │
│  │  Monitoring   │ │  Detection   │                              │
│  └──────────────┘ └──────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 MCP Tool Organization (~110 tools)

#### Accounting Entity Tools (72 tools)
For each of the 36 entities, up to 6 operations:
- `qbo_create_{entity}` — Create with pre-submission validation
- `qbo_read_{entity}` — Read with PII masking per tier
- `qbo_update_{entity}` — Sparse update with SyncToken management
- `qbo_delete_{entity}` — Delete with approval workflow (transactions only)
- `qbo_query_{entity}` — SQL-like query with auto-pagination
- `qbo_void_{entity}` — Void with cascade analysis (Invoice, Payment, SalesReceipt, BillPayment)

Special operations:
- `qbo_send_{entity}` — Email (Invoice, Estimate, CreditMemo, SalesReceipt, PurchaseOrder) — queued, never direct
- `qbo_pdf_{entity}` — PDF download (Invoice, Estimate, CreditMemo, SalesReceipt, RefundReceipt)
- `qbo_upload_attachment` — File upload (multipart, 100MB max)

#### Report Tools (30 tools)
One per report type, with auto-chunking:
- `qbo_report_profit_and_loss`, `qbo_report_balance_sheet`, `qbo_report_cash_flow`
- `qbo_report_trial_balance`, `qbo_report_general_ledger`, `qbo_report_journal`
- `qbo_report_ar_aging_summary`, `qbo_report_ar_aging_detail`
- `qbo_report_ap_aging_summary`, `qbo_report_ap_aging_detail`
- `qbo_report_customer_balance`, `qbo_report_vendor_balance`, etc.

#### Payment Tools (10 tools)
- `qbo_charge_create`, `qbo_charge_capture`, `qbo_charge_refund`
- `qbo_echeck_create`, `qbo_echeck_refund`
- `qbo_token_create`
- `qbo_card_list`, `qbo_card_save`, `qbo_card_delete`
- `qbo_bank_account_manage`

#### Infrastructure Tools (8 tools)
- `qbo_batch_execute` — Up to 30 ops with per-item results
- `qbo_cdc_poll` — Change Data Capture with truncation detection
- `qbo_query` — Free-form SQL-like query with OR rewriting
- `qbo_webhook_status` — Webhook health and missed-event report
- `qbo_connect` — OAuth flow initiation
- `qbo_disconnect` — Token revocation + full tenant cleanup
- `qbo_company_info` — Company settings and preferences
- `qbo_health` — Server health, token status, rate limit, circuit breakers

#### Governance Tools (12 tools)
- `qbo_list_pending_approvals` — Review pending operations
- `qbo_approve_operation` — Approve a pending operation
- `qbo_reject_operation` — Reject a pending operation
- `qbo_audit_query` — Search audit log by date/entity/user/session
- `qbo_verify_audit_chain` — Validate hash chain integrity
- `qbo_period_status` — View period open/close status
- `qbo_period_transition` — Transition period stage (Controller+)
- `qbo_reconciliation_run` — Run QBO-to-MCP reconciliation
- `qbo_duplicate_scan` — Retrospective duplicate detection
- `qbo_orphan_report` — Find unlinked records
- `qbo_token_status` — Token expiry and health
- `qbo_fiscal_calendar` — Company fiscal periods

#### Compliance Tools (8 tools)
- `qbo_vendor_1099_readiness` — 1099 readiness report
- `qbo_benfords_analysis` — Benford's law distribution analysis
- `qbo_je_anomaly_scan` — Journal entry anomaly scoring
- `qbo_related_party_check` — Related-party transaction detection
- `qbo_close_readiness` — Pre-close validation checklist
- `qbo_retention_status` — Record retention status
- `qbo_historical_scan` — Initial comprehensive data scan
- `qbo_report_change_log` — Report consistency tracking

### 7.3 Data Flow for a Write Operation

```
AI Request (e.g., create Invoice for $15,000)
  │
  ├─ 1. TenantContext: Validate realmId, create frozen context
  ├─ 2. RBAC: Check session tier >= Tier 3 (Controller)
  ├─ 3. Period Controller: Verify target date is in open period
  ├─ 4. SoD Engine: Verify no conflicting operations by this session
  ├─ 5. Schema Validation: Zod parse + Money type coercion
  ├─ 6. Pre-Submit Validators:
  │     ├─ Required fields present
  │     ├─ Account active and valid
  │     ├─ Tax code valid for jurisdiction
  │     ├─ Currency consistent with customer
  │     └─ Revenue recognition rules check
  ├─ 7. Duplicate Detection: Fuzzy match (customer + amount + date)
  ├─ 8. Idempotency Check: Fingerprint lookup
  ├─ 9. Materiality Engine: $15K > $5K threshold → requires approval
  ├─ 10. Approval Workflow: Queue operation, notify approver
  │       ... (human approves via qbo_approve_operation) ...
  ├─ 11. PCI/PII Masking: Scan outbound payload
  ├─ 12. Rate Limiter: Acquire token from bucket
  ├─ 13. Concurrency Semaphore: Acquire (p-limit(10))
  ├─ 14. Circuit Breaker: Check accounting-crud circuit
  ├─ 15. HTTP Client: POST to QBO API with minorversion=75
  ├─ 16. Error Classifier: Map response to ErrorCategory
  ├─ 17. Audit Logger: Write to immutable store (pre-committed)
  ├─ 18. Idempotency Registry: Store fingerprint → entityId
  └─ 19. Return: Masked response to AI with audit traceId
```

### 7.4 Key Library Choices

| Concern | Library | Rationale |
|---------|---------|-----------|
| MCP SDK | `@modelcontextprotocol/sdk` | Official SDK |
| HTTP Client | `undici` | Node.js native, connection pooling, `connections: 10` |
| Decimal Math | `decimal.js` | Precise financial arithmetic |
| Schema Validation | `zod` | TypeScript-native, composable, transformers |
| Rate Limiting | Custom token bucket | 500/min with priority queue |
| Concurrency | `p-limit` | Simple semaphore for 10-connection limit |
| Circuit Breaker | `cockatiel` | Mature, configurable, TypeScript |
| Retry | `p-retry` | Decorrelated jitter support |
| Entity Lock | `async-mutex` | Per-entity optimistic concurrency |
| Logging | `pino` | Structured JSON, fast, child loggers |
| Queue (Webhooks) | `BullMQ` | Redis-backed, reliable, dead-letter |
| Database | `better-sqlite3` | WAL mode, audit log, idempotency registry |
| KMS | `@aws-sdk/client-kms` (or equiv) | External key management |
| Testing | `vitest` + `nock` | Fast, TypeScript-native, HTTP mocking |

### 7.5 Project Structure

```
quick-fin/
├── src/
│   ├── server.ts                    # MCP server entry point
│   ├── config/
│   │   ├── schema.ts                # Zod config schema
│   │   └── defaults.ts              # Default configuration
│   ├── auth/
│   │   ├── token-manager.ts         # OAuth token lifecycle
│   │   ├── token-store.ts           # Encrypted token persistence
│   │   └── oauth-flow.ts            # Authorization code flow
│   ├── governance/
│   │   ├── rbac.ts                  # Permission tier enforcement
│   │   ├── approval-workflow.ts     # Approval queue + routing
│   │   ├── sod-engine.ts            # Segregation of duties
│   │   ├── period-controller.ts     # Period open/close management
│   │   ├── materiality-engine.ts    # Dollar threshold routing
│   │   ├── override-detector.ts     # Management override tracking
│   │   └── control-policy.ts        # Configurable policy engine
│   ├── validation/
│   │   ├── pre-submit/
│   │   │   ├── je-balance.ts        # Debit = Credit check
│   │   │   ├── account-validity.ts  # Active account check
│   │   │   ├── tax-compliance.ts    # Tax code validation
│   │   │   ├── currency-guard.ts    # Multi-currency controls
│   │   │   ├── revenue-recognition.ts # ASC 606 guard
│   │   │   └── basis-consistency.ts # Accrual vs Cash
│   │   ├── duplicate-detection.ts   # Fuzzy matching engine
│   │   ├── idempotency.ts           # Fingerprint registry
│   │   └── void-cascade.ts          # Void impact analysis
│   ├── schemas/
│   │   ├── entities/                # Zod schemas for all 36 entities
│   │   ├── reports/                 # Report parameter schemas
│   │   ├── payments/                # Payment API schemas
│   │   └── money.ts                 # Money/Decimal type
│   ├── client/
│   │   ├── http-pool.ts             # undici connection pool
│   │   ├── rate-limiter.ts          # Token bucket + priority queue
│   │   ├── concurrency.ts           # p-limit(10) semaphore
│   │   ├── circuit-breaker.ts       # Per-group circuit breakers
│   │   ├── error-classifier.ts      # Error taxonomy + recovery
│   │   ├── retry.ts                 # Decorrelated jitter backoff
│   │   └── entity-lock.ts           # Per-entity async mutex
│   ├── tools/
│   │   ├── accounting/              # 36 entity tool sets
│   │   ├── reports/                 # 30 report tools
│   │   ├── payments/                # Payment tools
│   │   ├── infrastructure/          # Batch, CDC, Query, Webhook
│   │   ├── governance/              # Approval, audit, period tools
│   │   └── compliance/              # Benford, anomaly, 1099 tools
│   ├── sync/
│   │   ├── cdc-manager.ts           # CDC polling + truncation detection
│   │   ├── webhook-processor.ts     # HMAC validation + async queue
│   │   └── reconciliation.ts        # QBO <-> MCP reconciliation
│   ├── audit/
│   │   ├── audit-logger.ts          # Hash-chained immutable log
│   │   ├── evidence-packager.ts     # Full evidence chain
│   │   └── chain-verifier.ts        # Audit chain integrity
│   ├── security/
│   │   ├── pci-scanner.ts           # PAN detection + masking
│   │   ├── pii-masker.ts            # Field-level classification + masking
│   │   ├── data-classification.ts   # 4-tier classification map
│   │   └── kms-adapter.ts           # External key management
│   ├── monitoring/
│   │   ├── continuous-monitor.ts    # Scheduled rule engine
│   │   ├── anomaly-scorer.ts        # JE anomaly detection
│   │   ├── benfords.ts              # Benford's law analysis
│   │   ├── related-party.ts         # Related-party detection
│   │   └── health-check.ts          # /health endpoint
│   ├── reports/
│   │   ├── report-chunker.ts        # Auto-chunking for 400K cell limit
│   │   ├── report-cache.ts          # TTL + entity-type invalidation
│   │   └── consistency-tracker.ts   # Hash-based change detection
│   ├── tenant/
│   │   ├── tenant-context.ts        # Frozen realmId context
│   │   └── lifecycle-manager.ts     # Connect/disconnect + LRU cleanup
│   └── utils/
│       ├── fiscal-calendar.ts       # Fiscal year period calculations
│       ├── query-executor.ts        # Pagination, OR rewriting
│       ├── batch-executor.ts        # Per-item tracking
│       ├── shutdown-manager.ts      # Graceful drain
│       └── retention-policy.ts      # Record lifecycle
├── test/
│   ├── unit/                        # Nock fixtures, isolated tests
│   ├── integration/                 # QBO sandbox tests
│   └── contract/                    # Sanitized production recordings
├── docs/
│   ├── AUDIT_CPA.md                 # Full CPA audit (56 findings)
│   ├── AUDIT_DATA_ENGINEER.md       # Full DE audit (25 findings)
│   ├── AUDIT_CFO.md                 # Full CFO audit (16 findings)
│   └── GOVERNANCE.md                # Governance framework
├── package.json
├── tsconfig.json
├── .nvmrc
├── .env.example
└── CLAUDE.md
```

---

## 8. Implementation Roadmap

### Phase 1: Foundation (v0.1) — Weeks 1-3
- [ ] Project scaffolding (TypeScript, MCP SDK, undici, Zod)
- [ ] OAuth 2.0 flow with encrypted token storage
- [ ] Token manager with coalescing refresh
- [ ] Money type with decimal.js
- [ ] HTTP pool with rate limiter + concurrency semaphore
- [ ] Error classifier with retry + jitter
- [ ] Schema definitions for top 10 entities (Invoice, Customer, Vendor, Bill, Payment, Account, Item, JournalEntry, Estimate, SalesReceipt)
- [ ] Basic CRUD tools for top 10 entities
- [ ] Structured logging (pino)
- [ ] Health check endpoint

### Phase 2: Governance Core (v0.2) — Weeks 4-6
- [ ] RBAC with 5 permission tiers
- [ ] Approval workflow engine with pending queue
- [ ] SoD engine with conflict matrix
- [ ] Control policy configuration
- [ ] Dollar thresholds (per-transaction + daily aggregate)
- [ ] Immutable audit log (hash-chained, SQLite)
- [ ] Idempotency layer
- [ ] Pre-submission validators (JE balance, account validity)
- [ ] Tenant context with isolation enforcement

### Phase 3: Full Entity Coverage (v0.3) — Weeks 7-9
- [ ] Remaining 26 entity schemas + tools
- [ ] All 30 report tools with auto-chunking
- [ ] Report cache with entity-type invalidation
- [ ] Query executor with auto-pagination + OR rewriting
- [ ] Batch executor with per-item tracking
- [ ] Void cascade engine
- [ ] Duplicate detection
- [ ] PDF download tools
- [ ] Email send (draft-and-queue only)
- [ ] File upload (attachments)

### Phase 4: Payments & Premium (v0.4) — Weeks 10-11
- [ ] Payments API tools (charges, eChecks, tokens, saved methods)
- [ ] PCI scanner + PAN masking
- [ ] Payment velocity controls
- [ ] Payroll read-only tools (masked, opt-in only)
- [ ] Projects API (GraphQL)
- [ ] Custom Fields API (GraphQL)
- [ ] Period controller (5-stage close)

### Phase 5: Sync & Monitoring (v0.5) — Weeks 12-14
- [ ] CDC manager with truncation detection + binary search
- [ ] Webhook processor (BullMQ, HMAC, dedup)
- [ ] CDC + webhook hybrid reconciliation
- [ ] Circuit breakers (4 groups)
- [ ] Continuous monitoring engine
- [ ] JE anomaly scorer
- [ ] Benford's law analyzer
- [ ] Related-party detector
- [ ] Historical scan on initial connection

### Phase 6: Compliance & Hardening (v1.0) — Weeks 15-18
- [ ] External KMS integration
- [ ] Audit evidence packager (PDF export)
- [ ] Override detection + external notification
- [ ] Revenue recognition guard (ASC 606)
- [ ] Tax compliance validators (sales tax, 1099)
- [ ] Multi-currency guard
- [ ] Vendor 72-hour cooling period enforcement
- [ ] Configuration change control
- [ ] Data classification + field-level masking for all entities
- [ ] PII masker for all entity types
- [ ] Retention policy engine
- [ ] Disaster recovery plan + quarterly testing
- [ ] Graceful shutdown manager
- [ ] Full test suite (unit + integration + contract)
- [ ] Security review + PCI scope documentation
- [ ] Intuit ToS compliance verification

---

## 9. Governance Framework (16 Controls)

1. **Tiered Permission Model** — 5 tiers with explicit allow/deny enforced at transport layer
2. **Dual Authorization** — All cash-moving operations require two separate approvers
3. **Dollar Thresholds** — Per-transaction and daily aggregate with automatic escalation
4. **Payroll Isolation** — Disabled by default, write permanently prohibited, read aggregated only
5. **Email Prohibition (Default)** — Draft-and-queue model, human review mandatory
6. **Immutable Audit Log** — External write-once store, hash-chained, monthly verification
7. **Batch Safeguards** — Max 25 records, dry-run for >5, 15-minute reversal window
8. **Report Integrity** — AI watermarking, external-use sign-off, consistency tracking
9. **Vendor Master Protection** — Out-of-band verification, 72-hour cooling, full change logging
10. **Duplicate Detection** — Mandatory pre-creation check, idempotency keys
11. **Rate Limit Segregation** — AI capped at 60%, human traffic always priority
12. **Training & Access Review** — Mandatory training, quarterly reviews, 90-day inactivity suspension
13. **Incident Response** — Suspend within 1hr, reverse within 4hr, notify per law
14. **Legal Foundation** — Intuit ToS confirmation, EULA, DPA, annual insurance review
15. **Reconciliation Controls** — AI cannot complete bank reconciliation (human-only)
16. **Token Security** — AES-256, IP binding, keychain storage, automatic rotation, kill switch

---

## 10. Risk Register Summary

### Residual Risk After All Controls

| Risk Category | Pre-Control | Post-Control | Residual |
|---------------|-------------|--------------|----------|
| Unauthorized transactions | Critical | Low | Dual auth + SoD + thresholds |
| Data breach (PCI/PII) | Critical | Low | Masking + classification + KMS |
| Financial misstatement | Critical | Medium | Validators + reconciliation (AI error margin remains) |
| Cash loss (payments) | Critical | Low | Disabled default + dual approval + velocity limits |
| Audit trail compromise | High | Low | Immutable external store + hash chain |
| Duplicate transactions | High | Low | Idempotency + duplicate detection |
| Sync data inconsistency | High | Low | CDC truncation detection + webhook hybrid |
| Vendor fraud (BEC) | High | Low | 72hr cooling + out-of-band verification |
| API reliability | Medium | Low | Circuit breaker + retry + rate limiting |
| Period-close corruption | Medium | Low | 5-stage period controller |
| Platform dependency | Medium | Medium | Abstraction layer (no full mitigation) |

---

*Audit completed: 2026-03-29*
*Personas: CPA (20yr), Data Engineer (15yr), CFO (25yr)*
*Total iterations: 30 (10 per persona)*
*Total unique findings: ~70*
*Architecture requirements: 48 (CPA) + 25 (DE) + 16 (CFO governance)*
