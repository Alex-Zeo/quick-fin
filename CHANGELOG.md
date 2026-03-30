# Changelog

All notable changes to Quick-Fin are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - 2026-03-29

### Added

- **MCP Server** — stdio transport, registers 244 tools on startup
- **36 Entity Schemas** — Zod schemas for all QBO accounting entities (Invoice, Bill, Payment, Customer, Vendor, Account, JournalEntry, Estimate, CreditMemo, SalesReceipt, RefundReceipt, Purchase, PurchaseOrder, Deposit, Transfer, VendorCredit, BillPayment, TimeActivity, Employee, Department, Class, Item, TaxCode, TaxRate, TaxAgency, TaxService, Term, PaymentMethod, CompanyInfo, CompanyCurrency, Preferences, ExchangeRate, Budget, Attachable, Entitlements, JournalCode)
- **176 Entity Tools** — auto-generated CRUD, void, send, PDF, query, and deactivate operations for all 36 entities via generic tool factory
- **30 Report Tools** — P&L, Balance Sheet, Cash Flow, Trial Balance, General Ledger, AR/AP Aging, Tax Summary, Budget Overview, and 22 more with auto-chunking for large reports and watermarking
- **10 Payment Tools** — credit card charges, refunds, ACH/eCheck, PCI tokenization, saved payment methods (disabled by default, dual-approval required)
- **8 Infrastructure Tools** — batch operations (30 ops), CDC polling, SQL-like query, webhooks, health check, company connect/disconnect
- **12 Governance Tools** — pending approvals, approve/reject, audit log query, chain verification, period status/transition, token status, fiscal calendar
- **8 Compliance Tools** — SoD conflict check, PCI scan, PII audit, anomaly detection, Benford's analysis, override report, retention check, ToS verification
- **OAuth 2.0 Module** — authorization flow, token manager with write-ahead refresh, coalescing promise pattern, AES-256 encrypted token store
- **Hash-Chained Audit Logger** — SHA-256 linked entries, SQLite storage, chain verifier, evidence packager for external auditors
- **RBAC** — 5-tier role system (Viewer, Analyst, Transact, Controller, Treasury) with operation-level permission checks
- **Segregation of Duties Engine** — conflict matrix blocking incompatible operations within same session/user/window
- **Approval Workflow** — materiality thresholds, single/dual approval paths, escalation timers, TTL, SQLite persistence
- **Period Controller** — 5-stage fiscal period lifecycle (Open, Soft Close, Hard Close, Filed, Archived) with backdating prevention
- **Materiality Engine** — per-entity dollar thresholds, daily velocity limits, cumulative tracking
- **Override Detector** — flags governance bypasses, external notification, override budget tracking
- **HTTP Client** — undici connection pooling, automatic `minorversion=75`, JSON serialization
- **Rate Limiter** — token bucket per realmId (500 req/min), queue with backpressure, bucket cleanup
- **Circuit Breaker** — cockatiel-based, per-operation-category, half-open probing
- **Retry Logic** — exponential backoff with jitter, category-aware (only retries RETRYABLE errors)
- **Concurrency Semaphore** — p-limit based, 10 concurrent per realmId
- **Entity Lock** — async-mutex per entity ID, prevents concurrent writes to same entity
- **Error Classifier** — maps QBO HTTP status + error codes to actionable categories (RETRYABLE, AUTH, VALIDATION, CONFLICT, RATE_LIMIT, NOT_FOUND)
- **PCI Scanner** — regex-based PAN detection in payloads and logs, blocks transmission
- **PII Masker** — 4-tier data classification, field-level masking (SSN, bank accounts, compensation)
- **Data Classification** — TIER_1 (public) through TIER_4 (restricted) with per-entity field mapping
- **KMS Adapter** — pluggable encryption interface for token storage and field-level encryption
- **CDC Manager** — Change Data Capture polling with truncation detection and binary-search window splitting
- **Reconciliation Engine** — cross-references local records against QBO, detects drift
- **Webhook Processor** — HMAC-SHA256 verification, deduplication, entity routing
- **Pre-Submit Validators** — account validity, currency guard, journal entry balance check, tax compliance
- **Idempotency Registry** — deterministic fingerprinting, crash-safe SQLite storage, TTL cleanup
- **Duplicate Detection** — fuzzy matching (counterparty + amount within 5% + date within 30 days)
- **Void Cascade** — propagates void operations to related transactions
- **Anomaly Scorer** — statistical deviation detection on transaction patterns
- **Benford's Law Analyzer** — first-digit distribution analysis for fraud detection
- **Continuous Monitor** — periodic health and anomaly sweeps
- **Health Check** — server uptime, circuit breaker states, connected companies, token freshness
- **Multi-Tenant Isolation** — frozen tenant context, lifecycle manager with LRU eviction
- **Fiscal Calendar** — configurable fiscal year start, quarter/period calculation
- **Shutdown Manager** — graceful drain of in-flight operations on SIGTERM/SIGINT
- **Retention Policy** — 7-year retention for financial/audit/tax records, configurable per record type
- **Query Executor** — auto-pagination, OR clause rewriting for QBO query language
- **Batch Executor** — per-item tracking, retry-failed helper
- **Structured Logging** — pino with ISO timestamps, service/version context, child loggers
- **Build System** — esbuild for fast transpilation (~100ms), TSC for optional type checking
- **30-Iteration Multi-Persona Audit** — CPA (56 findings), Data Engineer (25 findings), CFO (16 findings)

### Architecture Documents

- `ARCHITECTURE.md` — 750-line integrated plan with all controls, thresholds, and roadmap
- `docs/AUDIT_CPA.md` — Full CPA audit findings
- `docs/AUDIT_DATA_ENGINEER.md` — Full Data Engineer audit findings
- `docs/AUDIT_CFO.md` — Full CFO audit findings
- `docs/QUICKBOOKS_API_REFERENCE.md` — Complete QBO API surface area reference

### Known Limitations

- TSC runs out of memory on 8GB machines due to Zod type inference across 111 files. Build uses esbuild; type checking requires 16GB+ RAM.
- Server entry point uses stub dependencies for auth, governance, and audit. Subsystem implementations exist but are not yet wired to the server.
- No test suite yet (vitest configured but no test files written).
- OAuth callback server not implemented — manual token exchange required for initial setup.
