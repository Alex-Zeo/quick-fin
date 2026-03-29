# Quick-Fin

MCP server for comprehensive, governed QuickBooks Online API access.

## Project Structure

- `ARCHITECTURE.md` — Full architecture plan synthesized from 30-iteration multi-persona audit
- `docs/AUDIT_CPA.md` — CPA audit (56 findings across 10 iterations)
- `docs/AUDIT_DATA_ENGINEER.md` — Data Engineer audit (25 findings across 10 iterations)
- `docs/AUDIT_CFO.md` — CFO audit (16 findings across 10 iterations)
- `docs/QUICKBOOKS_API_REFERENCE.md` — Complete QBO API surface area reference
- `src/` — TypeScript source (MCP server)
- `test/` — Tests (unit, integration, contract)

## Tech Stack

- TypeScript (strict mode)
- `@modelcontextprotocol/sdk` — MCP server framework
- `undici` — HTTP client with connection pooling
- `decimal.js` — Financial arithmetic (never use JS `number` for money)
- `zod` — Schema validation for all QBO entities
- `pino` — Structured logging
- `better-sqlite3` — Audit log, idempotency registry
- `cockatiel` — Circuit breakers
- `p-limit` / `p-retry` — Concurrency + retry
- `async-mutex` — Entity-level locking
- `vitest` + `nock` — Testing

## Key Rules

1. ALL monetary values use `Decimal` type — never JavaScript `number`
2. ALL mutations go through the governance pipeline (RBAC -> SoD -> approval -> validation -> idempotency)
3. ALL API calls are audit-logged with hash chain
4. Payments are disabled by default
5. Payroll write access is permanently prohibited
6. Email sending uses draft-and-queue (never direct)
7. PCI data (PANs) is never stored, logged, or transmitted
8. PII fields are masked by default (SSN, bank accounts, compensation)
9. Always use sparse updates (`sparse: true`) to prevent data loss
10. Always include `minorversion=75` on API calls
11. SyncToken is required for all updates — always read-before-write
