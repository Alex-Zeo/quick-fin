/**
 * Frozen tenant context required by all subsystems.
 * Prevents data leakage between QBO companies.
 */

export class TenantContext {
  readonly realmId: string;
  readonly connectedAt: Date;

  private constructor(realmId: string) {
    this.realmId = realmId;
    this.connectedAt = new Date();
    Object.freeze(this);
  }

  /**
   * Create a new frozen TenantContext.
   *
   * @param realmId  QBO company/realm ID
   * @returns Frozen TenantContext instance
   */
  static create(realmId: string): TenantContext {
    if (!realmId || typeof realmId !== 'string') {
      throw new Error('realmId is required and must be a non-empty string');
    }
    return new TenantContext(realmId);
  }

  /**
   * Generate a namespaced cache key.
   *
   * @param suffix  Cache key suffix (e.g. 'tokens', 'rate-limit')
   * @returns Scoped key like `realm:123456789:tokens`
   */
  cacheKey(suffix: string): string {
    return `realm:${this.realmId}:${suffix}`;
  }

  /**
   * String representation for logging.
   */
  toString(): string {
    return `TenantContext(${this.realmId})`;
  }
}
