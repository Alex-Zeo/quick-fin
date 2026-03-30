/**
 * MCP tools for governance operations: approvals, audit, periods, reconciliation
 */

import { z } from 'zod';
import type { ToolResult, ToolContext } from '../accounting/entity-tools.js';

export function generateGovernanceTools() {
  return [
    {
      name: 'qbo_list_pending_approvals',
      description: 'List pending approval requests for a QuickBooks company. Shows operations awaiting human review.',
      inputSchema: z.object({
        realmId: z.string(),
        status: z.enum(['pending', 'approved', 'rejected', 'expired', 'all']).default('pending'),
      }),
    },
    {
      name: 'qbo_approve_operation',
      description: 'Approve a pending operation. Requires appropriate permission tier. Some operations need dual approval.',
      inputSchema: z.object({
        approvalId: z.string(),
        approverId: z.string(),
        comment: z.string().optional(),
      }),
    },
    {
      name: 'qbo_reject_operation',
      description: 'Reject a pending operation.',
      inputSchema: z.object({
        approvalId: z.string(),
        approverId: z.string(),
        reason: z.string().describe('Reason for rejection (required)'),
      }),
    },
    {
      name: 'qbo_audit_query',
      description: 'Search the immutable audit log. Filter by date, entity, user, session, or operation.',
      inputSchema: z.object({
        realmId: z.string().optional(),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        operation: z.string().optional(),
        sessionId: z.string().optional(),
        userId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        limit: z.number().default(50),
      }),
    },
    {
      name: 'qbo_verify_audit_chain',
      description: 'Verify the integrity of the audit log hash chain. Detects any tampering or gaps.',
      inputSchema: z.object({
        startId: z.number().optional(),
        endId: z.number().optional(),
      }),
    },
    {
      name: 'qbo_period_status',
      description: 'View the open/close status of accounting periods for a company.',
      inputSchema: z.object({
        realmId: z.string(),
        date: z.string().optional().describe('Specific date to check (YYYY-MM-DD)'),
      }),
    },
    {
      name: 'qbo_period_transition',
      description: 'Transition an accounting period to a new stage. Requires Controller+ permission.',
      inputSchema: z.object({
        realmId: z.string(),
        periodEnd: z.string().describe('Period end date (YYYY-MM-DD)'),
        newStage: z.enum(['preliminary_close', 'under_review', 'final_close', 'audit_adjustment']),
        justification: z.string().describe('Reason for transition'),
      }),
    },
    {
      name: 'qbo_reconciliation_run',
      description: 'Run a reconciliation comparing MCP audit log entries against QBO data.',
      inputSchema: z.object({
        realmId: z.string(),
        entityTypes: z.array(z.string()).describe('Entity types to reconcile'),
        startDate: z.string(),
        endDate: z.string(),
      }),
    },
    {
      name: 'qbo_duplicate_scan',
      description: 'Scan for potential duplicate transactions in a date range.',
      inputSchema: z.object({
        realmId: z.string(),
        entityType: z.string().describe('Entity type to scan (Invoice, Bill, Payment, etc.)'),
        startDate: z.string(),
        endDate: z.string(),
        threshold: z.number().default(0.8).describe('Similarity threshold (0-1)'),
      }),
    },
    {
      name: 'qbo_orphan_report',
      description: 'Find orphaned records: payments without invoices, deposits without payments, etc.',
      inputSchema: z.object({
        realmId: z.string(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    },
    {
      name: 'qbo_token_status',
      description: 'Check OAuth token expiry and health for connected companies.',
      inputSchema: z.object({
        realmId: z.string().optional().describe('Specific company, or omit for all'),
      }),
    },
    {
      name: 'qbo_fiscal_calendar',
      description: 'View fiscal calendar periods, quarters, and year-end dates for a company.',
      inputSchema: z.object({
        realmId: z.string(),
        year: z.number().optional().describe('Fiscal year (defaults to current)'),
      }),
    },
  ];
}

export function generateComplianceTools() {
  return [
    {
      name: 'qbo_vendor_1099_readiness',
      description: 'Check 1099 readiness: vendors with payments >$600 missing TIN, address, or 1099 flag.',
      inputSchema: z.object({
        realmId: z.string(),
        year: z.number().optional(),
      }),
    },
    {
      name: 'qbo_benfords_analysis',
      description: "Run Benford's law analysis on transaction amounts to detect potential data fabrication.",
      inputSchema: z.object({
        realmId: z.string(),
        entityType: z.string().default('JournalEntry'),
        startDate: z.string(),
        endDate: z.string(),
      }),
    },
    {
      name: 'qbo_je_anomaly_scan',
      description: 'Score journal entries for anomalies: unusual amounts, round numbers, threshold proximity, off-hours, rare accounts.',
      inputSchema: z.object({
        realmId: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        threshold: z.number().default(70).describe('Minimum anomaly score to include (0-100)'),
      }),
    },
    {
      name: 'qbo_related_party_check',
      description: 'Check transactions against related-party registry for disclosure requirements.',
      inputSchema: z.object({
        realmId: z.string(),
        startDate: z.string(),
        endDate: z.string(),
      }),
    },
    {
      name: 'qbo_close_readiness',
      description: 'Pre-close validation checklist: bank reconciliation, AR/AP, payroll, accruals status.',
      inputSchema: z.object({
        realmId: z.string(),
        periodEnd: z.string().describe('Period end date to check readiness for'),
      }),
    },
    {
      name: 'qbo_retention_status',
      description: 'Check record retention status: what records are approaching retention limits.',
      inputSchema: z.object({
        realmId: z.string().optional(),
      }),
    },
    {
      name: 'qbo_historical_scan',
      description: 'Run comprehensive anomaly scan on existing QBO data. Use on initial connection to establish baseline.',
      inputSchema: z.object({
        realmId: z.string(),
        entityTypes: z.array(z.string()).default(['JournalEntry', 'Invoice', 'Bill', 'Payment']),
        lookbackDays: z.number().default(365),
      }),
    },
    {
      name: 'qbo_report_change_log',
      description: 'Track changes in report outputs over time. Detect when previously generated reports would produce different numbers.',
      inputSchema: z.object({
        realmId: z.string(),
        reportType: z.string(),
        startDate: z.string(),
        endDate: z.string(),
      }),
    },
  ];
}
