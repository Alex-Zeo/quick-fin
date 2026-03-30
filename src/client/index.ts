/**
 * Client layer — resilient HTTP access to the QuickBooks Online API.
 *
 * Re-exports every public symbol so consumers can import from a single path:
 *
 *   import { QBOHttpPool, QBOError, Priority } from '../client/index.js';
 */

export {
  ErrorCategory,
  QBOError,
  classifyError,
  type QBOErrorOptions,
} from './error-classifier.js';

export {
  RateLimiter,
  Priority,
  type RateLimiterOptions,
  type BucketStatus,
} from './rate-limiter.js';

export {
  ConcurrencyManager,
  type ConcurrencyOptions,
  type ConcurrencyStatus,
} from './concurrency.js';

export {
  CircuitBreakerManager,
  type EndpointGroup,
  type CircuitBreakerOptions,
  type BreakerState,
} from './circuit-breaker.js';

export {
  withRetry,
  type RetryOptions,
} from './retry.js';

export {
  EntityLockManager,
  type EntityLockOptions,
} from './entity-lock.js';

export {
  QBOHttpPool,
  type RequestOptions,
  type HttpPoolOptions,
} from './http-pool.js';
