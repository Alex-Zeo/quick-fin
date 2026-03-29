

# DATA ENGINEER AUDIT — FINAL FINDINGS

I'll work through all 10 iterations systematically, then produce the consolidated synthesis. Let me reason through each layer carefully.

---

## ITERATION 1: Core Reliability, Error Handling, Data Consistency

**1.1 — SyncToken Stale-Write Problem.** Every QBO update requires the current SyncToken. If an AI assistant reads an entity, deliberates, then writes back, the SyncToken may be stale. A naive retry-on-failure approach will silently re-read and overwrite intervening changes — a classic lost-update problem. **Fix:** Implement a read-before-write wrapper that compares the SyncToken at write time against the one from the original read. If they diverge, surface the conflict to the caller with both versions rather than auto-merging.

**1.2 — No Idempotency Keys on Mutating Operations.** QBO's API does not provide native idempotency keys. If a network timeout occurs after the server processes a POST but before the client receives the 200, a retry creates a duplicate Invoice/Payment. **Fix:** Implement client-side idempotency via a local write-ahead log keyed by a deterministic hash of (operation, entity type, key fields). Before retrying, query QBO to check if the entity was created (e.g., by DocNumber for invoices, TxnDate+amount+reference for payments).

**1.3 — Exponential Backoff Without Jitter Creates Thundering Herd.** If multiple MCP tool calls hit a 429 simultaneously and all use the same exponential backoff schedule, they'll all retry at the same instant. **Fix:** Use decorrelated jitter: `sleep = min(cap, random_between(base, sleep * 3))` per the AWS architecture blog pattern. Library: `p-retry` with custom backoff function.

**1.4 — Batch Operation Partial Failure Ambiguity.** QBO batch endpoint returns individual results per operation — some may succeed while others fail. If the MCP tool reports only "batch failed," the AI assistant has no way to know which items succeeded and may retry everything, creating duplicates. **Fix:** Parse batch responses per-operation. Return structured results with per-item status. Never auto-retry a batch — return the partial results and let the caller decide.

**1.5 — OAuth Refresh Token Single Point of Failure.** Refresh tokens are one-time-use in QBO. If a refresh succeeds but the new token fails to persist (crash, disk error), the old token is revoked and the new one is lost. The entire connection is bricked until the user re-authorizes. **Fix:** Write-ahead logging for token refresh: persist the new token BEFORE returning it to the HTTP layer. Use atomic file writes (write to temp, fsync, rename) or a transactional store.

**1.6 — Missing Circuit Breaker.** If QBO is experiencing a partial outage (e.g., the Reports API is down but CRUD works), the server will keep sending requests, burning rate limit budget on guaranteed failures. **Fix:** Per-endpoint-group circuit breaker (accounting CRUD, reports, payments, payroll) using a sliding window. States: closed → open (after N failures in window) → half-open (probe with single request). Library: `cockatiel` (TypeScript, supports circuit breakers + retries + bulkheads).

**1.7 — No Request Timeout Enforcement.** QBO report generation can take 30+ seconds. Without client-side timeouts, an MCP tool call can hang indefinitely, blocking the AI session. **Fix:** Enforce per-request-type timeouts: 10s for CRUD, 30s for reports, 60s for batch. Use `AbortController` with `setTimeout`.

---

## ITERATION 2: Conflict Resolution, Race Conditions, Batch Failures, CDC Gaps

**2.1 — SyncToken Conflict Resolution Strategy.** Iteration 1 said "surface the conflict." But what does the resolution look like? The AI assistant can't merge accounting data safely — a wrong merge corrupts books. **Fix:** Three-tier strategy: (a) For amount/financial fields: NEVER auto-merge, always surface conflict with field-level diff. (b) For metadata fields (memo, description): allow last-write-wins with audit log. (c) For status fields (void, email-sent): these are monotonic — apply if the transition is valid. Implement as a `ConflictResolver` class with per-field-type strategies.

**2.2 — Concurrent MCP Tool Calls on Same Entity.** Two tool calls could read the same Invoice (both get SyncToken=3), then both try to update. The first succeeds (SyncToken becomes 4), the second fails with a stale token. If the second retries by re-reading, it might overwrite the first update. **Fix:** Per-entity mutex using an in-memory lock map keyed by `(entityType, entityId)`. Use `async-mutex` library. Lock is acquired before read, held through write, released after. Timeout the lock acquisition (5s) to prevent deadlocks. This is critical because AI assistants often issue parallel tool calls.

**2.3 — Batch Operation: Cross-Item Dependencies.** QBO batch is serial but doesn't support cross-references (e.g., create Customer then create Invoice referencing that Customer in the same batch). If someone builds a batch with implicit dependencies, it will fail with a cryptic reference error. **Fix:** Implement a dependency analyzer that inspects batch operations for entity references. If cross-references are detected, split into ordered sub-batches with an explicit dependency chain. Alternatively, reject the batch with a clear error explaining why.

**2.4 — Batch Partial Success + Retry Creates Duplicates.** If batch items 1-15 succeed and 16-30 fail, and the caller retries the full batch, items 1-15 are duplicated. **Fix:** The batch executor must return a structured result with per-item status and the original request index. Provide a `retryFailedOnly(batchResult)` helper that constructs a new batch containing only the failed items with their original ordering context.

**2.5 — CDC Gap Detection.** CDC has a 30-day lookback and 1000-object-per-entity limit. If >1000 invoices change in the polling interval, the response is silently truncated — there's no "more data available" indicator. **Fix:** After each CDC poll, for each entity type, if the returned count equals exactly 1000, assume truncation. Narrow the time window and re-poll. Maintain a high-water mark per entity type. Additionally, periodically (daily) do a full-count query per entity type and compare against CDC-tracked state to detect drift.

**2.6 — CDC + Delete Detection.** CDC returns deleted entities, but only within the 30-day window. If the server is offline for >30 days, deletions are silently missed. **Fix:** Implement a "full reconciliation" mode that does a complete entity listing and compares against local state. Run this on startup if the last CDC poll was >25 days ago (giving 5-day safety margin). Flag this as a critical operational alert.

---

## ITERATION 3: Rate Limits, Token Refresh Races, Connection Pooling, Request Queuing

