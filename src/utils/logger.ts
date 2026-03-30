/**
 * Structured logging via pino.
 *
 * Creates hierarchical loggers with base fields and child bindings
 * for request tracing, tenant scoping, and tool identification.
 */

import pino from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Logger = pino.Logger;

export interface LoggerConfig {
  /** Log level (default 'info') */
  logLevel?: string;
  /** Service name override */
  serviceName?: string;
  /** Version override */
  version?: string;
}

export interface ChildBindings {
  traceId?: string;
  realmId?: string;
  toolName?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a root logger with base fields.
 *
 * @param config  Logger configuration (or just a level string for backward compat)
 */
export function createLogger(config?: LoggerConfig | string): Logger {
  const opts: LoggerConfig = typeof config === 'string'
    ? { logLevel: config }
    : config ?? {};

  return pino({
    level: opts.logLevel ?? 'info',
    base: {
      service: opts.serviceName ?? 'quick-fin',
      version: opts.version ?? '0.1.0',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

/**
 * Create a child logger with request/tenant-specific bindings.
 *
 * @param parent    Parent logger
 * @param bindings  Child-specific fields (traceId, realmId, toolName, etc.)
 */
export function createChildLogger(
  parent: Logger,
  bindings: ChildBindings,
): Logger {
  return parent.child(bindings);
}
