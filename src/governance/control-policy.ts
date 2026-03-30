/**
 * Control policy — single-entry-point orchestrator for all governance checks.
 *
 * Evaluates RBAC, SoD, period status, materiality, and daily limits in
 * sequence. Returns a unified result: proceed, queue-for-approval, or denied.
 */

import type { Session } from './rbac.js';
import {
  checkPermission,
  type PermissionResult,
  Operation,
} from './rbac.js';
import type { SoDEngine, SoDContext, SoDResult } from './sod-engine.js';
import type { PeriodController, WriteCheck } from './period-controller.js';
import {
  type MaterialityEngine,
  MaterialityLevel,
  type MaterialityResult,
  type DailyLimitCheck,
} from './materiality-engine.js';
import type { ApprovalWorkflow } from './approval-workflow.js';
import type { OverrideDetector } from './override-detector.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicyPayload {
  /** Transaction date (YYYY-MM-DD) — used for period checks */
  txnDate?: string;
  /** Dollar amount — used for materiality classification */
  amount?: number;
  /** Entity ID (for SoD same-entity checks) */
  entityId?: string;
  /** Counterparty ID (for SoD same-counterparty checks) */
  counterpartyId?: string;
  /** Additional SoD context metadata */
  sodMeta?: Record<string, unknown>;
  /** Raw payload to store in approval request */
  rawPayload?: unknown;
}

export interface PolicyResult {
  /** Operation can proceed immediately */
  proceed: boolean;
  /** Operation must be queued for approval */
  queueForApproval: boolean;
  /** Operation is denied outright */
  denied: boolean;
  /** Human-readable reason */
  reason: string;
  /** If queued, the approval request ID */
  approvalRequestId?: string;
  /** Number of approvals required (1 or 2) */
  requiredApprovals?: number;
  /** Whether data should be masked for this tier */
  masked?: boolean;
  /** Detailed sub-results for audit/debugging */
  details: {
    rbac: PermissionResult;
    sod: SoDResult | null;
    period: WriteCheck | null;
    materiality: MaterialityResult | null;
    dailyLimits: DailyLimitCheck | null;
  };
}

// ---------------------------------------------------------------------------
// Write operations that need period checks
// ---------------------------------------------------------------------------

const WRITE_OPERATIONS = new Set<string>([
  Operation.CREATE,
  Operation.UPDATE,
  Operation.DELETE,
  Operation.VOID,
  Operation.BATCH,
  Operation.PAYMENT,
]);

// ---------------------------------------------------------------------------
// ControlPolicy class
// ---------------------------------------------------------------------------

export class ControlPolicy {
  private readonly sodEngine: SoDEngine;
  private readonly periodController: PeriodController;
  private readonly materialityEngine: MaterialityEngine;
  private readonly approvalWorkflow: ApprovalWorkflow;
  private readonly overrideDetector: OverrideDetector;

  constructor(deps: {
    sodEngine: SoDEngine;
    periodController: PeriodController;
    materialityEngine: MaterialityEngine;
    approvalWorkflow: ApprovalWorkflow;
    overrideDetector: OverrideDetector;
  }) {
    this.sodEngine = deps.sodEngine;
    this.periodController = deps.periodController;
    this.materialityEngine = deps.materialityEngine;
    this.approvalWorkflow = deps.approvalWorkflow;
    this.overrideDetector = deps.overrideDetector;
  }