**3.1 — Multi-Session Rate Limit Exhaustion.** Rate limit is 500 req/min per realmId, not per OAuth token. If multiple AI sessions connect to the same QBO company, they share this budget invisibly. One aggressive session can starve others. **Fix:** Centralized rate limiter per realmId using a token bucket algorithm. All sessions for the same realmId must go through the same bucket. Use an in-process shared `Map<realmId, TokenBucket>`. For multi-process deployments, use Redis with `ioredis` and a Lua script for atomic token acquisition. Pre-allocate fair-share quotas per session (e.g., 500/N where N = active sessions).

**3.2 — Token Refresh Race Condition.** Two concurrent tool calls detect an expired token simultaneously. Both attempt to refresh. The first succeeds and invalidates the old refresh token. The second sends the now-invalid old refresh token and gets an error. If not handled, this bricks the connection. **Fix:** Implement a refresh lock per realmId. The first caller acquires the lock, refreshes, stores the new tokens, and releases the lock. All other callers await the lock and then use the already-refreshed token. Pattern:

```typescript
class TokenManager {
  private refreshPromise: Map<string, Promise<TokenPair>> = new Map();
  
  async getValidToken(realmId: string): Promise<string> {
    const token = await this.store.get(realmId);
    if (!this.isExpired(token)) return token.accessToken;
    
    if (!this.refreshPromise.has(realmId)) {
      this.refreshPromise.set(realmId, this.doRefresh(realmId).finally(() => {
        this.refreshPromise.delete(realmId);
      }));
    }
    const newToken = await this.refreshPromise.get(realmId)!;
    return newToken.accessToken;
  }
}
```

This is the "coalescing promise" pattern — only one refresh in-flight per realm.

**3.3 — No Request Priority Queue.** All requests are equal, but they shouldn't be. A Payment write is more important than a report query. If rate limits are tight, low-priority requests can block critical writes. **Fix:** Implement a priority queue with at least 3 tiers: P0 (writes/mutations), P1 (reads for active operations), P2 (reports/bulk queries/CDC). Use `@datastructures-js/priority-queue`. Dequeue based on priority when a rate limit token becomes available.

**3.4 — Connection Pooling Absent.** Each API call creating a new HTTP connection adds ~50-100ms TLS handshake overhead. Over hundreds of calls this compounds. **Fix:** Use a persistent HTTP agent with connection pooling. Node.js `undici` (now built into Node 18+) provides this natively with its `Pool` class. Configure: `connections: 10` (matching the 10-concurrent-request QBO limit), `pipelining: 1`, `keepAliveTimeout: 60000`.

**3.5 — 10-Concurrent-Request Limit Not Enforced Client-Side.** QBO allows max 10 concurrent requests. Without client-side enforcement, the 11th request gets a 429, wastes rate budget, and triggers retry logic unnecessarily. **Fix:** Use a concurrency semaphore (`p-limit` with limit=10) wrapping all QBO HTTP calls. This is separate from and complementary to the rate limiter.

**3.6 — Rate Limit Response Header Parsing.** QBO returns `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers. Ignoring these and relying only on client-side counting leads to drift. **Fix:** Implement adaptive rate limiting that uses server-reported remaining budget to calibrate the client-side token bucket. On each response, update the bucket's token count to `min(clientCount, serverReported)`.

---

## ITERATION 4: Query Performance, Report Limits, CDC Pagination

**4.1 — STARTPOSITION Deep Pagination is O(n²).** QBO's STARTPOSITION is offset-based, not cursor-based. Querying page 100 (STARTPOSITION 99001) requires QBO to skip 99000 rows internally. This gets progressively slower and may timeout. **Fix:** Use time-based pagination instead of offset-based where possible. Query with `WHERE MetaData.LastUpdatedTime > 'X' ORDER BY MetaData.LastUpdatedTime MAXRESULTS 1000`, then use the last item's timestamp as the next cursor. Handle ties (multiple items with same timestamp) by also filtering on Id > lastId. This converts O(n²) pagination to O(n).

**4.2 — Report 400K Cell Limit is Undiscoverable Until Failure.** There's no way to know a report will exceed 400K cells before requesting it. A P&L by Customer with 500 customers × 12 months × 80 accounts = 480K cells will fail. **Fix:** Implement pre-flight estimation: estimate cell count as `rows × columns × time_periods`. If estimated count exceeds 300K (75% threshold), automatically split the report by date range or by dimension (e.g., customer batches). Implement a `ReportChunker` that splits along the most selective dimension.

**4.3 — Report Caching Strategy.** Reports are expensive (slow, heavy on rate limits). But they're also point-in-time — if an invoice is created between two report pulls, the second pull gives different results. Naive caching serves stale data. **Fix:** Cache reports with a short TTL (5 min) AND invalidate on any write operation to relevant entity types. Tag cache entries by entity types they depend on (e.g., P&L depends on Invoice, Bill, Payment, JournalEntry). Use `lru-cache` with TTL and manual invalidation hooks.

**4.4 — CDC 1000-Object Pagination.** When >1000 entities change in a CDC window, the result is truncated at 1000. But there's no `nextPage` token. **Fix:** Binary search on the time window. If a CDC poll for `[T1, T2]` returns exactly 1000 results for any entity type, split the window: poll `[T1, Tmid]` and `[Tmid, T2]`. Recurse until each sub-window returns <1000. Merge results, deduplicate by entity Id (taking the latest version).

**4.5 — Query Timeout Without Partial Results.** If a query times out, no partial results are returned. The caller gets nothing. **Fix:** Implement speculative narrowing: if a broad query times out, automatically narrow it by adding time-range constraints or reducing MAXRESULTS. Log the timeout and adjusted parameters. Return partial results with a `hasMore: true` flag and a continuation token that encodes the remaining query parameters.

**4.6 — No OR Operator Workaround.** QBO's query language doesn't support OR. Callers will try `WHERE Status = 'Open' OR Status = 'Overdue'` and get a parse error. **Fix:** Implement a query parser/rewriter that detects OR conditions and automatically splits them into parallel queries with result merging and deduplication. Use the IN operator where available (it works for some fields like Id).

---

## ITERATION 5: Webhook Reliability, Idempotency, CDC+Webhook Hybrid

**5.1 — Webhook 3-Second Response Timeout.** QBO expects a 200 response within 3 seconds or it considers delivery failed. If the handler does any synchronous processing (DB write, API callback), it risks timeout. **Fix:** Immediately return 200 upon HMAC validation, then process asynchronously. Pattern: write the raw webhook payload to a durable queue (in-memory `BullMQ` with Redis, or an append-only file for single-process), then process from the queue with independent workers.

**5.2 — Webhook Deduplication.** QBO webhooks are "best-effort" and may deliver the same event multiple times. Processing a "Payment created" webhook twice could trigger duplicate downstream actions. **Fix:** Maintain a deduplication set keyed by `(realmId, entityType, entityId, operation, lastUpdated)`. Use a time-windowed set (keep entries for 24h) to bound memory. Check before processing; skip duplicates.

**5.3 — Webhook Ordering Not Guaranteed.** Events may arrive out of order. An "Invoice updated" event for version 5 might arrive before version 4. Processing version 4 after version 5 would regress state. **Fix:** On webhook receipt, always fetch the current entity state from the API rather than trusting the webhook payload. The webhook is a notification trigger, not a data source. This is the "event-carried state transfer" pattern inverted — treat webhooks as "something changed" signals.

**5.4 — Missed Webhook Recovery.** Webhooks can be lost (QBO outage, network blip, server downtime). There's no replay API. **Fix:** Implement a CDC-based reconciliation loop that runs every 5 minutes. Compare the last-known state (from webhooks) against CDC results. Any entity in CDC but not in recent webhook log represents a missed event. This is the "webhook + CDC hybrid" pattern — webhooks for low-latency, CDC for completeness.

**5.5 — HMAC Validation Timing Attack.** Comparing HMAC signatures with `===` is vulnerable to timing attacks. An attacker could probe byte-by-byte. **Fix:** Use `crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(received))` for constant-time comparison. This is a standard security practice.

**5.6 — Webhook Server Exposes Attack Surface.** The optional HTTP server for webhooks opens a network port. If not properly secured, it's an entry point. **Fix:** (a) Bind only to localhost if behind a reverse proxy. (b) Validate HMAC on every request — reject before any processing. (c) Enforce IP allowlisting if QBO publishes webhook source IPs. (d) Rate-limit inbound webhook requests to prevent DoS. (e) Never log raw webhook payloads (may contain PII/financial data).

---

## ITERATION 6: Type Safety, Schema Validation, Response Normalization

**6.1 — QBO Responses Are Loosely Typed.** The same field can be a string, number, or absent depending on entity state and minor version. For example, `Invoice.Balance` might be `"0"` (string), `0` (number), or absent (fully paid). AI assistants consuming this will make wrong assumptions. **Fix:** Define strict Zod schemas for every entity type that coerce and normalize. Example:

```typescript
const MoneyAmount = z.union([z.number(), z.string().transform(Number)]).pipe(z.number());

