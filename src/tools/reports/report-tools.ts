/**
 * MCP tools for all 30 QuickBooks Online report types.
 * Includes auto-chunking for reports exceeding 400K cell limit.
 */

import { z } from 'zod';
import type { ToolResult, ToolContext } from '../accounting/entity-tools.js';

/** All QBO report configurations */
export interface ReportConfig {
  name: string;
  apiPath: string;
  description: string;
  category: 'financial' | 'ar' | 'ap' | 'sales' | 'transaction' | 'tax' | 'other';
  supportsDateRange: boolean;
  useDueDates: boolean; // AP/AR aging uses start_duedate/end_duedate
  supportsAccountingMethod: boolean;
  supportsSummarizeBy: boolean;
}

export const REPORT_CONFIGS: ReportConfig[] = [
  // Financial Statements
  { name: 'ProfitAndLoss', apiPath: 'ProfitAndLoss', description: 'Profit and Loss (Income Statement)', category: 'financial', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: true, supportsSummarizeBy: true },
  { name: 'ProfitAndLossDetail', apiPath: 'ProfitAndLossDetail', description: 'Profit and Loss Detail', category: 'financial', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: true, supportsSummarizeBy: false },
  { name: 'BalanceSheet', apiPath: 'BalanceSheet', description: 'Balance Sheet', category: 'financial', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: true, supportsSummarizeBy: true },
  { name: 'CashFlow', apiPath: 'CashFlow', description: 'Statement of Cash Flows', category: 'financial', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: true },
  { name: 'TrialBalance', apiPath: 'TrialBalance', description: 'Trial Balance', category: 'financial', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: true, supportsSummarizeBy: false },
  { name: 'TrialBalanceFR', apiPath: 'TrialBalanceFR', description: 'Trial Balance (France)', category: 'financial', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: true, supportsSummarizeBy: false },
  { name: 'GeneralLedger', apiPath: 'GeneralLedger', description: 'General Ledger', category: 'financial', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'GeneralLedgerDetail', apiPath: 'GeneralLedgerDetail', description: 'General Ledger Detail', category: 'financial', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'JournalReport', apiPath: 'JournalReport', description: 'Journal Report', category: 'financial', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },

  // Accounts Receivable
  { name: 'AgedReceivables', apiPath: 'AgedReceivables', description: 'AR Aging Summary', category: 'ar', supportsDateRange: false, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'AgedReceivableDetail', apiPath: 'AgedReceivableDetail', description: 'AR Aging Detail', category: 'ar', supportsDateRange: false, useDueDates: true, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'CustomerBalance', apiPath: 'CustomerBalance', description: 'Customer Balance Summary', category: 'ar', supportsDateRange: false, useDueDates: false, supportsAccountingMethod: true, supportsSummarizeBy: false },
  { name: 'CustomerBalanceDetail', apiPath: 'CustomerBalanceDetail', description: 'Customer Balance Detail', category: 'ar', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'CustomerIncome', apiPath: 'CustomerIncome', description: 'Income by Customer', category: 'ar', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'CustomerSales', apiPath: 'CustomerSales', description: 'Sales by Customer', category: 'ar', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },

  // Accounts Payable
  { name: 'AgedPayables', apiPath: 'AgedPayables', description: 'AP Aging Summary', category: 'ap', supportsDateRange: false, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'AgedPayableDetail', apiPath: 'AgedPayableDetail', description: 'AP Aging Detail', category: 'ap', supportsDateRange: false, useDueDates: true, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'VendorBalance', apiPath: 'VendorBalance', description: 'Vendor Balance Summary', category: 'ap', supportsDateRange: false, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'VendorBalanceDetail', apiPath: 'VendorBalanceDetail', description: 'Vendor Balance Detail', category: 'ap', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'VendorExpenses', apiPath: 'VendorExpenses', description: 'Expenses by Vendor', category: 'ap', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },

  // Sales & Inventory
  { name: 'ItemSales', apiPath: 'ItemSales', description: 'Sales by Product/Service', category: 'sales', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'InventoryValuationSummary', apiPath: 'InventoryValuationSummary', description: 'Inventory Valuation Summary', category: 'sales', supportsDateRange: false, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'DepartmentSales', apiPath: 'DepartmentSales', description: 'Sales by Department', category: 'sales', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'ClassSales', apiPath: 'ClassSales', description: 'Sales by Class', category: 'sales', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },

  // Transaction Lists
  { name: 'TransactionList', apiPath: 'TransactionList', description: 'Transaction List', category: 'transaction', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'TransactionListWithSplits', apiPath: 'TransactionListWithSplits', description: 'Transaction List with Splits', category: 'transaction', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'TransactionListByCustomer', apiPath: 'TransactionListByCustomer', description: 'Transaction List by Customer', category: 'transaction', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },
  { name: 'TransactionListByVendor', apiPath: 'TransactionListByVendor', description: 'Transaction List by Vendor', category: 'transaction', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },

  // Tax
  { name: 'TaxSummary', apiPath: 'TaxSummary', description: 'Tax Summary', category: 'tax', supportsDateRange: true, useDueDates: false, supportsAccountingMethod: false, supportsSummarizeBy: false },

  // Other
  { name: 'AccountListDetail', apiPath: 'AccountListDetail', description: 'Account List Detail', category: 'other', supportsDateRange: false, useDueDates: false, supportsAccountingMethod: true, supportsSummarizeBy: false },
];

