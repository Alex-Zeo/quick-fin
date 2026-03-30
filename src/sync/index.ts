/**
 * Sync module — re-exports.
 */

export {
  CDCManager,
  type CDCChange,
  type CDCResult,
  type CDCHealth,
} from './cdc-manager.js';

export {
  WebhookProcessor,
  WebhookSignatureError,
  type WebhookEvent,
  type WebhookPayload,
  type EntityChangeHandler,
} from './webhook-processor.js';

export {
  ReconciliationEngine,
  type ReconciliationResult,
  type ReconciliationSummary,
  type ReconciliationMatch,
  type ReconciliationMismatch,
  type AuditLogProvider,
  type AuditEntry,
  type DateRange,
} from './reconciliation.js';
