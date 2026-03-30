/**
 * Health check aggregator.
 *
 * Collects status from all subsystems to produce a unified
 * health status for the MCP server.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OverallStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface TenantHealth {
  realmId: string;
  tokenValid: boolean;
  tokenExpiresAt: number | null;
  lastApiCall: number | null;
  rateLimitRemaining: number | null;
  cdcLastPoll: number | null;
  circuitBreaker: 'closed' | 'open' | 'half-open';
}

export interface HealthStatus {
  status: OverallStatus;
  uptime: number; // ms
  timestamp: string;
  tenants: TenantHealth[];
  subsystems: Record<string, SubsystemHealth>;
}

export interface SubsystemHealth {
  name: string;
  status: OverallStatus;
  message?: string;
  lastCheck: number;
}

export interface HealthDataProvider {
  name: string;
  check(): SubsystemHealth;
}

export interface TenantHealthProvider {
  getTenantHealth(realmId: string): TenantHealth;
  getActiveRealmIds(): string[];
}

// ---------------------------------------------------------------------------
// HealthChecker
// ---------------------------------------------------------------------------

export class HealthChecker {
  private readonly startTime: number;
  private readonly subsystemProviders: HealthDataProvider[] = [];
  private tenantProvider: TenantHealthProvider | null = null;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Register a subsystem health provider.
   */
  registerSubsystem(provider: HealthDataProvider): void {
    this.subsystemProviders.push(provider);
  }

  /**
   * Register the tenant health provider.
   */
  registerTenantProvider(provider: TenantHealthProvider): void {
    this.tenantProvider = provider;
  }

  /**
   * Perform a full health check across all subsystems and tenants.
   */
  check(): HealthStatus {
    const now = Date.now();

    // Collect subsystem health
    const subsystems: Record<string, SubsystemHealth> = {};
    for (const provider of this.subsystemProviders) {
      try {
        subsystems[provider.name] = provider.check();
      } catch (err) {
        subsystems[provider.name] = {
          name: provider.name,
          status: 'unhealthy',
          message: `Health check failed: ${err instanceof Error ? err.message : String(err)}`,
          lastCheck: now,
        };
      }
    }

    // Collect tenant health
    const tenants: TenantHealth[] = [];
    if (this.tenantProvider) {
      const realmIds = this.tenantProvider.getActiveRealmIds();
      for (const realmId of realmIds) {
        try {
          tenants.push(this.tenantProvider.getTenantHealth(realmId));
        } catch {
          tenants.push({
            realmId,
            tokenValid: false,
            tokenExpiresAt: null,
            lastApiCall: null,
            rateLimitRemaining: null,
            cdcLastPoll: null,
            circuitBreaker: 'open',
          });
        }
      }
    }

    // Determine overall status
    const status = this.aggregateStatus(subsystems, tenants);

    return {
      status,
      uptime: now - this.startTime,
      timestamp: new Date(now).toISOString(),
      tenants,
      subsystems,
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private aggregateStatus(
    subsystems: Record<string, SubsystemHealth>,
    tenants: TenantHealth[],
  ): OverallStatus {
    const subsystemStatuses = Object.values(subsystems).map((s) => s.status);

    // Any unhealthy subsystem → unhealthy
    if (subsystemStatuses.includes('unhealthy')) {
      return 'unhealthy';
    }

    // Any degraded subsystem → degraded
    if (subsystemStatuses.includes('degraded')) {
      return 'degraded';
    }

    // Check tenant health
    if (tenants.length > 0) {
      const unhealthyTenants = tenants.filter(
        (t) => !t.tokenValid || t.circuitBreaker === 'open',
      );

      // More than half of tenants unhealthy → unhealthy
      if (unhealthyTenants.length > tenants.length / 2) {
        return 'unhealthy';
      }

      // Any tenant unhealthy → degraded
      if (unhealthyTenants.length > 0) {
        return 'degraded';
      }
    }

    return 'healthy';
  }
}
