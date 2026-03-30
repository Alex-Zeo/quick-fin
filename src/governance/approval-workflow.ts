/**
 * Approval workflow — persistent queue backed by better-sqlite3.
 *
 * Supports single and dual approval, automatic expiry (4h), and
 * escalation alerts after 2h.
 */

import Database from 'better-sqlite3';
import { PermissionTier } from './rbac.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export interface ApprovalDecision {
  approverId: string;
  approverTier: PermissionTier;
  decidedAt: number; // epoch ms
  reason?: string;
}

export interface ApprovalRequest {
  id: string;
  realmId: string;
  sessionId: string;
  requesterId: string;
  operation: string;
  entityType: string;
  amount: number | null;
  payload: string; // JSON-serialised
  status: ApprovalStatus;
  requiredApprovals: number; // 1 = single, 2 = dual
  createdAt: number;
  expiresAt: number;
  escalateAt: number;
  approvals: ApprovalDecision[];
  rejections: ApprovalDecision[];
}

export interface ApprovalResult {
  status: ApprovalStatus;
  remainingApprovals: number;
  request: ApprovalRequest;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EXPIRY_MS = 4 * 60 * 60 * 1000;   // 4 hours
const ESCALATION_MS = 2 * 60 * 60 * 1000;        // 2 hours

// ---------------------------------------------------------------------------
// Schema initialisation
// ---------------------------------------------------------------------------

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id              TEXT PRIMARY KEY,
      realm_id        TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      requester_id    TEXT NOT NULL,
      operation       TEXT NOT NULL,
      entity_type     TEXT NOT NULL,
      amount          REAL,
      payload         TEXT NOT NULL DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'PENDING',
      required_approvals INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL,
      expires_at      INTEGER NOT NULL,
      escalate_at     INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_approval_realm_status
      ON approval_requests(realm_id, status);

