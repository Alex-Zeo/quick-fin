/**
 * QBO API error taxonomy and classification.
 *
 * Maps HTTP status codes and QBO-specific error codes to actionable categories
 * so the retry/circuit-breaker layers can make informed decisions.
 */

// ---------------------------------------------------------------------------
// Enum & types
// ---------------------------------------------------------------------------

export enum ErrorCategory {
  RETRYABLE = 'RETRYABLE',
  AUTH = 'AUTH',
  VALIDATION = 'VALIDATION',
  CONFLICT = 'CONFLICT',
  RATE_LIMIT = 'RATE_LIMIT',
  NOT_FOUND = 'NOT_FOUND',
  UNKNOWN = 'UNKNOWN',
}

export interface QBOErrorOptions {
  message: string;
  category: ErrorCategory;
  qboErrorCode: string;
  statusCode: number;
  retryable: boolean;
  suggestedAction: string;
  cause?: Error;
}

export class QBOError extends Error {
  readonly category: ErrorCategory;
  readonly qboErrorCode: string;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly suggestedAction: string;

  constructor(opts: QBOErrorOptions) {
    super(opts.message);
    this.name = 'QBOError';
    this.category = opts.category;
    this.qboErrorCode = opts.qboErrorCode;
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable;
    this.suggestedAction = opts.suggestedAction;
    if (opts.cause) {
      this.cause = opts.cause;
    }
  }
}

// ---------------------------------------------------------------------------
// QBO response shape helpers
// ---------------------------------------------------------------------------

interface QBOFault {
  Error?: Array<{
    Message?: string;
    Detail?: string;
    code?: string;
    element?: string;
  }>;
  type?: string;
}

interface QBOResponseBody {
  Fault?: QBOFault;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Network-level error codes that warrant retries
// ---------------------------------------------------------------------------

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

// QBO 6000-series validation error codes
function isValidationCode(code: string): boolean {
  const num = parseInt(code, 10);
  return num >= 6000 && num < 7000;
}

// SyncToken mismatch indicators
function isSyncTokenConflict(body: QBOResponseBody | null): boolean {
  if (!body?.Fault?.Error) return false;
  return body.Fault.Error.some(
    (e) =>
      e.code === '5010' ||
      (e.Message ?? '').toLowerCase().includes('stale object') ||
      (e.Detail ?? '').toLowerCase().includes('synctoken'),
  );
}

// ---------------------------------------------------------------------------
// Public classifier
// ---------------------------------------------------------------------------

/**
 * Classify a QBO API error into a well-known category.
 *
 * @param statusCode  HTTP status code (0 if network failure)
 * @param responseBody  Parsed JSON body (may be null for network errors)
 * @param originalError  The underlying Error (e.g. from undici)
 */
export function classifyError(
  statusCode: number,
  responseBody: QBOResponseBody | null,
  originalError?: Error,
): QBOError {
  // ── Network / transport errors (no HTTP status) ──────────────────────
  if (statusCode === 0 && originalError) {
    const code = (originalError as NodeJS.ErrnoException).code ?? '';
    if (
      RETRYABLE_NETWORK_CODES.has(code) ||
      originalError.name === 'TimeoutError' ||
      originalError.message.includes('timeout')
    ) {
      return new QBOError({
        message: `Network error: ${originalError.message}`,
        category: ErrorCategory.RETRYABLE,
        qboErrorCode: code || 'NETWORK_ERROR',
        statusCode: 0,
        retryable: true,
        suggestedAction: 'Retry with exponential back-off',
        cause: originalError,
      });
    }
  }

  // ── Extract first QBO error detail ───────────────────────────────────
  const faultErrors = responseBody?.Fault?.Error ?? [];
  const firstError = faultErrors[0];
  const qboCode = firstError?.code ?? '';
  const message =
    firstError?.Detail ?? firstError?.Message ?? `HTTP ${statusCode}`;

  // ── Rate limit (429) ─────────────────────────────────────────────────
  if (statusCode === 429) {
    return new QBOError({
      message: `Rate limited: ${message}`,
      category: ErrorCategory.RATE_LIMIT,
      qboErrorCode: qboCode || 'RATE_LIMIT',
      statusCode,
      retryable: true,
      suggestedAction: 'Back off and respect Retry-After header',
      cause: originalError,
    });
  }

  // ── Auth (401 / 403) ────────────────────────────────────────────────
  if (statusCode === 401 || statusCode === 403) {
    return new QBOError({
      message: `Authentication/authorization error: ${message}`,
      category: ErrorCategory.AUTH,
      qboErrorCode: qboCode || 'AUTH_ERROR',
      statusCode,
      retryable: false,
      suggestedAction:
        statusCode === 401
          ? 'Refresh OAuth token and retry'
          : 'Check scopes and realm permissions',
      cause: originalError,
    });
  }

  // ── Not found (404) ──────────────────────────────────────────────────
  if (statusCode === 404) {
    return new QBOError({
      message: `Resource not found: ${message}`,
      category: ErrorCategory.NOT_FOUND,
      qboErrorCode: qboCode || 'NOT_FOUND',
      statusCode,
      retryable: false,
      suggestedAction: 'Verify entity ID and realm',
      cause: originalError,
    });
  }

  // ── Conflict: SyncToken mismatch ─────────────────────────────────────
  if (isSyncTokenConflict(responseBody)) {
    return new QBOError({
      message: `SyncToken conflict: ${message}`,
      category: ErrorCategory.CONFLICT,
      qboErrorCode: qboCode || '5010',
      statusCode,
      retryable: false,
      suggestedAction: 'Re-read entity to obtain current SyncToken, then retry',
      cause: originalError,
    });
  }

  // ── Validation: 400 + 6000-series codes ──────────────────────────────
  if (statusCode === 400) {
    if (qboCode && isValidationCode(qboCode)) {
      return new QBOError({
        message: `Validation error (${qboCode}): ${message}`,
        category: ErrorCategory.VALIDATION,
        qboErrorCode: qboCode,
        statusCode,
        retryable: false,
        suggestedAction: 'Fix request payload per QBO documentation',
        cause: originalError,
      });
    }
    // Generic 400 without 6000-series code
    return new QBOError({
      message: `Bad request: ${message}`,
      category: ErrorCategory.VALIDATION,
      qboErrorCode: qboCode || 'BAD_REQUEST',
      statusCode,
      retryable: false,
      suggestedAction: 'Check request parameters',
      cause: originalError,
    });
  }

  // ── Server errors (5xx) → retryable ──────────────────────────────────
  if (statusCode >= 500 && statusCode < 600) {
    return new QBOError({
      message: `Server error (${statusCode}): ${message}`,
      category: ErrorCategory.RETRYABLE,
      qboErrorCode: qboCode || `SERVER_${statusCode}`,
      statusCode,
      retryable: true,
      suggestedAction: 'Retry with exponential back-off',
      cause: originalError,
    });
  }

  // ── Fallback ─────────────────────────────────────────────────────────
  return new QBOError({
    message: `Unclassified error (${statusCode}): ${message}`,
    category: ErrorCategory.UNKNOWN,
    qboErrorCode: qboCode || 'UNKNOWN',
    statusCode,
    retryable: false,
    suggestedAction: 'Inspect response body and logs',
    cause: originalError,
  });
}
