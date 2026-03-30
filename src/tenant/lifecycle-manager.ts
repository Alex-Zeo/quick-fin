/**
 * Tenant lifecycle manager with LRU eviction.
 *
 * Manages tenant connections with automatic cleanup for inactive
 * tenants and LRU eviction when the tenant limit is reached.
 */

import { TenantContext } from './tenant-context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantAware {
  /** Unique name for this subsystem (used in logging) */
  name?: string;
  /** Clean up all resources for a tenant */
  cleanup(realmId: string): Promise<void>;
}

interface TenantEntry {
  context: TenantContext;
  lastAccess: number; // epoch ms
  connected: boolean;
}

export interface TenantLifecycleOptions {
  /** Maximum number of active tenants (default 50) */
  maxTenants?: number;
  /** Inactivity timeout in minutes (default 30) */
  inactivityMinutes?: number;
}

// ---------------------------------------------------------------------------
// TenantLifecycleManager
// ---------------------------------------------------------------------------

export class TenantLifecycleManager {
  private tenants = new Map<string, TenantEntry>();
  private subsystems: TenantAware[] = [];
  private readonly maxTenants: number;
  private readonly inactivityMs: number;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(optsOrMax?: TenantLifecycleOptions | number, inactivityMinutes?: number) {
    // Support both old positional args and new options object
    if (typeof optsOrMax === 'number') {
      this.maxTenants = optsOrMax;
      this.inactivityMs = (inactivityMinutes ?? 30) * 60 * 1000;
    } else {
      const opts = optsOrMax ?? {};
      this.maxTenants = opts.maxTenants ?? 50;
      this.inactivityMs = (opts.inactivityMinutes ?? 30) * 60 * 1000;
    }
    this.startEvictionTimer();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Register a subsystem that needs cleanup when a tenant disconnects.
   */
  register(subsystem: TenantAware): void {
    this.subsystems.push(subsystem);
  }

  /**
   * Connect a tenant, returning a frozen TenantContext.
   * Evicts the least recently used tenant if at capacity.
   *
   * @param realmId  QBO company ID
   */
  connect(realmId: string): TenantContext {
    const existing = this.tenants.get(realmId);
    if (existing && existing.connected) {
      existing.lastAccess = Date.now();
      return existing.context;
    }

    // Check capacity — evict LRU if needed
    if (this.tenants.size >= this.maxTenants) {
      this.evictLRU();
    }

    const context = TenantContext.create(realmId);
    this.tenants.set(realmId, {
      context,
      lastAccess: Date.now(),
      connected: true,
    });

    return context;
  }

  /**
   * Disconnect a tenant, cleaning up all subsystem resources.
   *
   * @param realmId  QBO company ID
   */
  async disconnect(realmId: string): Promise<void> {
    const entry = this.tenants.get(realmId);
    if (!entry) return;

    entry.connected = false;

    // Clean up all subsystems — use allSettled so one failure doesn't block others
    await Promise.allSettled(
      this.subsystems.map((sub) => sub.cleanup(realmId)),
    );

    this.tenants.delete(realmId);
  }

  /**
   * Touch a tenant to update its last access time.
   */
  touch(realmId: string): void {
    const entry = this.tenants.get(realmId);
    if (entry) entry.lastAccess = Date.now();
  }

  /**
   * Get a tenant context if connected (legacy name).
   */
  getContext(realmId: string): TenantContext | undefined {
    const entry = this.tenants.get(realmId);
    if (entry?.connected) {
      entry.lastAccess = Date.now();
      return entry.context;
    }
    return undefined;
  }

  /**
   * Get a tenant context if connected.
   */
  get(realmId: string): TenantContext | null {
    return this.getContext(realmId) ?? null;
  }

  /**
   * Check if a tenant is connected.
   */
  isConnected(realmId: string): boolean {
    const entry = this.tenants.get(realmId);
    return entry?.connected === true;
  }

  /**
   * Get current tenant count.
   */
  get connectedCount(): number {
    return this.tenants.size;
  }

  /**
   * Alias for connectedCount.
   */
  get size(): number {
    return this.tenants.size;
  }

  /**
   * Get all active realm IDs.
   */
  getActiveRealmIds(): string[] {
    return Array.from(this.tenants.entries())
      .filter(([, entry]) => entry.connected)
      .map(([realmId]) => realmId);
  }

  /**
   * Legacy alias for getActiveRealmIds.
   */
  listConnected(): string[] {
    return this.getActiveRealmIds();
  }

  /**
   * Evict inactive tenants that exceed the inactivity timeout.
   */
  async evictInactive(): Promise<number> {
    const now = Date.now();
    const toEvict: string[] = [];

    for (const [realmId, entry] of this.tenants) {
      if (entry.connected && now - entry.lastAccess > this.inactivityMs) {
        toEvict.push(realmId);
      }
    }

    let evicted = 0;
    for (const realmId of toEvict) {
      await this.disconnect(realmId);
      evicted++;
    }
    return evicted;
  }

  /**
   * Shut down the manager, disconnecting all tenants.
   */
  async destroy(): Promise<void> {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }

    const realmIds = Array.from(this.tenants.keys());
    await Promise.allSettled(realmIds.map((id) => this.disconnect(id)));
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Evict the least recently used tenant.
   */
  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [realmId, entry] of this.tenants) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldest = realmId;
      }
    }

    if (oldest) {
      // Synchronous removal, async cleanup in background
      this.tenants.delete(oldest);
      for (const sub of this.subsystems) {
        sub.cleanup(oldest).catch(() => {
          // Best effort
        });
      }
    }
  }

  /**
   * Periodically check for inactive tenants and disconnect them.
   */
  private startEvictionTimer(): void {
    this.evictionTimer = setInterval(() => {
      this.evictInactive().catch(() => {
        // Best effort
      });
    }, 60_000);

    if (this.evictionTimer && typeof this.evictionTimer === 'object' && 'unref' in this.evictionTimer) {
      (this.evictionTimer as NodeJS.Timeout).unref();
    }
  }
}
