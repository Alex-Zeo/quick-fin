/**
 * Retry with decorrelated jitter, backed by p-retry.
 *
 * Only retries errors classified as RETRYABLE or RATE_LIMIT.
 * Respects the Retry-After header on 429 responses.
 */

import pRetry, { AbortError } from 'p-retry';

import { ErrorCategory, QBOError } from './error-classifier.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of attempts including the first (default 5). */
  maxAttempts?: number;
  /** Base delay in ms for jitter calculation (default 1000). */
  baseDelay?: number;
  /** Maximum delay cap in ms (default 30 000). */
  maxDelay?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY = 1_000;
const DEFAULT_MAX_DELAY = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decorrelated jitter delay.
 *
 *   delay = min(maxDelay, random(0..1) * baseDelay * 2^attempt)
 *
 * Provides good spread without the thundering-herd problem of fixed
 * exponential back-off.
 */
function decorrelatedJitter(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponential = baseDelay * Math.pow(2, attempt);
  const jittered = Math.random() * exponential;
  return Math.min(maxDelay, jittered);
}

/**
 * Extract a Retry-After value (in ms) from a QBOError, if present.
 * QBO sometimes sends Retry-After as seconds.
 */
function retryAfterMs(error: unknown): number | null {
  if (!(error instanceof QBOError)) return null;
  // The Retry-After value may be stashed on the cause headers or the error itself.
  // We check a conventional property that our http-pool attaches.
  const retryAfter = (error as QBOError & { retryAfter?: string | number }).retryAfter;
  if (retryAfter == null) return null;

  const seconds = typeof retryAfter === 'number' ? retryAfter : parseFloat(retryAfter);
  if (Number.isNaN(seconds)) return null;
  return seconds * 1_000;
}

/**
 * Determine whether a thrown error should be retried.
 */
function shouldRetry(error: unknown): boolean {
  if (error instanceof QBOError) {
    return (
      error.category === ErrorCategory.RETRYABLE ||
      error.category === ErrorCategory.RATE_LIMIT
    );
  }
  // Unknown errors (e.g. network failures not yet classified) — retry
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute `fn` with automatic retries and decorrelated jitter.
 *
 * Non-retryable errors are thrown immediately; retryable ones are retried
 * up to `maxAttempts` times.  On 429, Retry-After is respected.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelay = opts.baseDelay ?? DEFAULT_BASE_DELAY;
  const maxDelay = opts.maxDelay ?? DEFAULT_MAX_DELAY;

  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (error: unknown) {
        if (!shouldRetry(error)) {
          // Wrap in AbortError so p-retry stops immediately
          throw new AbortError(
            error instanceof Error ? error.message : String(error),
          );
        }
        throw error;
      }
    },
    {
      retries: maxAttempts - 1, // p-retry counts retries, not total attempts
      minTimeout: baseDelay,
      maxTimeout: maxDelay,
      // Custom delay calculation using decorrelated jitter
      onFailedAttempt(error) {
        const attempt = error.attemptNumber; // 1-based

        // If we have a Retry-After header, use it instead of jitter
        const enforced = retryAfterMs(error);
        if (enforced != null && enforced > 0) {
          // p-retry doesn't natively support dynamic delays in onFailedAttempt,
          // so we await a manual sleep.  This is invoked before the next attempt.
          return new Promise<void>((resolve) => setTimeout(resolve, enforced));
        }

        // Otherwise apply decorrelated jitter
        const delay = decorrelatedJitter(attempt, baseDelay, maxDelay);
        return new Promise<void>((resolve) => setTimeout(resolve, delay));
      },
    },
  );
}
