/**
 * Main HTTP client for QBO API access.
 *
 * Wraps `undici.Pool` with integrated:
 *   - Rate limiting (per-realmId token bucket)
 *   - Concurrency control (per-realmId semaphore)
 *   - Circuit breakers (per-endpoint-group)
 *   - Retry with decorrelated jitter
 *   - Error classification
 *
 * All QBO API calls flow through this single client.
 */

import { Pool } from 'undici';

import type { Config } from '../config/schema.js';
import { classifyError, ErrorCategory, QBOError } from './error-classifier.js';
import { RateLimiter, Priority } from './rate-limiter.js';
import { ConcurrencyManager } from './concurrency.js';
import {
  CircuitBreakerManager,
  type EndpointGroup,
} from './circuit-breaker.js';
import { withRetry, type RetryOptions } from './retry.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QBO_BASE_URLS: Record<string, string> = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
};

/** Timeout presets (ms) */
const TIMEOUT = {
  crud: 10_000,
  reports: 30_000,
  batch: 60_000,
} as const;

/** Map endpoint groups to default timeouts */
const GROUP_TIMEOUT: Record<EndpointGroup, number> = {
  'accounting-crud': TIMEOUT.crud,
  reports: TIMEOUT.reports,
  payments: TIMEOUT.crud,
  payroll: TIMEOUT.crud,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RequestOptions {
  /** Circuit breaker group (default 'accounting-crud'). */
  group?: EndpointGroup;
  /** Request timeout in ms (overrides the group default). */
  timeout?: number;
  /** Rate limit priority (default P1). */
  priority?: Priority;
  /** Additional headers. */
  headers?: Record<string, string>;
  /** Additional query parameters. */
  query?: Record<string, string | number | boolean>;
  /** Body payload for POST/PUT (will be JSON-serialised). */
  body?: unknown;
  /** Retry options override. */
  retry?: RetryOptions;
}

export interface HttpPoolOptions {
  config: Config;
  /** Function that returns a current access token for a given realmId. */
  getAccessToken: (realmId: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// QBOHttpPool
// ---------------------------------------------------------------------------

export class QBOHttpPool {
  private pool: Pool;
  private readonly rateLimiter: RateLimiter;
  private readonly concurrency: ConcurrencyManager;
  private readonly circuitBreaker: CircuitBreakerManager;
  private readonly getAccessToken: (realmId: string) => Promise<string>;
  private readonly minorVersion: number;
  private readonly baseUrl: string;

  constructor(opts: HttpPoolOptions) {
    const { config, getAccessToken } = opts;
    this.getAccessToken = getAccessToken;
    this.minorVersion = config.minorVersion;
    this.baseUrl =
      QBO_BASE_URLS[config.oauth.environment] ?? QBO_BASE_URLS.sandbox;

    this.pool = new Pool(this.baseUrl, {
      connections: config.rateLimits.maxConcurrent,
      pipelining: 1,
    });

    this.rateLimiter = new RateLimiter({
      tokensPerMinute: config.rateLimits.requestsPerMinute,
    });

    this.concurrency = new ConcurrencyManager({
      maxConcurrent: config.rateLimits.maxConcurrent,
    });

    this.circuitBreaker = new CircuitBreakerManager();
  }

  // -----------------------------------------------------------------------
  // Public convenience methods
  // -----------------------------------------------------------------------

  /** HTTP GET — for reads and queries. */
  async get<T = unknown>(
    realmId: string,
    path: string,
    options: Omit<RequestOptions, 'body'> = {},
  ): Promise<T> {
    return this.request<T>(realmId, 'GET', path, options);
  }

  /** HTTP POST — for creates, updates, and queries. */
  async post<T = unknown>(
    realmId: string,
    path: string,
    body: unknown,
    options: Omit<RequestOptions, 'body'> = {},
  ): Promise<T> {
    return this.request<T>(realmId, 'POST', path, { ...options, body });
  }

  // -----------------------------------------------------------------------
  // Core request pipeline
  // -----------------------------------------------------------------------

  /**
   * Execute an HTTP request through the full resilience pipeline:
   *
   *   rate-limit → concurrency → circuit-breaker → retry → HTTP
   */
  async request<T = unknown>(
    realmId: string,
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const {
      group = 'accounting-crud',
      timeout,
      priority = Priority.P1,
      headers = {},
      query = {},
      body,
      retry: retryOpts,
    } = options;

    const effectiveTimeout = timeout ?? GROUP_TIMEOUT[group];

    // 1. Rate limit
    await this.rateLimiter.acquire(realmId, priority);

    // 2. Concurrency
    return this.concurrency.run(realmId, () =>
      // 3. Circuit breaker
      this.circuitBreaker.execute(group, () =>
        // 4. Retry
        withRetry(
          () => this.executeRequest<T>(realmId, method, path, {
            headers,
            query,
            body,
            timeout: effectiveTimeout,
          }),
          retryOpts,
        ),
      ),
    );
  }

  // -----------------------------------------------------------------------
  // Raw HTTP execution
  // -----------------------------------------------------------------------

  private async executeRequest<T>(
    realmId: string,
    method: string,
    path: string,
    opts: {
      headers: Record<string, string>;
      query: Record<string, string | number | boolean>;
      body?: unknown;
      timeout: number;
    },
  ): Promise<T> {
    const token = await this.getAccessToken(realmId);

    // Build query string with minorversion
    const queryParams = new URLSearchParams();
    queryParams.set('minorversion', String(this.minorVersion));
    for (const [k, v] of Object.entries(opts.query)) {
      queryParams.set(k, String(v));
    }

    // Full path: /v3/company/{realmId}/{path}?minorversion=75&...
    const fullPath = `/v3/company/${realmId}/${path}?${queryParams.toString()}`;

    // Merge headers
    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...opts.headers,
    };

    let requestBody: string | undefined;
    if (opts.body != null) {
      requestHeaders['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(opts.body);
    }

    let statusCode = 0;
    let responseBody: Record<string, unknown> | null = null;

    try {
      const response = await this.pool.request({
        method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
        path: fullPath,
        headers: requestHeaders,
        body: requestBody,
        headersTimeout: opts.timeout,
        bodyTimeout: opts.timeout,
      });

      statusCode = response.statusCode;

      // Calibrate rate limiter from response headers
      const headerMap: Record<string, string | string[] | undefined> = {};
      if (response.headers) {
        for (const [key, value] of Object.entries(response.headers)) {
          headerMap[key] = value as string | string[] | undefined;
        }
      }
      this.rateLimiter.updateFromHeaders(realmId, headerMap);

      // Read body
      const rawBody = await response.body.text();

      // Parse JSON (QBO always returns JSON for API calls)
      if (rawBody) {
        try {
          responseBody = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          // Non-JSON response — treat as raw text in an envelope
          responseBody = { raw: rawBody };
        }
      }

      // Success range
      if (statusCode >= 200 && statusCode < 300) {
        return responseBody as T;
      }

      // Error — classify and throw
      const qboError = classifyError(statusCode, responseBody);

      // Attach Retry-After for 429s so the retry layer can use it
      if (statusCode === 429) {
        const retryAfterHeader = headerMap['retry-after'] ?? headerMap['Retry-After'];
        if (retryAfterHeader) {
          (qboError as QBOError & { retryAfter?: string }).retryAfter =
            Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader;
        }
      }

      throw qboError;
    } catch (error: unknown) {
      // If already a QBOError, re-throw as-is
      if (error instanceof QBOError) {
        throw error;
      }

      // Network / transport error — classify it
      throw classifyError(0, null, error instanceof Error ? error : new Error(String(error)));
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle & diagnostics
  // -----------------------------------------------------------------------

  /** Get the underlying rate limiter (for status inspection). */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /** Get the concurrency manager. */
  getConcurrencyManager(): ConcurrencyManager {
    return this.concurrency;
  }

  /** Get the circuit breaker manager. */
  getCircuitBreakerManager(): CircuitBreakerManager {
    return this.circuitBreaker;
  }

  /** Gracefully shut down the pool and all subsystems. */
  async destroy(): Promise<void> {
    this.rateLimiter.destroy();
    this.concurrency.destroy();
    await this.pool.close();
  }
}
