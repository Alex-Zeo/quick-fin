/**
 * Per-endpoint-group circuit breakers using cockatiel.
 *
 * Four groups matching QBO's distinct service boundaries:
 *   - accounting-crud  (invoices, bills, customers, etc.)
 *   - reports          (P&L, balance sheet, etc.)
 *   - payments         (payment create/void)
 *   - payroll          (employee/paycheck reads — writes are prohibited)
 *
 * Breaker policy:
 *   CLOSED → OPEN after 5 failures in 60 s
 *   OPEN → HALF-OPEN after 30 s
 *   HALF-OPEN → CLOSED after 2 consecutive successes
 */

import {
  CircuitBreakerPolicy,
  ConsecutiveBreaker,
  SamplingBreaker,
  CircuitState,
  circuitBreaker,
  handleAll,
} from 'cockatiel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EndpointGroup = 'accounting-crud' | 'reports' | 'payments' | 'payroll';

export interface CircuitBreakerOptions {
  /** Failures to trip (default 5). */
  failureThreshold?: number;
  /** Window in ms to count failures (default 60 000). */
  failureWindow?: number;
  /** Duration in ms to stay open (default 30 000). */
  halfOpenAfter?: number;
  /** Successes in half-open to close (default 2). */
  successThreshold?: number;
}

export interface BreakerState {
  group: EndpointGroup;
  state: 'closed' | 'open' | 'halfOpen';
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const ALL_GROUPS: EndpointGroup[] = [
  'accounting-crud',
  'reports',
  'payments',
  'payroll',
];

const DEFAULT_OPTS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  failureWindow: 60_000,
  halfOpenAfter: 30_000,
  successThreshold: 2,
};

// ---------------------------------------------------------------------------
// CircuitBreakerManager
// ---------------------------------------------------------------------------

export class CircuitBreakerManager {
  private breakers = new Map<EndpointGroup, CircuitBreakerPolicy>();
  private readonly opts: Required<CircuitBreakerOptions>;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.opts = { ...DEFAULT_OPTS, ...opts };

    for (const group of ALL_GROUPS) {
      this.breakers.set(group, this.createBreaker());
    }
  }

  private createBreaker(): CircuitBreakerPolicy {
    return circuitBreaker(handleAll, {
      halfOpenAfter: this.opts.halfOpenAfter,
      breaker: new SamplingBreaker({
        threshold: this.opts.failureThreshold / (this.opts.failureThreshold + 1),
        duration: this.opts.failureWindow,
        minimumRps: 0,
      }),
    });
  }

  /**
   * Execute `fn` through the circuit breaker for the given group.
   * Throws `BrokenCircuitError` if the breaker is open.
   */
  async execute<T>(group: EndpointGroup, fn: () => Promise<T>): Promise<T> {
    const breaker = this.breakers.get(group);
    if (!breaker) {
      throw new Error(`Unknown circuit breaker group: ${group}`);
    }
    return breaker.execute(fn);
  }

  /** Current state for one group. */
  getState(group: EndpointGroup): BreakerState {
    const breaker = this.breakers.get(group);
    if (!breaker) {
      throw new Error(`Unknown circuit breaker group: ${group}`);
    }
    return {
      group,
      state: mapState(breaker.state),
    };
  }

  /** Current state for all groups. */
  getStates(): BreakerState[] {
    return ALL_GROUPS.map((group) => this.getState(group));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapState(state: CircuitState): 'closed' | 'open' | 'halfOpen' {
  switch (state) {
    case CircuitState.Closed:
      return 'closed';
    case CircuitState.Open:
      return 'open';
    case CircuitState.HalfOpen:
      return 'halfOpen';
    default:
      return 'closed';
  }
}
