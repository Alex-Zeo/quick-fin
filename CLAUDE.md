# Quick-Fin — Claude Code Instructions

This file is for Claude Code. It defines rules, conventions, and constraints for working in this codebase. For human documentation see README.md. For architecture details see ARCHITECTURE.md.

## Build & Run

```bash
npm run build          # esbuild transpile (109ms, all 111 files)
npm run dev            # tsx watch mode
npm start              # node dist/server.js
npm test               # vitest run
npm run typecheck      # tsc --noEmit (requires >8GB RAM due to Zod inference)
```

**TSC OOM on 8GB machines.** Use `npm run build` (esbuild) for compilation. esbuild handles all 111 files in ~100ms. TSC is only for CI on larger machines.

## Inviolable Rules

These are non-negotiable. Every code change must respect all of them.

1. **Money is Decimal.** ALL monetary values use `Decimal` from `decimal.js`. Never use JavaScript `number` for currency, amounts, rates, or totals. Import `QBOMoney` from `src/schemas/money.ts` for Zod schemas.

2. **Governance pipeline for all mutations.** Every create/update/delete/void goes through: RBAC -> SoD check -> Period check -> Materiality threshold -> Approval (if needed) -> Pre-submit validation -> Idempotency check -> Execute -> Audit log. Never bypass this chain.

3. **Audit everything.** Every API call gets a hash-chained audit log entry. The chain is SHA-256, each entry includes the hash of the previous entry. Never skip audit logging, even on errors.

4. **Payments disabled by default.** The `paymentsEnabled` flag must default to `false`. Dual approval is required for any payment operation. Never auto-enable payments.

5. **Payroll writes are permanently prohibited.** The server may read payroll data (masked) but must never write to payroll endpoints. This is a hard block, not a configuration.

6. **PCI: never store/log/transmit PANs.** Credit card numbers must never appear in logs, audit trails, error messages, or any persistent storage. Use tokenized references only.

7. **PII masking by default.** SSN, bank account numbers, compensation data, and other PII are masked unless the requesting user has Tier 4+ access. Field-level masking via `src/security/pii-masker.ts`.

8. **Sparse updates only.** Always set `sparse: true` on update operations to prevent accidentally blanking unspecified fields. Always read-before-write to get the current SyncToken.

9. **minorversion=75 on all API calls.** Every QBO API request must include `?minorversion=75` (or current latest). This is set in the HTTP client, not per-call.

10. **SyncToken required for updates.** QBO uses optimistic concurrency. Every update/delete must include the entity's current SyncToken. Read first, then write.

11. **Draft-and-queue for emails.** Never send emails directly via QBO send endpoints. Always create a draft, queue it for human review, then send on approval.

## Code Conventions

- **TypeScript strict mode.** No `any` unless interfacing with untyped QBO response shapes (use `as any` sparingly, with a comment explaining why).
- **Zod for all external data.** Every QBO API response and every MCP tool input gets validated through a Zod schema. Schemas live in `src/schemas/`.
- **Entity schemas in `src/schemas/entities/`.** One file per QBO entity. Export the schema and inferred type.
- **pino for logging.** Use `createLogger()` / `createChildLogger()` from `src/utils/logger.ts`. Never `console.log` in production code (only `console.error` in `server.ts` for startup messages).
- **Error classification.** All QBO API errors go through `src/client/error-classifier.ts`. Use `QBOError` class with category, retryability, and suggested action.
- **No test mocks for financial logic.** Validation, balance checks, and governance rules must be tested with real values, not mocked away.

## Project Structure

```
src/
  server.ts                    # MCP server entry point (244 tools registered)
  config/                      # Zod-validated configuration
  schemas/
    money.ts                   # Decimal type + arithmetic helpers
    common.ts                  # Shared types (QBORef, Address, etc.)
    entities/                  # 36 entity Zod schemas (one per file)
  auth/                        # OAuth 2.0 flow, token manager, encrypted store
  audit/                       # Hash-chained audit logger, chain verifier, evidence packager
  client/                      # HTTP pool, rate limiter, circuit breaker, retry, concurrency, entity lock
  governance/                  # RBAC, SoD, approval workflow, period controller, materiality, override detector
  security/                    # PCI scanner, PII masker, data classification, KMS adapter
  monitoring/                  # Anomaly scorer, Benford's law, continuous monitor, health check
  sync/                        # CDC manager, reconciliation, webhook processor
  validation/
    pre-submit/                # Account validity, currency guard, JE balance, tax compliance
    idempotency.ts             # Deterministic fingerprinting + crash-safe registry
    duplicate-detection.ts     # Fuzzy duplicate detection
    void-cascade.ts            # Void propagation logic
  tenant/                      # Multi-tenant context + lifecycle manager
  tools/
    accounting/                # Generic CRUD factory for 36 entities (176 tools)
    reports/                   # 30 report tools with auto-chunking
    payments/                  # 10 payment tools (disabled by default)
    infrastructure/            # Batch, CDC, Query, Webhooks, Health, Connect/Disconnect
    governance/                # Approval, audit, period, compliance tools
  utils/                       # Logger, fiscal calendar, shutdown, retention, query/batch executors
docs/
  AUDIT_CPA.md                 # 56 findings across 10 iterations
  AUDIT_DATA_ENGINEER.md       # 25 findings across 10 iterations
  AUDIT_CFO.md                 # 16 findings across 10 iterations
  QUICKBOOKS_API_REFERENCE.md  # Complete QBO API surface area
```

## QBO API Patterns

- **Base URL:** `https://quickbooks.api.intuit.com/v3/company/{realmId}/`
- **Sandbox:** `https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/`
- **Auth header:** `Authorization: Bearer {accessToken}`
- **Content-Type:** `application/json` (accept `application/json`)
- **Query language:** SQL-like — `SELECT * FROM Invoice WHERE TotalAmt > '1000' MAXRESULTS 100 STARTPOSITION 1`
- **CDC:** `GET /cdc?changedSince={ISO8601}&entities=Invoice,Bill,Payment` (max 30-day lookback)
- **Batch:** `POST /batch` with up to 30 operations per request
- **Rate limits:** 500 req/min per realmId (throttle tier), 10 concurrent per realmId

## Adding a New Entity

1. Create `src/schemas/entities/{entity-name}.ts` with Zod schema
2. Export from `src/schemas/entities/index.ts`
3. Add config to `ENTITY_CONFIGS` in `src/tools/accounting/entity-tools.ts`
4. The tool factory auto-generates CRUD tools — no handler code needed
5. Add entity-specific pre-submit validators in `src/validation/pre-submit/` if needed

## Adding a New Report

1. Add config to `REPORT_CONFIGS` in `src/tools/reports/report-tools.ts`
2. The report handler auto-generates the MCP tool — no additional code needed

## Current State

- **244 MCP tools** registered and responding
- **Server entry point** wires stub dependencies — auth, governance, and audit subsystems need integration
- **Next:** Wire real OAuth flow, connect governance pipeline to real RBAC/SoD/approval engines, connect audit logger to SQLite + external store
