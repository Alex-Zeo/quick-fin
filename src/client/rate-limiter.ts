/**
 * Per-realmId token-bucket rate limiter with priority lanes
 * and adaptive calibration from QBO X-RateLimit-Remaining headers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Priority levels — lower number = higher priority. */
export enum Priority {
  /** Mutations (create/update/delete) */
  P0 = 0,
  /** Standard reads */
  P1 = 1,
  /** Bulk / reports */
  P2 = 2,
}

export interface RateLimiterOptions {
  /** Max tokens per minute (default 500). */
  tokensPerMinute?: number;
}

export interface BucketStatus {
  tokens: number;
  maxTokens: number;
  tokensPerMinute: number;
  waitersCount: number;
}

// ---------------------------------------------------------------------------
// Internal: waiter in the priority queue
// ---------------------------------------------------------------------------

interface Waiter {
  priority: Priority;
  resolve: () => void;
  enqueueTime: number;
}

// ---------------------------------------------------------------------------
// Per-realm bucket
// ---------------------------------------------------------------------------

class TokenBucket {
  tokens: number;
  maxTokens: number;
  tokensPerMinute: number;
  private lastRefill: number;
  private waiters: Waiter[] = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(tokensPerMinute: number) {
    this.maxTokens = tokensPerMinute;
    this.tokensPerMinute = tokensPerMinute;
    this.tokens = tokensPerMinute;
    this.lastRefill = Date.now();
  }

  /** Continuously refill tokens based on elapsed time. */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const added = (elapsed / 60_000) * this.tokensPerMinute;
    this.tokens = Math.min(this.maxTokens, this.tokens + added);
    this.lastRefill = now;
  }

  /** Try to consume one token; returns true if successful. */
  private tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Acquire a token, waiting if necessary.
   * Higher-priority waiters (lower number) are served first.
   */
  acquire(priority: Priority): Promise<void> {
    if (this.tryConsume()) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiters.push({ priority, resolve, enqueueTime: Date.now() });
      // Sort: lower priority number = higher priority → served first
      // Break ties by enqueue time (FIFO within same priority)
      this.waiters.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.enqueueTime - b.enqueueTime;
      });
      this.scheduleDrain();
    });
  }

  /** Schedule periodic drain of waiters as tokens refill. */
  private scheduleDrain(): void {
    if (this.drainTimer) return;
    // Check every ~50ms — fine-grained enough for smooth throughput
    this.drainTimer = setInterval(() => {
      this.drainWaiters();
    }, 50);
  }

  private drainWaiters(): void {
    while (this.waiters.length > 0 && this.tryConsume()) {
      const waiter = this.waiters.shift()!;
      waiter.resolve();
    }
    if (this.waiters.length === 0 && this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }

  /** Adaptive calibration from QBO response headers. */
  calibrate(remaining: number): void {
    // Only adjust downward to prevent exceeding the real limit
    if (remaining < this.tokens) {
      this.tokens = remaining;
    }
  }

  get waitersCount(): number {
    return this.waiters.length;
  }

  destroy(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    // Resolve all pending waiters so they don't hang
    for (const w of this.waiters) {
      w.resolve();
    }
    this.waiters.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private readonly tokensPerMinute: number;

  constructor(opts: RateLimiterOptions = {}) {
    this.tokensPerMinute = opts.tokensPerMinute ?? 500;
  }

  private getBucket(realmId: string): TokenBucket {
    let bucket = this.buckets.get(realmId);
    if (!bucket) {
      bucket = new TokenBucket(this.tokensPerMinute);
      this.buckets.set(realmId, bucket);
    }
    return bucket;
  }

  /** Wait until a token is available for the given realm and priority. */
  async acquire(realmId: string, priority: Priority = Priority.P1): Promise<void> {
    const bucket = this.getBucket(realmId);
    await bucket.acquire(priority);
  }

  /**
   * Calibrate the bucket from QBO response headers.
   *
   * Reads `X-RateLimit-Remaining` (or `x-ratelimit-remaining`).
   */
  updateFromHeaders(realmId: string, headers: Record<string, string | string[] | undefined>): void {
    const raw =
      headers['X-RateLimit-Remaining'] ??
      headers['x-ratelimit-remaining'] ??
      headers['X-Ratelimit-Remaining'];

    if (raw == null) return;

    const remaining = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
    if (Number.isNaN(remaining)) return;

    const bucket = this.getBucket(realmId);
    bucket.calibrate(remaining);
  }

  /** Current status for a realm. */
  getStatus(realmId: string): BucketStatus {
    const bucket = this.getBucket(realmId);
    return {
      tokens: Math.floor(bucket.tokens),
      maxTokens: bucket.maxTokens,
      tokensPerMinute: bucket.tokensPerMinute,
      waitersCount: bucket.waitersCount,
    };
  }

  /** Clean up a specific realm (e.g. on disconnect). */
  removeRealm(realmId: string): void {
    const bucket = this.buckets.get(realmId);
    if (bucket) {
      bucket.destroy();
      this.buckets.delete(realmId);
    }
  }

  /** Clean up all realms. */
  destroy(): void {
    for (const bucket of this.buckets.values()) {
      bucket.destroy();
    }
    this.buckets.clear();
  }
}