/** Common input schema for report tools */
const ReportInputSchema = z.object({
  realmId: z.string().describe('QuickBooks company ID'),
  start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
  end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
  date_macro: z.string().optional().describe('Predefined date range (Today, ThisMonth, ThisFiscalYear, etc.)'),
  accounting_method: z.enum(['Accrual', 'Cash']).optional().describe('Accounting method'),
  summarize_column_by: z.string().optional().describe('Column grouping (Total, Month, Week, Quarter, Year)'),
  customer: z.string().optional().describe('Filter by customer ID'),
  vendor: z.string().optional().describe('Filter by vendor ID'),
  department: z.string().optional().describe('Filter by department ID'),
  account: z.string().optional().describe('Filter by account ID'),
  columns: z.string().optional().describe('Comma-separated column names'),
  report_date: z.string().optional().describe('Report as-of date (YYYY-MM-DD)'),
  aging_period: z.number().optional().describe('Days per aging period'),
  num_periods: z.number().optional().describe('Number of aging periods'),
  start_duedate: z.string().optional().describe('Start due date for aging reports'),
  end_duedate: z.string().optional().describe('End due date for aging reports'),
});

export type ReportInput = z.infer<typeof ReportInputSchema>;

/** Generate MCP tool definitions for all reports */
export function generateReportTools() {
  return REPORT_CONFIGS.map((config) => ({
    name: `qbo_report_${config.name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')}`,
    description: `Generate ${config.description} report from QuickBooks Online. AI-generated reports are watermarked "SUBJECT TO VERIFICATION".`,
    inputSchema: ReportInputSchema,
    reportConfig: config,
  }));
}

/** Build query parameters for a report request */
export function buildReportParams(config: ReportConfig, input: ReportInput): Record<string, string> {
  const params: Record<string, string> = {};

  if (input.date_macro) params.date_macro = input.date_macro;
  if (config.supportsDateRange && input.start_date) params.start_date = input.start_date;
  if (config.supportsDateRange && input.end_date) params.end_date = input.end_date;
  if (config.useDueDates && input.start_duedate) params.start_duedate = input.start_duedate;
  if (config.useDueDates && input.end_duedate) params.end_duedate = input.end_duedate;
  if (config.supportsAccountingMethod && input.accounting_method) params.accounting_method = input.accounting_method;
  if (config.supportsSummarizeBy && input.summarize_column_by) params.summarize_column_by = input.summarize_column_by;
  if (input.customer) params.customer = input.customer;
  if (input.vendor) params.vendor = input.vendor;
  if (input.department) params.department = input.department;
  if (input.account) params.account = input.account;
  if (input.columns) params.columns = input.columns;
  if (input.report_date) params.report_date = input.report_date;
  if (input.aging_period) params.aging_period = String(input.aging_period);
  if (input.num_periods) params.num_periods = String(input.num_periods);

  return params;
}

/** Watermark metadata added to all report responses */
export function createReportWatermark(config: ReportConfig, input: ReportInput) {
  return {
    _watermark: 'GENERATED VIA AI INTEGRATION — SUBJECT TO VERIFICATION',
    _reportName: config.description,
    _generatedAt: new Date().toISOString(),
    _accountingMethod: input.accounting_method ?? 'Company default',
    _dateRange: input.start_date && input.end_date
      ? `${input.start_date} to ${input.end_date}`
      : input.date_macro ?? 'Default',
    _filters: {
      customer: input.customer,
      vendor: input.vendor,
      department: input.department,
      account: input.account,
    },
  };
}

/** Estimate cell count for pre-flight check */
export function estimateCellCount(reportData: Record<string, unknown>): number {
  const rows = reportData.Rows as { Row?: unknown[] } | undefined;
  const columns = reportData.Columns as { Column?: unknown[] } | undefined;
  const rowCount = rows?.Row?.length ?? 0;
  const colCount = columns?.Column?.length ?? 1;
  return rowCount * colCount;
}

/** Check if report needs chunking (>300K cells = 75% of 400K limit) */
export const CELL_LIMIT_THRESHOLD = 300_000;
