# Quick-Fin

MCP server providing AI assistants with governed, auditable access to the complete QuickBooks Online API.

## What It Does

Quick-Fin exposes **244 MCP tools** that let Claude, GPT, or any MCP-compatible AI assistant interact with QuickBooks Online — with financial controls, audit trails, and compliance guardrails built in.

| Category | Tools | Coverage |
|----------|-------|----------|
| Accounting Entities | 176 | 36 entities (Invoice, Bill, Payment, Customer, Vendor, Account, JournalEntry, etc.) with CRUD, void, send, PDF, and query operations |
| Financial Reports | 30 | P&L, Balance Sheet, Cash Flow, Trial Balance, General Ledger, AR/AP Aging, Tax Summary, and more |
| Payments | 10 | Credit card charges, refunds, ACH/eCheck, PCI tokenization (disabled by default, dual-approval required) |
| Infrastructure | 8 | Batch operations, Change Data Capture, SQL-like queries, webhooks, health checks, connect/disconnect |
| Governance | 12 | Approval workflows, audit log queries, chain verification, period management, token status |
| Compliance | 8 | Segregation of duties checks, PCI scans, PII audits, anomaly detection, Benford's law analysis |

## Why It Exists

Connecting AI to financial systems without controls is dangerous. Quick-Fin was designed from a 30-iteration security audit across three expert personas:

- **CPA** (56 findings) — GAAP compliance, internal controls, audit trails, SOX, fraud detection
- **Data Engineer** (25 findings) — API reliability, token races, concurrency, rate limiting, observability
- **CFO** (16 findings) — Payment controls, vendor fraud (BEC), approval workflows, payroll privacy, ROI

The full audit reports are in [`docs/`](docs/). The architecture plan synthesizing all findings is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Quick Start

### Prerequisites

- Node.js 20+
- A QuickBooks Online developer account ([developer.intuit.com](https://developer.intuit.com))
- An OAuth 2.0 app with `com.intuit.quickbooks.accounting` and `com.intuit.quickbooks.payment` scopes

### Install

```bash
git clone https://github.com/Alex-Zeo/quick-fin.git
cd quick-fin
npm install
cp .env.example .env
# Edit .env with your QBO OAuth credentials
```

### Build & Run

```bash
npm run build   # Transpile with esbuild (~100ms)
npm start       # Start MCP server (stdio transport)
```

### Development

```bash
npm run dev     # Watch mode with tsx
npm test        # Run tests with vitest
```

### Connect to Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "quick-fin": {
      "command": "node",
      "args": ["/path/to/quick-fin/dist/server.js"],
      "env": {
        "QBO_CLIENT_ID": "your-client-id",
        "QBO_CLIENT_SECRET": "your-client-secret",
        "QBO_REDIRECT_URI": "http://localhost:3000/callback",
        "QBO_ENVIRONMENT": "sandbox"
      }
    }
  }
}
```

## Architecture

```
MCP Client (Claude, etc.)
    |
    v
[MCP Server] ── 244 tools registered
    |
    v
[Governance Pipeline]
    RBAC ── SoD ── Period Check ── Materiality ── Approval ── Validation ── Idempotency
    |
    v
[HTTP Client Layer]
    Rate Limiter ── Circuit Breaker ── Retry ── Concurrency Semaphore
    |
    v
[QuickBooks Online API]
    Accounting ── Reports ── Payments ── CDC ── Batch ── Webhooks
    |
    v
[Audit Logger]
    SHA-256 Hash Chain ── Local SQLite ── External Immutable Store
```

### Key Design Decisions

**Every mutation goes through a governance pipeline.** Creating an invoice, paying a bill, voiding a check — all pass through RBAC, segregation of duties, period controls, materiality thresholds, and approval workflows before reaching the QBO API.

**Payments are disabled by default.** The CFO audit identified payment execution as the highest-risk capability. Payment tools exist but require explicit enablement and dual approval for every transaction.

**Payroll writes are permanently blocked.** The server can read payroll data (with PII masking) but will never write to payroll endpoints. This is hardcoded, not configurable.

**All money uses `Decimal`.** JavaScript floating-point arithmetic is not suitable for financial calculations. Every monetary value in Quick-Fin uses `decimal.js` with 20-digit precision and banker's rounding.

**Hash-chained audit trail.** Every API operation produces an audit entry linked by SHA-256 hash to the previous entry. The chain is independently verifiable, and integrity can be checked via the `qbo_verify_audit_chain` tool.

## Project Structure

```
src/
  server.ts              # Entry point — registers all 244 MCP tools
  config/                # Zod-validated configuration with sensible defaults
  schemas/entities/      # 36 Zod schemas matching QBO entity shapes
  auth/                  # OAuth 2.0 with encrypted token storage
  audit/                 # Hash-chained immutable audit logger
  client/                # HTTP pool, rate limiter, circuit breaker, retry
  governance/            # RBAC, SoD, approvals, period-close, materiality
  security/              # PCI scanner, PII masker, data classification
  monitoring/            # Anomaly detection, Benford's law, health checks
  sync/                  # CDC polling, reconciliation, webhooks
  validation/            # Pre-submit checks, idempotency, duplicate detection
  tenant/                # Multi-tenant isolation
  tools/                 # MCP tool definitions (accounting, reports, payments, infra, governance)
  utils/                 # Logging, fiscal calendar, batch executor, etc.
docs/
  AUDIT_CPA.md           # Full CPA audit (56 findings, 10 iterations)
  AUDIT_DATA_ENGINEER.md # Full Data Engineer audit (25 findings, 10 iterations)
  AUDIT_CFO.md           # Full CFO audit (16 findings, 10 iterations)
  QUICKBOOKS_API_REFERENCE.md  # Complete QBO API surface area
```

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)):

| Variable | Required | Description |
|----------|----------|-------------|
| `QBO_CLIENT_ID` | Yes | OAuth 2.0 client ID from Intuit Developer |
| `QBO_CLIENT_SECRET` | Yes | OAuth 2.0 client secret |
| `QBO_REDIRECT_URI` | No | Callback URL (default: `http://localhost:3000/callback`) |
| `QBO_ENVIRONMENT` | No | `sandbox` or `production` (default: `sandbox`) |
| `TOKEN_ENCRYPTION_KEY` | Prod | 32-byte hex string for AES-256 token encryption |
| `LOG_LEVEL` | No | pino log level (default: `info`) |
| `WEBHOOK_ENABLED` | No | Enable webhook receiver (default: `false`) |
| `WEBHOOK_VERIFIER_TOKEN` | Cond. | Required if webhooks enabled |

## Security Model

Quick-Fin implements a 5-tier role-based access system:

| Tier | Role | Capabilities |
|------|------|-------------|
| 1 | Viewer | Read entities, run reports |
| 2 | Analyst | Tier 1 + query, CDC, batch reads |
| 3 | Transact | Tier 2 + create/update entities (within approval thresholds) |
| 4 | Controller | Tier 3 + approve operations, manage periods, access PII |
| 5 | Treasury | Tier 4 + payment operations, account modifications |

Additional controls:
- **Segregation of duties** — Conflict matrix prevents same session from e.g. creating a vendor and approving payment to that vendor
- **Materiality thresholds** — Operations above configurable dollar amounts require single or dual approval
- **Period-close enforcement** — 5-stage lifecycle (Open, Soft Close, Hard Close, Filed, Archived) prevents backdating
- **PCI compliance** — Credit card numbers are never stored, logged, or transmitted
- **PII masking** — SSN, bank accounts, compensation masked by default

## License

MIT
