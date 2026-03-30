/**
 * Validation module — re-exports.
 */

export {
  PreSubmitValidator,
  validateJEBalance,
  validateAccountRef,
  validateTaxCode,
  validateCurrency,
  type ValidationResult,
  type ValidationError,
  type HttpClient,
} from './pre-submit/index.js';

export {
  DuplicateDetector,
  type DuplicateResult,
  type DuplicateMatch,
} from './duplicate-detection.js';

export {
  IdempotencyManager,
  type IdempotencyCheck,
} from './idempotency.js';

export {
  analyzeCascade,
  getVoidOrder,
  type CascadeResult,
  type AffectedEntity,
} from './void-cascade.js';