  /**
   * Evaluate all governance controls for a proposed operation.
   *
   * Order:
   *   1. RBAC permission check
   *   2. Segregation of duties check
   *   3. Period status check (for write operations with a txnDate)
   *   4. Materiality classification (for operations with an amount)
   *   5. Daily velocity limits
   *   6. Combine results -> proceed / queue / deny
   */
  evaluate(
    session: Session,
    operation: Operation,
    entityType: string,
    payload: PolicyPayload = {},
  ): PolicyResult {
    // ── 1. RBAC ───────────────────────────────────────────────────────────
    const rbac = checkPermission(session, operation, entityType);
    if (!rbac.allowed) {
      return this.denied(rbac.reason, rbac, null, null, null, null);
    }

    // ── 2. Segregation of duties ──────────────────────────────────────────
    let sodResult: SoDResult | null = null;
    if (WRITE_OPERATIONS.has(operation)) {
      const sodCtx: SoDContext = {
        entityId: payload.entityId,
        counterpartyId: payload.counterpartyId,
        meta: payload.sodMeta,
      };
      sodResult = this.sodEngine.check(session, operation, entityType, sodCtx);
      if (!sodResult.ok) {
        return this.denied(
          `SoD conflict: ${sodResult.conflict!.message}`,
          rbac,
          sodResult,
          null,
          null,
          null,
        );
      }
    }

    // ── 3. Period status ──────────────────────────────────────────────────
    let periodResult: WriteCheck | null = null;
    if (WRITE_OPERATIONS.has(operation) && payload.txnDate) {
      periodResult = this.periodController.canWrite(
        session.realmId,
        payload.txnDate,
        operation,
      );
      if (!periodResult.allowed) {
        return this.denied(
          periodResult.reason,
          rbac,
          sodResult,
          periodResult,
          null,
          null,
        );
      }
    }

    // ── 4. Materiality classification ─────────────────────────────────────
    let materialityResult: MaterialityResult | null = null;
    let materialityNeedsApproval = false;
    let materialityNeedsDualApproval = false;

    if (payload.amount != null && payload.amount > 0) {
      materialityResult = this.materialityEngine.classify(entityType, payload.amount);
      if (materialityResult.level === MaterialityLevel.SINGLE_APPROVAL) {
        materialityNeedsApproval = true;
      } else if (materialityResult.level === MaterialityLevel.DUAL_APPROVAL) {
        materialityNeedsDualApproval = true;
      }
    }

    // ── 5. Daily limits ───────────────────────────────────────────────────
    let dailyResult: DailyLimitCheck | null = null;
    if (WRITE_OPERATIONS.has(operation) && payload.amount != null) {
      dailyResult = this.materialityEngine.checkDailyLimits(
        session.realmId,
        entityType,
        payload.amount,
        operation,
      );
      if (!dailyResult.allowed) {
        return this.denied(
          dailyResult.reason,
          rbac,
          sodResult,
          periodResult,
          materialityResult,
          dailyResult,
        );
      }
    }

    // ── 6. Combine: determine whether to proceed, queue, or deny ──────────
    const needsApproval =
      rbac.requiresApproval ||
      periodResult?.requiresApproval ||
      materialityNeedsApproval ||
      materialityNeedsDualApproval;

    const needsDualApproval =
      materialityNeedsDualApproval ||
      periodResult?.requiresDualAuth ||
      !!rbac.coApprovalTier;

    if (needsApproval) {
      const requiredApprovals = needsDualApproval ? 2 : 1;
      const approvalRequestId = this.approvalWorkflow.queueForApproval({
        realmId: session.realmId,
        sessionId: session.sessionId,
        requesterId: session.userId,
        operation,
        entityType,
        amount: payload.amount,
        payload: payload.rawPayload,
        requiredApprovals,
      });

      return {
        proceed: false,
        queueForApproval: true,
        denied: false,
        reason: `Queued for ${needsDualApproval ? 'dual' : 'single'} approval`,
        approvalRequestId,
        requiredApprovals,
        masked: rbac.masked,
        details: {
          rbac,
          sod: sodResult,
          period: periodResult,
          materiality: materialityResult,
          dailyLimits: dailyResult,
        },
      };
    }

    // All clear — proceed
    return {
      proceed: true,
      queueForApproval: false,
      denied: false,
      reason: 'All governance checks passed',
      masked: rbac.masked,
      details: {
        rbac,
        sod: sodResult,
        period: periodResult,
        materiality: materialityResult,
        dailyLimits: dailyResult,
      },
    };
  }

  /**
   * Record a successful operation in SoD history and daily aggregates.
   * Call this AFTER the operation succeeds.
   */
  recordCompletion(
    session: Session,
    operation: string,
    entityType: string,
    payload: PolicyPayload = {},
  ): void {
    // SoD tracking
    this.sodEngine.record(session, operation, entityType, {
      entityId: payload.entityId,
      counterpartyId: payload.counterpartyId,
      meta: payload.sodMeta,
    });

    // Daily aggregates
    if (payload.amount != null) {
      this.materialityEngine.recordTransaction(
        session.realmId,
        entityType,
        payload.amount,
        operation,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private denied(
    reason: string,
    rbac: PermissionResult,
    sod: SoDResult | null,
    period: WriteCheck | null,
    materiality: MaterialityResult | null,
    dailyLimits: DailyLimitCheck | null,
  ): PolicyResult {
    return {
      proceed: false,
      queueForApproval: false,
      denied: true,
      reason,
      masked: rbac.masked,
      details: { rbac, sod, period, materiality, dailyLimits },
    };
  }
}