    CREATE TABLE IF NOT EXISTS approval_decisions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id      TEXT NOT NULL REFERENCES approval_requests(id),
      approver_id     TEXT NOT NULL,
      approver_tier   INTEGER NOT NULL,
      decision        TEXT NOT NULL, -- 'APPROVE' | 'REJECT'
      reason          TEXT,
      decided_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_decision_request
      ON approval_decisions(request_id);
  `);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `apr_${ts}_${rand}`;
}

function rowToRequest(db: Database.Database, row: Record<string, unknown>): ApprovalRequest {
  const id = row['id'] as string;

  const decisionRows = db
    .prepare('SELECT * FROM approval_decisions WHERE request_id = ? ORDER BY decided_at')
    .all(id) as Array<Record<string, unknown>>;

  const approvals: ApprovalDecision[] = [];
  const rejections: ApprovalDecision[] = [];

  for (const d of decisionRows) {
    const decision: ApprovalDecision = {
      approverId: d['approver_id'] as string,
      approverTier: d['approver_tier'] as PermissionTier,
      decidedAt: d['decided_at'] as number,
      reason: (d['reason'] as string) || undefined,
    };
    if (d['decision'] === 'APPROVE') {
      approvals.push(decision);
    } else {
      rejections.push(decision);
    }
  }

  return {
    id,
    realmId: row['realm_id'] as string,
    sessionId: row['session_id'] as string,
    requesterId: row['requester_id'] as string,
    operation: row['operation'] as string,
    entityType: row['entity_type'] as string,
    amount: row['amount'] as number | null,
    payload: row['payload'] as string,
    status: row['status'] as ApprovalStatus,
    requiredApprovals: row['required_approvals'] as number,
    createdAt: row['created_at'] as number,
    expiresAt: row['expires_at'] as number,
    escalateAt: row['escalate_at'] as number,
    approvals,
    rejections,
  };
}

// ---------------------------------------------------------------------------
// ApprovalWorkflow class
// ---------------------------------------------------------------------------

export class ApprovalWorkflow {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    initSchema(this.db);
  }

  /**
   * Queue an operation for approval. Returns the request ID.
   */
  queueForApproval(params: {
    realmId: string;
    sessionId: string;
    requesterId: string;
    operation: string;
    entityType: string;
    amount?: number | null;
    payload?: unknown;
    requiredApprovals?: number;
  }): string {
    const id = generateId();
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO approval_requests
           (id, realm_id, session_id, requester_id, operation, entity_type, amount,
            payload, status, required_approvals, created_at, expires_at, escalate_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.realmId,
        params.sessionId,
        params.requesterId,
        params.operation,
        params.entityType,
        params.amount ?? null,
        JSON.stringify(params.payload ?? {}),
        ApprovalStatus.PENDING,
        params.requiredApprovals ?? 1,
        now,
        now + DEFAULT_EXPIRY_MS,
        now + ESCALATION_MS,
      );

    return id;
  }

  /**
   * Approve a pending request. Returns updated status.
   *
   * Dual-approval: if `requiredApprovals` is 2, two distinct approvers must approve.
   * The same person cannot approve twice, and the requester cannot self-approve.
   */
  approve(requestId: string, approverId: string, approverTier: PermissionTier): ApprovalResult {
    const request = this.getRequest(requestId);
    if (!request) {
      throw new Error(`Approval request ${requestId} not found`);
    }
    if (request.status !== ApprovalStatus.PENDING) {
      throw new Error(`Request ${requestId} is ${request.status}, cannot approve`);
    }

    // Self-approval guard
    if (request.requesterId === approverId) {
      throw new Error('Requester cannot approve their own request');
    }

    // Duplicate approver guard
    if (request.approvals.some((a) => a.approverId === approverId)) {
      throw new Error(`Approver ${approverId} has already approved this request`);
    }

    const now = Date.now();

    // Record the approval decision
    this.db
      .prepare(
        `INSERT INTO approval_decisions (request_id, approver_id, approver_tier, decision, decided_at)
         VALUES (?, ?, ?, 'APPROVE', ?)`,
      )
      .run(requestId, approverId, approverTier, now);

    const totalApprovals = request.approvals.length + 1;
    const remaining = request.requiredApprovals - totalApprovals;

    if (remaining <= 0) {
      this.db
        .prepare('UPDATE approval_requests SET status = ? WHERE id = ?')
        .run(ApprovalStatus.APPROVED, requestId);
    }

    const updated = this.getRequest(requestId)!;
    return {
      status: updated.status,
      remainingApprovals: Math.max(0, remaining),
      request: updated,
    };
  }

  /**
   * Reject a pending request.
   */
  reject(requestId: string, approverId: string, reason: string): void {
    const request = this.getRequest(requestId);
    if (!request) {
      throw new Error(`Approval request ${requestId} not found`);
    }
    if (request.status !== ApprovalStatus.PENDING) {
      throw new Error(`Request ${requestId} is ${request.status}, cannot reject`);
    }

    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO approval_decisions (request_id, approver_id, approver_tier, decision, reason, decided_at)
         VALUES (?, ?, ?, 'REJECT', ?, ?)`,
      )
      .run(requestId, approverId, 0, reason, now);

    this.db
      .prepare('UPDATE approval_requests SET status = ? WHERE id = ?')
      .run(ApprovalStatus.REJECTED, requestId);
  }

  /**
   * List all pending requests for a realm.
   */
  listPending(realmId: string): ApprovalRequest[] {
    const rows = this.db
      .prepare('SELECT * FROM approval_requests WHERE realm_id = ? AND status = ? ORDER BY created_at')
      .all(realmId, ApprovalStatus.PENDING) as Array<Record<string, unknown>>;

    return rows.map((r) => rowToRequest(this.db, r));
  }

  /**
   * Retrieve a single approval request by ID.
   */
  getRequest(requestId: string): ApprovalRequest | null {
    const row = this.db
      .prepare('SELECT * FROM approval_requests WHERE id = ?')
      .get(requestId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return rowToRequest(this.db, row);
  }

  /**
   * Scan for expired requests and mark them.
   * Returns the number of requests marked expired.
   */
  checkExpired(): number {
    const now = Date.now();
    const result = this.db
      .prepare('UPDATE approval_requests SET status = ? WHERE status = ? AND expires_at <= ?')
      .run(ApprovalStatus.EXPIRED, ApprovalStatus.PENDING, now);

    return result.changes;
  }

  /**
   * Return requests that have passed their escalation time but are still pending.
   */
  listEscalationDue(): ApprovalRequest[] {
    const now = Date.now();
    const rows = this.db
      .prepare(
        'SELECT * FROM approval_requests WHERE status = ? AND escalate_at <= ? AND expires_at > ? ORDER BY created_at',
      )
      .all(ApprovalStatus.PENDING, now, now) as Array<Record<string, unknown>>;

    return rows.map((r) => rowToRequest(this.db, r));
  }

  /**
   * Cancel a pending request (by the requester or an admin).
   */
  cancel(requestId: string): void {
    const request = this.getRequest(requestId);
    if (!request) {
      throw new Error(`Approval request ${requestId} not found`);
    }
    if (request.status !== ApprovalStatus.PENDING) {
      throw new Error(`Request ${requestId} is ${request.status}, cannot cancel`);
    }
    this.db
      .prepare('UPDATE approval_requests SET status = ? WHERE id = ?')
      .run(ApprovalStatus.CANCELLED, requestId);
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
