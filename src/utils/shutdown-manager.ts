/**
 * Graceful shutdown manager.
 *
 * Tracks in-flight operations and waits for them to complete
 * before allowing process exit. Listens for SIGTERM and SIGINT.
 */

// ---------------------------------------------------------------------------
// ShutdownManager
// ---------------------------------------------------------------------------

export class ShutdownManager {
  private inFlight = new Set<Promise<unknown>>();
  private shuttingDown = false;
  private readonly timeoutMs: number;
  private shutdownPromise: Promise<void> | null = null;

  /**
   * @param timeoutMs  Maximum time to wait for in-flight operations (default 30s)
   */
  constructor(timeoutMs: number = 30_000) {
    this.timeoutMs = timeoutMs;
    process.on('SIGTERM', () => { this.initiateShutdown(); });
    process.on('SIGINT', () => { this.initiateShutdown(); });
  }

  /**
   * Whether shutdown has been initiated.
   */
  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Number of currently in-flight operations.
   */
  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Register an in-flight operation.
   * Rejects immediately if shutdown has been initiated.
   *
   * @param promise  The operation promise to track
   * @returns The same promise (for chaining)
   */
  register<T>(promise: Promise<T>): Promise<T> {
    if (this.shuttingDown) {
      return Promise.reject(
        new Error('Server is shutting down — no new operations accepted.'),
      );
    }

    this.inFlight.add(promise);
    promise.finally(() => {
      this.inFlight.delete(promise);
    });

    return promise;
  }

  /**
   * Unregister a completed operation.
   * Usually not needed since register() auto-cleans via .finally(),
   * but provided for explicit control.
   */
  unregister(promise: Promise<unknown>): void {
    this.inFlight.delete(promise);
  }

  /**
   * Initiate graceful shutdown.
   *
   * 1. Stops accepting new operations
   * 2. Waits for all in-flight operations to complete (up to timeout)
   * 3. Exits the process
   */
  async initiateShutdown(): Promise<void> {
    if (this.shuttingDown) {
      // Return the existing shutdown promise if already shutting down
      return this.shutdownPromise ?? Promise.resolve();
    }

    this.shuttingDown = true;

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async performShutdown(): Promise<void> {
    const count = this.inFlight.size;
    if (count > 0) {
      console.error(
        `[quick-fin] Shutting down gracefully. ${count} operation(s) in flight.`,
      );
    } else {
      console.error('[quick-fin] Shutting down gracefully. No operations in flight.');
    }

    // Race between draining in-flight ops and the timeout
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), this.timeoutMs),
    );
    const drain = Promise.allSettled([...this.inFlight]).then(() => 'drained' as const);

    const result = await Promise.race([drain, timeout]);

    if (result === 'timeout' && this.inFlight.size > 0) {
      console.error(
        `[quick-fin] Shutdown timeout after ${this.timeoutMs}ms. ${this.inFlight.size} operation(s) still in flight.`,
      );
    }

    console.error('[quick-fin] Shutdown complete.');
    process.exit(0);
  }
}
