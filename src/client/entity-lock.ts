/**
 * Per-entity async mutex for read-before-write safety.
 *
 * QBO requires SyncToken on every update.  Concurrent mutations to the same
 * entity can cause SyncToken conflicts.  This module serialises access per
 * entity so that only one mutation is in-flight at a time.
 *
 * Uses `async-mutex` for fair, non-starving FIFO ordering.
 */

import { Mutex, withTimeout, E_TIMEOUT, type MutexInterface } from 'async-mutex';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntityLockOptions {
  /** Lock acquisition timeout in ms (default 5 000). */
  acquireTimeout?: number;
  /** Auto-cleanup interval for stale locks in ms (default 60 000). */
  staleCleanupInterval?: number;
}

interface LockEntry {
  mutex: MutexInterface;
  lastUsed: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_ACQUIRE_TIMEOUT = 5_000;
const DEFAULT_STALE_CLEANUP_INTERVAL = 60_000;

// ---------------------------------------------------------------------------
// EntityLockManager
// ---------------------------------------------------------------------------

export class EntityLockManager {
  private locks = new Map<string, LockEntry>();
  private readonly acquireTimeout: number;
  private readonly staleCleanupMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: EntityLockOptions = {}) {
    this.acquireTimeout = opts.acquireTimeout ?? DEFAULT_ACQUIRE_TIMEOUT;
    this.staleCleanupMs = opts.staleCleanupInterval ?? DEFAULT_STALE_CLEANUP_INTERVAL;

    // Start periodic stale-lock cleanup
    this.cleanupTimer = setInterval(() => this.cleanup(), this.staleCleanupMs);
    // Allow the process to exit even if this timer is active
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private lockKey(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  private getEntry(key: string): LockEntry {
    let entry = this.locks.get(key);
    if (!entry) {
      const baseMutex = new Mutex();
      entry = {
        mutex: withTimeout(baseMutex, this.acquireTimeout),
        lastUsed: Date.now(),
      };
      this.locks.set(key, entry);
    }
    entry.lastUsed = Date.now();
    return entry;
  }

  /**
   * Execute `fn` while holding an exclusive lock on `entityType:entityId`.
   *
   * If the lock cannot be acquired within the timeout, an error is thrown.
   */
  async withLock<T>(
    entityType: string,
    entityId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = this.lockKey(entityType, entityId);
    const entry = this.getEntry(key);

    try {
      return await entry.mutex.runExclusive(fn);
    } catch (error: unknown) {
      if (error === E_TIMEOUT) {
        throw new Error(
          `Lock acquisition timeout (${this.acquireTimeout}ms) for ${key}`,
        );
      }
      throw error;
    }
  }

  /** Check whether a lock is currently held. */
  isLocked(entityType: string, entityId: string): boolean {
    const key = this.lockKey(entityType, entityId);
    const entry = this.locks.get(key);
    return entry?.mutex.isLocked() ?? false;
  }

  /** Remove lock entries that haven't been used recently. */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.locks) {
      if (!entry.mutex.isLocked() && now - entry.lastUsed > this.staleCleanupMs) {
        this.locks.delete(key);
      }
    }
  }

  /** Tear down the manager (clears timers). */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.locks.clear();
  }
}
