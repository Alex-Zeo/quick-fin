/**
 * Evidence packaging for full audit trail per transaction.
 *
 * Bundles together the human instruction, AI reasoning, source document
 * references, validation results, and approval chain into a single
 * exportable package for compliance review.
 */

import type { AuditLogger, AuditRecord } from './audit-logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  rule: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ApprovalStep {
  approver: string;
  decision: 'approved' | 'rejected' | 'auto-approved';
  timestamp: string;
  reason?: string;
}

export interface EvidenceMetadata {
  humanInstruction: string;
  aiReasoning: string;
  sourceDocRefs: string[];
  validationResults: ValidationResult[];
  approvalChain: ApprovalStep[];
  qboTransactionId?: string;
}

export interface AuditEvidencePackage {
  /** Unique package identifier. */
  packageId: string;
  /** The audit log entry this package relates to. */
  auditEntry: AuditRecord;
  /** Human-readable instruction that triggered the action. */
  humanInstruction: string;
  /** AI model's reasoning/explanation for the action taken. */
  aiReasoning: string;
  /** References to source documents (e.g. invoice PDFs, receipts). */
  sourceDocRefs: string[];
  /** Validation checks that were run before the action. */
  validationResults: ValidationResult[];
  /** Chain of approvals (human or automated). */
  approvalChain: ApprovalStep[];
  /** QBO transaction ID if a write was committed. */
  qboTransactionId?: string;
  /** Timestamps for the full lifecycle. */
  timestamps: {
    instructionReceived: string;
    validationCompleted: string;
    approvalCompleted?: string;
    actionExecuted: string;
    packageCreated: string;
  };
}

export interface ExportFilters {
  startDate?: string;
  endDate?: string;
  realmId?: string;
  entityType?: string;
  toolName?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class EvidencePackager {
  private readonly logger: AuditLogger;

  constructor(logger: AuditLogger) {
    this.logger = logger;
  }

  /**
   * Create a full evidence package for a given audit entry.
   */
  createPackage(auditEntryId: number, metadata: EvidenceMetadata): AuditEvidencePackage {
    const entry = this.logger.getById(auditEntryId);
    if (!entry) {
      throw new Error(`Audit entry ${auditEntryId} not found`);
    }

    const now = new Date().toISOString();

    return {
      packageId: `EVD-${entry.realmId}-${entry.id}-${Date.now()}`,
      auditEntry: entry,
      humanInstruction: metadata.humanInstruction,
      aiReasoning: metadata.aiReasoning,
      sourceDocRefs: metadata.sourceDocRefs,
      validationResults: metadata.validationResults,
      approvalChain: metadata.approvalChain,
      qboTransactionId: metadata.qboTransactionId,
      timestamps: {
        instructionReceived: entry.timestamp,
        validationCompleted: entry.timestamp,
        approvalCompleted: metadata.approvalChain.length > 0
          ? metadata.approvalChain[metadata.approvalChain.length - 1]!.timestamp
          : undefined,
        actionExecuted: entry.timestamp,
        packageCreated: now,
      },
    };
  }

  /**
   * Export multiple evidence packages matching the given filters.
   *
   * @param filters  Query filters to select audit entries.
   * @param format   Output format: 'json' or 'csv'.
   * @returns Buffer containing the exported data.
   */
  exportPackages(filters: ExportFilters, format: 'json' | 'csv' = 'json'): Buffer {
    const records = this.logger.query({
      startDate: filters.startDate,
      endDate: filters.endDate,
      realmId: filters.realmId,
      entityType: filters.entityType,
      toolName: filters.toolName,
      limit: 10000,
    });

    if (format === 'json') {
      return this.exportJson(records);
    }

    return this.exportCsv(records);
  }

  // ── Export formats ──────────────────────────────────────────────────────

  private exportJson(records: AuditRecord[]): Buffer {
    const packages = records.map((record) => ({
      id: record.id,
      timestamp: record.timestamp,
      traceId: record.traceId,
      sessionId: record.sessionId,
      userId: record.userId,
      realmId: record.realmId,
      toolName: record.toolName,
      entityType: record.entityType,
      entityId: record.entityId,
      operation: record.operation,
      responseStatus: record.responseStatus,
      entryHash: record.entryHash,
      previousHash: record.previousHash,
      syncTokenBefore: record.syncTokenBefore,
      syncTokenAfter: record.syncTokenAfter,
      approvalRef: record.approvalRef,
      aiModelId: record.aiModelId,
    }));

    return Buffer.from(JSON.stringify(packages, null, 2), 'utf-8');
  }

  private exportCsv(records: AuditRecord[]): Buffer {
    const headers = [
      'id',
      'timestamp',
      'trace_id',
      'session_id',
      'user_id',
      'realm_id',
      'tool_name',
      'entity_type',
      'entity_id',
      'operation',
      'response_status',
      'entry_hash',
      'previous_hash',
      'sync_token_before',
      'sync_token_after',
      'approval_ref',
      'ai_model_id',
    ];

    const rows = records.map((r) => [
      r.id,
      csvEscape(r.timestamp),
      csvEscape(r.traceId),
      csvEscape(r.sessionId),
      csvEscape(r.userId),
      csvEscape(r.realmId),
      csvEscape(r.toolName),
      csvEscape(r.entityType),
      csvEscape(r.entityId),
      csvEscape(r.operation),
      r.responseStatus,
      csvEscape(r.entryHash),
      csvEscape(r.previousHash),
      csvEscape(r.syncTokenBefore ?? ''),
      csvEscape(r.syncTokenAfter ?? ''),
      csvEscape(r.approvalRef ?? ''),
      csvEscape(r.aiModelId ?? ''),
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    return Buffer.from(csv, 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