const InvoiceSchema = z.object({
  Id: z.string(),
  SyncToken: z.string(),
  Balance: MoneyAmount.default(0),
  TotalAmt: MoneyAmount,
  // ... 40+ fields
});
```

Use `.passthrough()` on the top level to preserve unknown fields from newer minor versions.

**6.2 — Minor Version Field Drift.** Fields added in minor version 65 won't exist if querying with version 40. Fields deprecated in version 70 will error if used with version 75. **Fix:** Pin to a specific minor version (75+) in ALL requests. Validate responses against version-specific schemas. Do NOT use `.passthrough()` for fields that are version-dependent — maintain a version→schema map for any fields that changed behavior.

**6.3 — Null vs Missing vs Empty String.** QBO uses all three inconsistently. `Customer.CompanyName` can be `null`, `undefined`, or `""`. **Fix:** Normalize in the Zod schema layer: treat null and empty string as undefined for optional fields, and reject null/empty for required fields. Provide a `normalizeEntity<T>(raw: unknown, schema: ZodType<T>): T` wrapper that all API responses pass through.

**6.4 — Reference Types Inconsistency.** QBO reference fields (`CustomerRef`, `ItemRef`) are `{ value: string, name?: string }` but sometimes `value` is a number (not string), and `name` is sometimes omitted even when the entity exists. **Fix:** Define a `QBORef` Zod type that coerces `value` to string always, and makes `name` truly optional. Never rely on `name` being present — always resolve via a separate read if the display name is needed.

**6.5 — Date Format Inconsistency.** QBO uses `YYYY-MM-DD` for dates and `YYYY-MM-DDTHH:mm:ss-07:00` for datetimes, but some fields inconsistently include or omit timezone offsets. **Fix:** Define `QBODate` and `QBODateTime` Zod types that parse multiple formats and normalize to ISO 8601. Use `dayjs` with timezone plugin for parsing.

**6.6 — Decimal Precision for Financial Data.** JavaScript floating-point arithmetic is dangerous for financial calculations. `0.1 + 0.2 !== 0.3`. If the MCP server does any arithmetic on amounts, it will produce rounding errors. **Fix:** All monetary amounts should be represented as strings internally and only parsed to numbers at the display layer. For any arithmetic, use `decimal.js` or `big.js`. The Zod schema should store amounts as `Decimal` instances, not `number`.

---

## ITERATION 7: Observability, Debugging, Health Checks

**7.1 — No Structured Logging.** Console.log statements provide no queryable structure. Debugging production issues requires grep. **Fix:** Use `pino` for structured JSON logging. Every log entry must include: `realmId`, `requestId` (UUID per MCP tool call), `operation`, `entityType`, `entityId`, `durationMs`, `statusCode`. For errors, include: `errorCode`, `errorMessage`, `retryCount`, `qboRequestId` (from response headers).

**7.2 — No Request Tracing Across MCP Tool → QBO API.** When an MCP tool call triggers 5 QBO API calls (read, validate, write, re-read, webhook notify), there's no way to correlate them. **Fix:** Generate a `traceId` at MCP tool call entry. Propagate it through all QBO HTTP calls via a custom `X-Trace-Id` header (QBO ignores unknown headers). Include `traceId` in all log entries. Optionally emit OpenTelemetry spans for each QBO call within the MCP tool span.

**7.3 — No API Usage Metrics.** Without metrics, you can't answer: "How many API calls per minute?", "What's the P99 latency?", "Which entity types are most called?", "Are we approaching rate limits?" **Fix:** Implement in-process metrics using `prom-client`. Key metrics: `qbo_requests_total` (counter, labels: method, entity_type, status_code), `qbo_request_duration_seconds` (histogram), `qbo_rate_limit_remaining` (gauge), `qbo_token_refresh_total` (counter), `qbo_sync_token_conflicts_total` (counter). Expose `/metrics` endpoint for Prometheus scraping.

**7.4 — No Error Classification.** All QBO errors are treated equally. But a 401 (auth expired) requires a different response than a 5000 (internal server error) or a 6240 (duplicate document number). **Fix:** Build an error taxonomy:
- **Retryable**: 429, 500, 502, 503, 504, ETIMEDOUT, ECONNRESET
- **Auth**: 401, 403 → trigger token refresh, then retry once
- **Client error**: 400 (validation), 6000-series (business rule) → surface to caller, never retry
- **Conflict**: SyncToken mismatch → trigger conflict resolution flow
Map each to a specific recovery action in a `ErrorClassifier` class.

**7.5 — No Health Check Endpoint.** No way to know if the server is healthy, tokens are valid, rate limits are available. **Fix:** Implement `/health` with three probes: (a) `liveness` — process is running, (b) `readiness` — at least one realmId has valid tokens, (c) `qbo_connectivity` — last successful QBO API call was within 5 minutes. Return structured JSON with per-realm status.

**7.6 — No Audit Trail for Mutations.** When an AI assistant creates an Invoice, there's no record of what tool call triggered it, what parameters were used, or who approved it. This is critical for financial systems. **Fix:** Maintain a local append-only audit log for all mutating operations. Each entry: timestamp, traceId, toolName, realmId, entityType, entityId, operation (create/update/delete/void), requestPayload (sanitized), responseStatus, syncTokenBefore, syncTokenAfter. Store in SQLite (`better-sqlite3`) for queryability. Retention: 90 days minimum.

---

## ITERATION 8: Multi-Tenant Architecture

**8.1 — Token Isolation Between Tenants.** If tokens for multiple QBO companies are stored in a flat structure, a bug could use Company A's token to access Company B's data. QBO will reject it (token is realm-scoped), but the error burns rate limit and may trigger security flags. **Fix:** Key all token storage by `realmId`. Implement a `TenantContext` class that is created per-request and carries `realmId` — all downstream calls use it. Never pass `realmId` as a loose parameter; always use the context object. Add a validation layer that asserts the realmId in the token matches the target realmId.

**8.2 — Rate Limit Isolation.** Per Iteration 3, rate limits are per-realmId. But without tenant-aware rate limiting, a high-traffic tenant can exhaust shared rate limit infrastructure. **Fix:** The token bucket from 3.1 MUST be per-realmId. Verify this is enforced by having the `TenantContext` own its rate limiter instance. Lazy-initialize: create the bucket on first request for a new realmId, remove it after 30 minutes of inactivity.

**8.3 — Data Leakage in Caching.** If the report cache from 4.3 is not tenant-isolated, a cached P&L for Company A could be served to Company B if the cache key doesn't include realmId. **Fix:** All cache keys MUST be prefixed with `realmId:`. Enforce this at the cache layer — the `CacheManager` constructor requires a `realmId` and automatically prefixes all keys. Make it impossible to create a cache key without a realm prefix by construction, not convention.

**8.4 — Connection Pool Cross-Contamination.** HTTP connections are authenticated via OAuth tokens in headers. If connection pooling reuses a connection, the previous tenant's auth header might linger (depending on HTTP client implementation). **Fix:** Use a per-realmId HTTP agent/pool. Since QBO's base URL is the same for all realms (just the realmId is in the path), the connection pool could reuse connections. Ensure auth headers are set per-request, never at the pool level. Verify with integration tests.

**8.5 — Tenant Lifecycle: Disconnect and Cleanup.** When a user disconnects their QBO company, all state (tokens, caches, rate limiters, CDC cursors, webhook subscriptions) must be purged. Incomplete cleanup leaks memory and creates ghost state. **Fix:** Implement a `TenantLifecycleManager` with `connect(realmId)` and `disconnect(realmId)` methods. `disconnect` calls cleanup on every subsystem: token store, cache, rate limiter, CDC state, webhook subscriptions (via QBO API), audit log archival. Use a registry pattern so subsystems self-register for cleanup.

**8.6 — Concurrent Tenant Limit.** Each connected tenant consumes memory (token bucket, cache, CDC state, connection pool). Without a limit, a SaaS deployment could OOM. **Fix:** Enforce a configurable `MAX_CONNECTED_TENANTS` limit (default: 50). Implement LRU eviction for inactive tenants: if a tenant hasn't made a request in 30 minutes and the limit is reached, disconnect the least-recently-used tenant. On next request, they'll be re-initialized (tokens loaded from persistent store, caches cold).

---

## ITERATION 9: Deployment, Operational Concerns, Testing

**9.1 — Graceful Shutdown During In-Flight Requests.** If the server receives SIGTERM while a batch write is in-flight, a hard shutdown leaves the operation in an unknown state. Some batch items may have been written, others not. **Fix:** Implement graceful shutdown: (a) Stop accepting new MCP tool calls. (b) Wait for in-flight requests to complete (with a 30-second hard timeout). (c) Persist all state (CDC cursors, rate limit counters, pending webhook queue). (d) On startup, check for incomplete operations and reconcile. Use `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)`.

**9.2 — Secret Rotation for OAuth Client Credentials.** If the QBO app's client_secret is compromised, rotating it requires updating the running server. Without a rotation mechanism, this requires downtime. **Fix:** Load client credentials from environment variables, not config files. Support hot-reload via SIGHUP signal that re-reads environment/secret store. For production: integrate with a secrets manager (AWS Secrets Manager, HashiCorp Vault) via `@aws-sdk/client-secrets-manager` or `node-vault`. Cache secrets in memory with a 1-hour TTL.

**9.3 — QBO Sandbox Limitations Make Testing Hard.** QBO sandbox has different behavior from production: rate limits are more lenient, some endpoints return different data shapes, webhook delivery is unreliable. **Fix:** Three-tier testing strategy: (a) **Unit tests**: Mock QBO responses using recorded fixtures (`nock` library). Test all error paths, retry logic, conflict resolution. (b) **Integration tests**: Run against QBO sandbox for happy-path CRUD. Accept that edge cases won't match prod. (c) **Contract tests**: Record real production responses (sanitized), replay them in CI to catch schema drift. Use `jest` + `nock` + a custom `QBOFixtureRecorder`.

**9.4 — SDK/Dependency Version Pinning.** `@modelcontextprotocol/sdk` is pre-1.0 and has breaking changes between minor versions. If `npm update` pulls a breaking change, the server fails in production. **Fix:** Use exact version pinning in `package.json` (no `^` or `~`). Use `npm ci` (not `npm install`) in CI/CD. Run `npm audit` weekly. Pin Node.js version in `.nvmrc` and `engines` field. Use Dependabot with manual merge for security patches only.

**9.5 — Configuration Management.** Hard-coded values (rate limits, timeouts, retry counts, CDC intervals) make it impossible to tune without redeployment. **Fix:** Externalize all tunable parameters into a configuration schema validated by Zod at startup. Load from (in priority order): environment variables → `.env` file → `config.json` → defaults. Use `dotenv` + a custom `ConfigManager`. Fail fast on startup if required config is missing or invalid.

**9.6 — No Canary Deployment Path.** A bad deployment breaks all tenants simultaneously. **Fix:** Implement feature flags for new functionality. Use a simple in-process feature flag system (config-driven, no external dependency): `config.features.useNewBatchProcessor: boolean`. Route a percentage of traffic through new code paths. Monitor error rates. This is lightweight but effective for an MCP server.

---

## ITERATION 10: FINAL SYNTHESIS

Below is the consolidated, severity-ranked output.

---

# DATA ENGINEER AUDIT — FINAL FINDINGS

## CRITICAL

**[C-1] OAuth Refresh Token Loss Bricks Connection (from 1.5)**
- Problem: Refresh tokens are single-use. If refresh succeeds on QBO's side but the new token fails to persist locally (crash, I/O error), both old and new tokens are lost. The user must manually re-authorize.
- Impact: Complete loss of API access for the affected tenant until manual intervention. In a SaaS context, this means customer downtime.
- Fix: Write-ahead logging for token refresh. Persist the new token atomically BEFORE using it.
- Implementation: Use atomic file writes (`write → fsync → rename`) or a transactional database (SQLite with WAL mode via `better-sqlite3`). The refresh flow: (1) acquire refresh lock, (2) call QBO token endpoint, (3) write new tokens to durable store with fsync, (4) update in-memory cache, (5) release lock. If step 3 fails, log the new tokens to a recovery file and alert. On startup, check for recovery files.

**[C-2] Token Refresh Race Condition (from 3.2)**
- Problem: Multiple concurrent tool calls detect an expired access token and all attempt to refresh simultaneously. Only the first succeeds; subsequent calls send an already-invalidated refresh token.
- Impact: Connection bricked (same as C-1), but triggered by normal concurrent usage rather than a crash.
- Fix: Coalescing promise pattern — only one refresh in-flight per realmId.
- Implementation: `TokenManager` class with a `Map<realmId, Promise<TokenPair>>`. First caller creates the promise; all subsequent callers await the same promise. Promise is removed from the map in `.finally()`. Combined with C-1's durable persistence.

**[C-3] No Idempotency on Mutating Operations (from 1.2)**
- Problem: Network timeouts after server-side processing cause retries that create duplicate Invoices, Payments, Bills — corrupting financial records.
- Impact: Duplicate financial transactions. In accounting, this directly affects tax filings, bank reconciliations, and financial statements. Extremely expensive to detect and fix.
- Fix: Client-side idempotency via deterministic operation fingerprinting.
- Implementation: Before any mutating call, compute a fingerprint: `sha256(operationType + entityType + JSON.stringify(sortedKeyFields))`. Store in a `Map<fingerprint, {status, entityId, timestamp}>` with 1-hour TTL. Before executing, check the map — if a matching fingerprint exists and succeeded, return the cached result. For in-flight operations, await the existing promise. Persist the idempotency map to disk periodically for crash recovery.

**[C-4] Decimal Precision Loss on Financial Amounts (from 6.6)**
- Problem: JavaScript's `number` type (IEEE 754 double) cannot exactly represent many decimal values. `0.1 + 0.2 = 0.30000000000000004`. Any arithmetic on invoice amounts, tax calculations, or payment allocations will produce rounding errors.
- Impact: Financial calculations are wrong. Pennies-off errors compound across thousands of transactions. Fails bank reconciliation. May violate accounting standards.
- Fix: Represent all monetary amounts as string or Decimal internally. Use `decimal.js` for any arithmetic.
- Implementation: Define `QBOMoney = z.union([z.string(), z.number()]).transform(v => new Decimal(String(v)))`. All internal calculations use `Decimal.add()`, `Decimal.mul()`, etc. Only convert to `number` at the final API serialization layer, and only after rounding to 2 decimal places with `Decimal.toFixed(2)`.

**[C-5] No Audit Trail for AI-Initiated Financial Mutations (from 7.6)**
- Problem: An AI assistant can create invoices, process payments, void transactions — with no record of what triggered it, what parameters were used, or what the AI's reasoning was. This is a compliance and auditability disaster.
- Impact: Fails SOX compliance, makes fraud investigation impossible, no ability to reconstruct what happened or why. Financial auditors will flag this immediately.
- Fix: Append-only local audit log for all mutating operations.
- Implementation: SQLite database (`better-sqlite3`) with table: `audit_log(id, timestamp, trace_id, tool_name, realm_id, entity_type, entity_id, operation, request_payload_hash, request_payload_encrypted, response_status, sync_token_before, sync_token_after, ai_session_id)`. Encrypt `request_payload` with AES-256-GCM (key from config) since it contains financial data. Write BEFORE returning the MCP tool response (synchronous insert — SQLite WAL mode is fast enough). 90-day retention minimum, with archival to cold storage.

## HIGH

**[H-1] Concurrent Tool Calls on Same Entity Cause Lost Updates (from 2.2)**
- Problem: Two parallel MCP tool calls reading and updating the same Invoice will cause one to fail (SyncToken mismatch) or worse, one to silently overwrite the other's changes.
- Impact: Data loss — the first update is silently overwritten by the second.
- Fix: Per-entity mutex with timeout.
- Implementation: `EntityLockManager` using `async-mutex`. Lock key: `${entityType}:${entityId}`. Acquisition timeout: 5 seconds. The lock is acquired before the read and held through the write. On timeout, return an error explaining that the entity is being modified by another operation. Include the `traceId` of the holding operation in the error message.

**[H-2] Batch Partial Success Creates Duplicates on Retry (from 1.4, 2.4)**
- Problem: A batch of 30 operations where items 1-15 succeed and 16-30 fail. A naive retry re-sends all 30, duplicating items 1-15.
- Impact: Duplicate financial records (invoices, bills, payments).
- Fix: Per-item result tracking with retry-failed-only helper.
- Implementation: `BatchExecutor.execute()` returns `BatchResult { items: Array<{index, status: 'success'|'error', entity?, error?}> }`. Provide `BatchExecutor.retryFailed(previousResult)` that constructs a new batch with only failed items. The MCP tool response includes the per-item breakdown so the AI assistant can make informed decisions.

**[H-3] CDC Silent Truncation at 1000 Objects (from 2.5, 4.4)**
- Problem: CDC returns max 1000 entities per type. If more changed in the polling window, the excess is silently dropped. No pagination token, no "more available" indicator.
- Impact: Missing changes — the sync state diverges from QBO reality without any error signal.
- Fix: Detect truncation and binary-search the time window.
- Implementation: After each CDC poll, for each entity type where `count === 1000`: split `[startTime, endTime]` at midpoint, re-poll both halves, recurse until all sub-windows return <1000. Deduplicate by `(entityType, entityId)` keeping the latest `MetaData.LastUpdatedTime`. Log when truncation is detected with the entity type and original window size.

**[H-4] Missing Circuit Breaker (from 1.6)**
- Problem: During a QBO partial outage (e.g., Reports API down, CRUD working), the server sends requests to the failing endpoint, wastes rate limit budget, and increases latency for all operations.
- Impact: Cascade failure — a single endpoint's outage degrades all operations via rate limit exhaustion.
- Fix: Per-endpoint-group circuit breaker.
- Implementation: Use `cockatiel` library. Define 4 circuit breaker groups: `accounting-crud`, `reports`, `payments`, `payroll`. Configuration: open after 5 failures in 60 seconds, half-open after 30 seconds, close after 2 successes. When open, immediately return a descriptive error ("QBO Reports API is currently experiencing issues, circuit breaker open — try again in ~30s") instead of sending the request.

**[H-5] Multi-Session Rate Limit Starvation (from 3.1, 3.3)**
- Problem: 500 req/min is shared across all sessions for the same realmId. One aggressive AI session can exhaust the budget, starving others.
- Impact: Unpredictable failures for some sessions, no fairness guarantee.
- Fix: Centralized per-realmId token bucket with fair-share allocation and priority queue.
- Implementation: `RateLimiter` class with a `TokenBucket` per realmId (500 tokens, refill 500/min). Wrap with a `PriorityQueue` (P0=mutations, P1=active reads, P2=bulk/reports). Fair-share: each session gets `floor(500/activeSessions)` guaranteed tokens, remaining tokens are first-come-first-served. Use `@datastructures-js/priority-queue`.

**[H-6] No Concurrency Limit Enforcement (from 3.5)**
- Problem: QBO allows max 10 concurrent requests. Without client-side enforcement, the 11th request gets 429, wastes rate budget, and triggers unnecessary retries.
- Impact: Wasted API budget, increased latency, unnecessary retry storms.
- Fix: Concurrency semaphore.
- Implementation: `p-limit(10)` wrapping all outbound QBO HTTP calls. This is a separate layer from rate limiting (rate = requests/time, concurrency = requests/simultaneously). Both must be enforced.

**[H-7] Webhook Reliability Gaps (from 5.1, 5.2, 5.3, 5.4)**
- Problem: Multiple interrelated issues — 3-second timeout forces async processing, duplicate delivery requires deduplication, out-of-order delivery requires state fetching, missed webhooks require CDC backfill.
- Impact: Inconsistent sync state, duplicate processing, missed events.
- Fix: Webhook + CDC hybrid architecture.
- Implementation: (a) Return 200 immediately after HMAC validation; enqueue to `BullMQ` (Redis-backed). (b) Worker deduplicates by `(realmId, entityType, entityId, lastUpdated)` using a Redis SET with 24h TTL. (c) Worker fetches current entity state from QBO API (don't trust webhook payload). (d) CDC reconciliation loop every 5 minutes compares webhook-processed entities against CDC results. (e) On missed webhooks detected, re-fetch and process.

**[H-8] Data Leakage Between Tenants in Caching/State (from 8.1, 8.3)**
- Problem: If cache keys, rate limiters, or state stores don't enforce tenant isolation by construction, a bug can leak data between QBO companies.
- Impact: Company A sees Company B's financial data. Catastrophic for trust and compliance.
- Fix: Tenant-scoped context object that is required by construction.
- Implementation: `TenantContext` class created at MCP tool call entry point with `realmId` frozen (Object.freeze). All subsystems (`CacheManager`, `RateLimiter`, `HttpClient`, `AuditLogger`) require a `TenantContext` in their constructor. The cache prefixes all keys with `realm:${realmId}:` automatically. The HTTP client validates that the response's `realmId` matches the context's. No subsystem can be instantiated without a `TenantContext`.

## MEDIUM

**[M-1] SyncToken Conflict Resolution Lacks Field-Level Strategy (from 2.1)**
- Problem: On SyncToken conflict, the server either fails (frustrating) or last-write-wins (dangerous for financial data).
- Impact: Either poor UX or data integrity risk.
- Fix: Field-type-aware conflict resolution.
- Implementation: `ConflictResolver` with three strategies: (a) Financial fields (amounts, quantities): never auto-merge, return conflict with both versions and field-level diff. (b) Metadata fields (memo, description, custom fields): last-write-wins with audit log entry. (c) Status fields (void, sent): allow if transition is monotonic (e.g., Draft→Sent is fine, Sent→Draft is rejected).

**[M-2] STARTPOSITION Deep Pagination is O(n²) (from 4.1)**
- Problem: Offset-based pagination gets progressively slower for deep pages. Page 100 requires QBO to skip 99,000 rows.
- Impact: Timeout on large datasets, degraded performance for data export.
- Fix: Time-based cursor pagination.
- Implementation: Query with `WHERE MetaData.LastUpdatedTime >= '${cursor}' ORDER BY MetaData.LastUpdatedTime ASC, Id ASC MAXRESULTS 1000`. Next cursor = last item's `LastUpdatedTime`. Handle timestamp ties by also filtering `Id > lastId` when `LastUpdatedTime === cursor`. Falls back to STARTPOSITION only for queries with WHERE clauses that prevent time-based ordering.

**[M-3] Report 400K Cell Limit Has No Pre-Flight Check (from 4.2)**
- Problem: Reports that exceed 400K cells fail without preview. The AI assistant gets an error and has no idea why or how to fix it.
- Impact: Failed report requests with no actionable guidance.
- Fix: Pre-flight estimation and auto-chunking.
- Implementation: `ReportChunker` estimates cell count: `rows × columns × periods`. Heuristics per report type (e.g., P&L: `accounts × customers × months`). If estimate exceeds 300K (75% threshold), split along the dimension with highest cardinality. For P&L by Customer with 500 customers: split into 5 batches of 100 customers each. Return merged result with a `chunked: true` metadata flag.

**[M-4] Exponential Backoff Without Jitter (from 1.3)**
- Problem: Synchronized retries from concurrent tool calls create thundering herd on recovery.
- Impact: Retry storms delay recovery and can re-trigger rate limits.
- Fix: Decorrelated jitter.
- Implementation: Use `p-retry` with custom backoff: `const delay = Math.min(maxDelay, Math.random() * baseDelay * Math.pow(2, attempt))`. Configure: `baseDelay: 1000ms`, `maxDelay: 30000ms`, `maxAttempts: 5`. For 429 responses, respect `Retry-After` header if present.

**[M-5] Loosely Typed QBO Responses (from 6.1, 6.3, 6.4, 6.5)**
- Problem: Fields vary between string/number/null/missing across entity types and minor versions. AI assistants will make incorrect assumptions about field types.
- Impact: Runtime errors, incorrect financial calculations, confusing AI behavior.
- Fix: Zod schema normalization layer.
- Implementation: Define schemas for all 36 entity types. Use transformers for type coercion: `QBOMoney` (string|number → Decimal), `QBORef` (coerce value to string), `QBODate` (multi-format parse to ISO), `QBOOptionalString` (null|"" → undefined). Wrap all API responses through `normalizeEntity(raw, schema)`. Use `.passthrough()` to preserve unknown fields. Generate schemas from QBO's OpenAPI spec where available, then hand-tune.

**[M-6] No Structured Logging or Request Tracing (from 7.1, 7.2)**
- Problem: Without structured logging, debugging production issues requires grepping through unstructured text. Without tracing, correlating an MCP tool call to its QBO API calls is impossible.
- Impact: Slow incident response, inability to diagnose intermittent failures.
- Fix: Structured logging with trace propagation.
- Implementation: `pino` logger with base fields: `{service: 'quick-fin', version: '1.0.0'}`. Per-request child logger: `logger.child({traceId, realmId, toolName})`. Log at each QBO API call: `{traceId, method, url, statusCode, durationMs, retryCount}`. Optionally emit OpenTelemetry spans via `@opentelemetry/sdk-node` for distributed tracing.

**[M-7] No Error Classification System (from 7.4)**
- Problem: All QBO errors trigger the same retry/error path. But auth errors, validation errors, rate limits, and server errors require fundamentally different handling.
- Impact: Unnecessary retries on non-retryable errors, missed recovery opportunities on retryable errors.
- Fix: Error taxonomy with mapped recovery actions.
- Implementation:
```typescript
enum ErrorCategory { RETRYABLE, AUTH, VALIDATION, CONFLICT, RATE_LIMIT, UNKNOWN }
class QBOError extends Error {
  category: ErrorCategory;
  qboErrorCode: string;
  retryable: boolean;
  suggestedAction: string;
}
```
Map QBO error codes: 429→RATE_LIMIT, 401/403→AUTH, 400+6000-series→VALIDATION, SyncToken mismatch→CONFLICT, 5xx/timeout/ECONNRESET→RETRYABLE.

**[M-8] Graceful Shutdown Missing (from 9.1)**
- Problem: SIGTERM during in-flight batch writes leaves operations in unknown state.
- Impact: Partial writes with no record of what completed.
- Fix: Graceful shutdown with in-flight tracking.
- Implementation: Maintain an `inFlightOps: Set<Promise>`. On SIGTERM: (1) set `shuttingDown = true`, (2) reject new tool calls with "server shutting down", (3) `await Promise.allSettled([...inFlightOps])` with 30s timeout, (4) persist CDC cursors and rate limit state, (5) exit. If timeout expires, log all incomplete operations with their traceIds for manual reconciliation.

**[M-9] Tenant Lifecycle Cleanup (from 8.5, 8.6)**
- Problem: Disconnecting a QBO company doesn't clean up all state (tokens, caches, rate limiters, CDC cursors, locks). Memory leaks and ghost state accumulate.
- Impact: Memory leaks in long-running servers, potential stale data served from orphaned caches.
- Fix: Registry-based cleanup pattern.
- Implementation: `TenantLifecycleManager` with subsystem registry. Each subsystem (TokenStore, CacheManager, RateLimiter, CDCTracker, EntityLockManager) implements `TenantAware { cleanup(realmId): Promise<void> }` and registers with the lifecycle manager. `disconnect(realmId)` calls cleanup on all registered subsystems. LRU eviction with configurable `MAX_TENANTS` (default 50) evicts after 30 minutes of inactivity.

## LOW

**[L-1] Report Caching Without Proper Invalidation (from 4.3)**
- Problem: Cached reports become stale when mutations occur. Serving a stale P&L is misleading.
- Impact: AI assistant works with stale financial data (mitigated by short TTL).
- Fix: TTL + entity-type-based invalidation.
- Implementation: `lru-cache` with 5-minute TTL. Tag each cached report with dependent entity types (e.g., P&L → [Invoice, Bill, Payment, JournalEntry]). On any mutation to a tagged entity type, evict all reports with that tag. Cache key: `realm:${realmId}:report:${reportType}:${paramHash}`.

**[L-2] No Query OR Operator Workaround (from 4.6)**
- Problem: AI assistants will naturally try OR conditions in queries and get parse errors.
- Impact: Poor UX — the AI gets a confusing error and doesn't know how to reformulate.
- Fix: Query rewriter that splits OR into parallel queries.
- Implementation: Parse the WHERE clause. If OR is detected, split into N queries (one per OR branch), execute in parallel, merge results, deduplicate by Id. Use IN operator where the field supports it (reduces N queries to 1). Return a `rewritten: true` flag so the AI knows the query was modified.

**[L-3] HMAC Timing Attack on Webhook Validation (from 5.5)**
- Problem: String comparison for HMAC is vulnerable to timing attacks.
- Impact: Low probability of exploitation but trivially fixable.
- Fix: Use `crypto.timingSafeEqual()`.
- Implementation: `const isValid = crypto.timingSafeEqual(Buffer.from(computedHmac, 'base64'), Buffer.from(receivedHmac, 'base64'))`. One line change.

**[L-4] No Health Check Endpoint (from 7.5)**
- Problem: No way to verify server health, token validity, or rate limit status.
- Impact: Blind to operational issues until they cause failures.
- Fix: `/health` endpoint with multi-probe checks.
- Implementation: JSON response: `{ status: 'healthy'|'degraded'|'unhealthy', tenants: { [realmId]: { tokenValid, lastApiCall, rateLimitRemaining, cdcLastPoll, circuitBreakerState } } }`.

**[L-5] No Configuration Externalization (from 9.5)**
- Problem: Hard-coded timeouts, retry counts, rate limits require redeployment to tune.
- Impact: Slow operational response to changing conditions.
- Fix: Zod-validated configuration from environment.
- Implementation: Define `ConfigSchema` with all tunables, default values, and validation. Load order: env vars → .env → config.json → defaults. Fail fast on startup if validation fails.

**[L-6] Dependency Version Drift (from 9.4)**
- Problem: MCP SDK is pre-1.0, breaking changes are likely.
- Impact: CI/CD failures, production breakage on dependency update.
- Fix: Exact version pinning + `npm ci` + Dependabot with manual merge.
- Implementation: Remove `^` and `~` from all `package.json` versions. Add `.nvmrc` with Node version. Add `engines` field. Configure Dependabot for weekly security-only PRs.

**[L-7] Adaptive Rate Limiting from Response Headers (from 3.6)**
- Problem: Client-side rate limit counting drifts from server-side reality.
- Impact: Either too aggressive (wasted budget) or too conservative (unnecessary throttling).
- Fix: Read `X-RateLimit-Remaining` and calibrate.
- Implementation: On each response, `bucket.setTokens(Math.min(bucket.tokens, parseInt(headers['x-ratelimit-remaining'])))`. If `remaining < 50`, log a warning. If `remaining === 0`, pause all requests until `X-RateLimit-Reset` timestamp.

---

## ARCHITECTURE REQUIREMENTS (Consolidated)

1. **TokenManager**: Coalescing promise pattern for refresh (C-2), write-ahead persistence with atomic writes (C-1), per-realmId isolation (H-8).

2. **IdempotencyManager**: Deterministic fingerprinting of all mutations (C-3), in-memory map with disk-backed persistence, 1-hour TTL, crash recovery.

3. **MoneyType**: All monetary values as `Decimal` (C-4) via `decimal.js`, never use JavaScript `number` for financial arithmetic, Zod coercion at API boundary.

4. **AuditLogger**: Append-only SQLite log for all mutations (C-5), encrypted payloads, 90-day retention, queryable by traceId/realmId/entityType.

5. **EntityLockManager**: Per-entity async mutex (H-1) via `async-mutex`, 5-second acquisition timeout, deadlock detection via lock ordering.

6. **BatchExecutor**: Per-item result tracking (H-2), dependency analysis for cross-references, `retryFailed()` helper, never auto-retry successful items.

7. **CDCManager**: Truncation detection at 1000 boundary (H-3), binary time-window search, deduplication by entityId, daily full reconciliation, 25-day staleness alert.

8. **CircuitBreakerGroup**: Per-endpoint-group breakers (H-4) via `cockatiel` — 4 groups (accounting, reports, payments, payroll), configurable thresholds.

9. **RateLimitManager**: Per-realmId token bucket (H-5) with 500 tokens/min, priority queue (P0/P1/P2), fair-share allocation across sessions, adaptive calibration from response headers (L-7).

10. **ConcurrencySemaphore**: `p-limit(10)` for QBO's concurrent request limit (H-6), separate from rate limiting.

11. **WebhookProcessor**: Immediate 200 + async queue via BullMQ (H-7), deduplication set, fetch-on-notify pattern, CDC reconciliation every 5 minutes, HMAC with `timingSafeEqual` (L-3).

12. **TenantContext**: Frozen realmId object (H-8), required by all subsystems, cache key prefixing by construction, HTTP client response validation.

13. **ConflictResolver**: Field-type-aware strategy (M-1) — financial fields block, metadata fields LWW with audit, status fields monotonic-only.

14. **QueryExecutor**: Time-based cursor pagination (M-2), OR rewriting (L-2), timeout detection with speculative narrowing, IN operator optimization.

15. **ReportChunker**: Pre-flight cell estimation (M-3), auto-splitting by highest-cardinality dimension, result merging, cache with entity-type invalidation (L-1).

16. **SchemaRegistry**: Zod schemas for all 36 entity types (M-5), coercion transforms for QBOMoney/QBORef/QBODate/QBOOptionalString, `.passthrough()` for forward compatibility, minor version pinning.

17. **Logger**: `pino` structured JSON (M-6), per-request child loggers with traceId, QBO request/response logging with duration and status.

18. **ErrorClassifier**: Taxonomy with 6 categories (M-7), mapped recovery actions, QBO error code → category lookup table.

19. **ShutdownManager**: SIGTERM/SIGINT handler (M-8), in-flight operation tracking, 30-second drain timeout, state persistence on exit.

20. **TenantLifecycleManager**: Registry pattern (M-9), `connect()`/`disconnect()` with cleanup on all subsystems, LRU eviction at `MAX_TENANTS`, 30-minute inactivity timeout.

21. **ConfigManager**: Zod-validated schema (L-5), env → .env → file → defaults, fail-fast on startup.

22. **HealthCheck**: `/health` endpoint (L-4) with liveness, readiness, per-tenant status, circuit breaker states.

23. **HttpPool**: `undici` Pool (from 3.4) with `connections: 10`, per-request auth headers, `AbortController` timeouts (10s CRUD, 30s reports, 60s batch).

24. **TestHarness**: Three-tier strategy (from 9.3) — unit tests with `nock` fixtures, integration tests against sandbox, contract tests from sanitized production recordings. `jest` as runner.

25. **DependencyPolicy**: Exact version pinning (L-6), `npm ci` in CI, `.nvmrc`, `engines` field, Dependabot security-only.
