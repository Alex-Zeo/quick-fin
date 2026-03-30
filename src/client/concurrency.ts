/**
 * Per-realmId concurrency semaphore wrapping p-limit.
 *
 * QBO allows a maximum of 10 concurrent requests per company.
 * This module ensures we never exceed that per realm.
 */

import pLimit, { type LimitFunction } from 'p-limit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConcurrencyOptions {
  /** Maximum concurrent requests per realm (default 10). */
  maxConcurrent?: number;
}

export interface ConcurrencyStatus {
  activeCount: number;
  pendingCount: number;
  maxConcurrent: number;
}

// ---------------------------------------------------------------------------
// ConcurrencyManager
// ---------------------------------------------------------------------------

export class ConcurrencyManager {
  private limiters = new Map<string, LimitFunction>();
  private readonly maxConcurrent: number;

  constructor(opts: ConcurrencyOptions = {}) {
    this.maxConcurrent = opts.maxConcurrent ?? 10;
  }

  private getLimiter(realmId: string): LimitFunction {
    let limiter = this.limiters.get(realmId);
    if (!limiter) {
      limiter = pLimit(this.maxConcurrent);
      this.limiters.set(realmId, limiter);
    }
    return limiter;
  }

  /**
   * Execute `fn` within the concurrency semaphore for the given realm.
   * Blocks if `maxConcurrent` slots are already occupied.
   */
  async run<T>(realmId: string, fn: () => Promise<T>): Promise<T> {
    const limiter = this.getLimiter(realmId);
    return limiter(fn);
  }

  /** Current in-flight and pending counts for a realm. */
  getStatus(realmId: string): ConcurrencyStatus {
    const limiter = this.limiters.get(realmId);
    return {
      activeCount: limiter?.activeCount ?? 0,
      pendingCount: limiter?.pendingCount ?? 0,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /** Remove limiter for a disconnected realm. */
  removeRealm(realmId: string): void {
    this.limiters.delete(realmId);
  }

  /** Clear all limiters. */
  destroy(): void {
    this.limiters.clear();
  }
}
