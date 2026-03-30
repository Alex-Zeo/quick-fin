/**
 * Governance layer — re-exports all modules.
 */

// RBAC
export {
  PermissionTier,
  Operation,
  checkPermission,
  requirePermission,
  assertTierCompatibility,
  PermissionDeniedError,
  type Session,
  type PermissionResult,
} from './rbac.js';

// Approval workflow
export {
  ApprovalWorkflow,
  ApprovalStatus,
  type ApprovalRequest,
  type ApprovalDecision,
  type ApprovalResult,
} from './approval-workflow.js';

// Segregation of duties
export {
  SoDEngine,
  type SoDContext,
  type SoDResult,
} from './sod-engine.js';

// Period controller
export {
  PeriodController,
  PeriodStage,
  type PeriodRecord,
  type WriteCheck,
} from './period-controller.js';

// Materiality engine
export {
  MaterialityEngine,
  MaterialityLevel,
  type MaterialityResult,
  type DailyTotals,
  type DailyLimitCheck,
} from './materiality-engine.js';

// Override detector
export {
  OverrideDetector,
  OverrideType,
  type Override,
  type OverrideBudget,
  type DateRange,
} from './override-detector.js';

// Control policy (orchestrator)
export {
  ControlPolicy,
  type PolicyPayload,
  type PolicyResult,
} from './control-policy.js';
