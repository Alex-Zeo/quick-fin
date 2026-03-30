/**
 * Handler for report generation with auto-chunking and watermarking.
 */

import type { ToolContext, ToolResult } from '../accounting/entity-tools.js';
import {
  type ReportConfig,
  type ReportInput,
  buildReportParams,
  createReportWatermark,
  estimateCellCount,
  CELL_LIMIT_THRESHOLD,
} from './report-tools.js';

type HttpClient = {
  get<T>(realmId: string, path: string, options?: Record<string, unknown>): Promise<T>;
};

type AuditLog = {
  log(entry: Record<string, unknown>): string;
};

export interface ReportHandlerDeps {
  httpClient: HttpClient;
  auditLog: AuditLog;
}

function result(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

export class ReportHandler {
  // Simple in-memory cache with TTL
  private cache = new Map<string, { data: unknown; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private deps: ReportHandlerDeps) {}

  async handleReport(
    ctx: ToolContext,
    config: ReportConfig,
    input: ReportInput,
  ): Promise<ToolResult> {
    const params = buildReportParams(config, input);
    const queryString = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const path = `/v3/company/${input.realmId}/reports/${config.apiPath}${queryString ? `?${queryString}` : ''}`;

    // Check cache
    const cacheKey = `${input.realmId}:${config.apiPath}:${queryString}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const watermark = createReportWatermark(config, input);
      return result(JSON.stringify({ ...watermark, _cached: true, report: cached.data }, null, 2));
    }

    // Fetch report
    const data = await this.deps.httpClient.get<Record<string, unknown>>(
      input.realmId,
      path,
      { group: 'reports', timeout: 30000 },
    );

    // Check cell count
    const cellCount = estimateCellCount(data);
    if (cellCount > CELL_LIMIT_THRESHOLD) {
      // Auto-chunk by splitting date range
      const chunked = await this.autoChunkReport(ctx, config, input);
      if (chunked) return chunked;
    }

    // Cache the result
    this.cache.set(cacheKey, { data, expiresAt: Date.now() + this.CACHE_TTL_MS });

    // Audit log
    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: input.realmId,
      toolName: `qbo_report_${config.name.toLowerCase()}`,
      entityType: 'Report',
      operation: 'REPORT',
      responseStatus: 200,
    });

    // Add watermark
    const watermark = createReportWatermark(config, input);
    return result(JSON.stringify({ ...watermark, cellCount, report: data }, null, 2));
  }

  private async autoChunkReport(
    ctx: ToolContext,
    config: ReportConfig,
    input: ReportInput,
  ): Promise<ToolResult | null> {
    if (!input.start_date || !input.end_date) return null;

    const start = new Date(input.start_date);
    const end = new Date(input.end_date);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays <= 30) return null; // Can't chunk further

    // Split into 6-month windows
    const chunks: Array<{ start_date: string; end_date: string }> = [];
    const current = new Date(start);
    while (current < end) {
      const chunkEnd = new Date(current);
      chunkEnd.setMonth(chunkEnd.getMonth() + 6);
      if (chunkEnd > end) chunkEnd.setTime(end.getTime());

      chunks.push({
        start_date: current.toISOString().split('T')[0]!,
        end_date: chunkEnd.toISOString().split('T')[0]!,
      });

      current.setTime(chunkEnd.getTime());
      current.setDate(current.getDate() + 1);
    }

    // Fetch each chunk
    const results: unknown[] = [];
    for (const chunk of chunks) {
      const params = buildReportParams(config, { ...input, ...chunk });
      const queryString = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
      const path = `/v3/company/${input.realmId}/reports/${config.apiPath}?${queryString}`;

      const data = await this.deps.httpClient.get(input.realmId, path, {
        group: 'reports',
        timeout: 30000,
      });
      results.push({ period: `${chunk.start_date} to ${chunk.end_date}`, data });
    }

    const watermark = createReportWatermark(config, input);
    return result(JSON.stringify({
      ...watermark,
      _chunked: true,
      _chunkCount: chunks.length,
      _chunkReason: 'Report exceeded 300K cell threshold; split into 6-month windows',
      chunks: results,
    }, null, 2));
  }

  /** Invalidate cached reports when entities change */
  invalidateForEntityType(realmId: string, entityType: string) {
    // Map entity types to affected report types
    const entityToReports: Record<string, string[]> = {
      Invoice: ['ProfitAndLoss', 'ProfitAndLossDetail', 'BalanceSheet', 'AgedReceivables', 'AgedReceivableDetail', 'CustomerBalance', 'CustomerBalanceDetail', 'CustomerIncome', 'CustomerSales', 'TransactionList'],
      Bill: ['ProfitAndLoss', 'ProfitAndLossDetail', 'BalanceSheet', 'AgedPayables', 'AgedPayableDetail', 'VendorBalance', 'VendorBalanceDetail', 'VendorExpenses', 'TransactionList'],
      Payment: ['BalanceSheet', 'CashFlow', 'AgedReceivables', 'CustomerBalance', 'TransactionList'],
      BillPayment: ['BalanceSheet', 'CashFlow', 'AgedPayables', 'VendorBalance', 'TransactionList'],
      JournalEntry: ['ProfitAndLoss', 'BalanceSheet', 'TrialBalance', 'GeneralLedger', 'TransactionList'],
      SalesReceipt: ['ProfitAndLoss', 'BalanceSheet', 'CashFlow', 'CustomerSales', 'ItemSales', 'TransactionList'],
      Deposit: ['BalanceSheet', 'CashFlow', 'TransactionList'],
      Transfer: ['BalanceSheet', 'CashFlow', 'TransactionList'],
      Purchase: ['ProfitAndLoss', 'BalanceSheet', 'CashFlow', 'VendorExpenses', 'TransactionList'],
    };

    const affectedReports = entityToReports[entityType] ?? [];

    for (const [key] of this.cache) {
      const reportName = key.split(':')[1];
      if (reportName && affectedReports.includes(reportName)) {
        this.cache.delete(key);
      }
    }
  }
}
