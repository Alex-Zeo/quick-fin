/**
 * Infrastructure MCP tools: Batch, CDC, Query, Webhook, Connect, Health
 */

import { z } from 'zod';
import type { ToolResult, ToolContext } from '../accounting/entity-tools.js';

export function generateInfraTools() {
  return [
    {
      name: 'qbo_batch_execute',
      description: 'Execute a batch of up to 25 QBO operations. Operations exceeding threshold require dry-run preview first. Subject to aggregate controls.',
      inputSchema: z.object({
        realmId: z.string(),
        operations: z.array(z.object({
          bId: z.string(),
          operation: z.enum(['create', 'update', 'delete', 'query']),
          entityType: z.string(),
          entity: z.record(z.unknown()).optional(),
          query: z.string().optional(),
        })).max(25),
        dryRun: z.boolean().default(false).describe('Preview changes without executing'),
      }),
    },
    {
      name: 'qbo_cdc_poll',
      description: 'Poll for entity changes since a given timestamp using Change Data Capture. Max 30-day lookback.',
      inputSchema: z.object({
        realmId: z.string(),
        entities: z.array(z.string()).describe('Entity types to poll (e.g., ["Invoice", "Customer"])'),
        changedSince: z.string().describe('ISO datetime (e.g., 2024-01-01T00:00:00-08:00)'),
      }),
    },
    {
      name: 'qbo_query',
      description: 'Execute a free-form SQL-like query against QuickBooks Online. Auto-paginates and rewrites OR conditions.',
      inputSchema: z.object({
        realmId: z.string(),
        query: z.string().describe("SQL-like query (e.g., SELECT * FROM Invoice WHERE TxnDate > '2024-01-01')"),
        maxResults: z.number().default(100).optional(),
        fetchAll: z.boolean().default(false).describe('Auto-paginate to fetch all results'),
      }),
    },
    {
      name: 'qbo_webhook_status',
      description: 'Check webhook health: delivery stats, missed events, last received timestamp.',
      inputSchema: z.object({
        realmId: z.string(),
      }),
    },
    {
      name: 'qbo_connect',
      description: 'Initiate OAuth 2.0 connection to a QuickBooks Online company. Returns authorization URL.',
      inputSchema: z.object({
        state: z.string().optional().describe('CSRF state parameter'),
      }),
    },
    {
      name: 'qbo_disconnect',
      description: 'Disconnect a QuickBooks Online company. Revokes tokens and cleans up all state.',
      inputSchema: z.object({
        realmId: z.string(),
      }),
    },
    {
      name: 'qbo_company_info',
      description: 'Get company information and settings for a connected QuickBooks company.',
      inputSchema: z.object({
        realmId: z.string(),
      }),
    },
    {
      name: 'qbo_health',
      description: 'Check server health: token status, rate limits, circuit breakers, CDC status per tenant.',
      inputSchema: z.object({}),
    },
  ];
}

type HttpClient = {
  get<T>(realmId: string, path: string, options?: Record<string, unknown>): Promise<T>;
  post<T>(realmId: string, path: string, body: unknown, options?: Record<string, unknown>): Promise<T>;
};

type AuditLog = {
  log(entry: Record<string, unknown>): string;
};

export interface InfraHandlerDeps {
  httpClient: HttpClient;
  auditLog: AuditLog;
}

function result(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

export class InfraHandler {
  constructor(private deps: InfraHandlerDeps) {}

  async handleBatch(ctx: ToolContext, params: Record<string, unknown>): Promise<ToolResult> {
    const realmId = params.realmId as string;
    const operations = params.operations as Array<Record<string, unknown>>;
    const dryRun = params.dryRun as boolean;

    if (operations.length > 25) {
      return result('Batch size exceeds maximum of 25 operations.', true);
    }

    if (dryRun) {
      return result(JSON.stringify({
        dryRun: true,
        operationCount: operations.length,
        operations: operations.map((op, i) => ({
          index: i,
          bId: op.bId,
          operation: op.operation,
          entityType: op.entityType,
          preview: 'Would execute ' + op.operation + ' on ' + op.entityType,
        })),
        message: 'Dry run complete. Set dryRun=false to execute.',
      }, null, 2));
    }

    const batchPayload = {
      BatchItemRequest: operations.map((op) => {
        const item: Record<string, unknown> = {
          bId: op.bId,
          operation: op.operation,
        };
        if (op.operation === 'query') {
          item.Query = op.query;
        } else {
          item[op.entityType as string] = op.entity;
        }
        return item;
      }),
    };

    const data = await this.deps.httpClient.post<Record<string, unknown>>(
      realmId,
      `/v3/company/${realmId}/batch`,
      batchPayload,
      { group: 'accounting-crud', timeout: 60000 },
    );

    const batchResponse = data.BatchItemResponse as Array<Record<string, unknown>> | undefined;

    // Per-item result tracking
    const items = (batchResponse ?? []).map((item, index) => ({
      index,
      bId: item.bId as string,
      status: item.Fault ? 'error' as const : 'success' as const,
      entity: item.Fault ? undefined : item,
      error: item.Fault ? item.Fault : undefined,
    }));

    const successCount = items.filter((i) => i.status === 'success').length;
    const errorCount = items.filter((i) => i.status === 'error').length;

    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId,
      toolName: 'qbo_batch_execute',
      entityType: 'Batch',
      operation: 'BATCH',
      responseStatus: 200,
    });

    return result(JSON.stringify({
      totalOperations: operations.length,
      succeeded: successCount,
      failed: errorCount,
      items,
      retryCommand: errorCount > 0
        ? 'Use the failed items to construct a retry batch with only the failed operations.'
        : undefined,
    }, null, 2));
  }

  async handleCDC(ctx: ToolContext, params: Record<string, unknown>): Promise<ToolResult> {
    const realmId = params.realmId as string;
    const entities = (params.entities as string[]).join(',');
    const changedSince = params.changedSince as string;

    // Validate 30-day lookback
    const sinceDate = new Date(changedSince);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    if (sinceDate < thirtyDaysAgo) {
      return result('CDC lookback cannot exceed 30 days. Adjust changedSince to be within the last 30 days.', true);
    }

    const data = await this.deps.httpClient.get<Record<string, unknown>>(
      realmId,
      `/v3/company/${realmId}/cdc?entities=${encodeURIComponent(entities)}&changedSince=${encodeURIComponent(changedSince)}`,
      { group: 'accounting-crud' },
    );

    // Check for truncation (1000 objects per entity type)
    const cdcResponse = data.CDCResponse as Array<Record<string, unknown>> | undefined;
    const truncationWarnings: string[] = [];

    if (cdcResponse?.[0]) {
      const queryResponses = cdcResponse[0].QueryResponse as Array<Record<string, unknown>> | undefined;
      if (queryResponses) {
        for (const qr of queryResponses) {
          for (const [entityType, entities] of Object.entries(qr)) {
            if (Array.isArray(entities) && entities.length === 1000) {
              truncationWarnings.push(
                `${entityType}: returned exactly 1000 items — results may be truncated. ` +
                `Narrow the changedSince window to avoid missing changes.`,
              );
            }
          }
        }
      }
    }

    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId,
      toolName: 'qbo_cdc_poll',
      entityType: 'CDC',
      operation: 'CDC_POLL',
      responseStatus: 200,
    });

    return result(JSON.stringify({
      changedSince,
      truncationWarnings: truncationWarnings.length > 0 ? truncationWarnings : undefined,
      data,
    }, null, 2));
  }

  async handleQuery(ctx: ToolContext, params: Record<string, unknown>): Promise<ToolResult> {
    const realmId = params.realmId as string;
    let query = params.query as string;
    const fetchAll = params.fetchAll as boolean;
    const maxResults = Math.min((params.maxResults as number) ?? 100, 1000);

    // Add MAXRESULTS if not present
    if (!/MAXRESULTS/i.test(query)) {
      query += ` MAXRESULTS ${maxResults}`;
    }

    if (fetchAll) {
      // Auto-paginate
      const allResults: unknown[] = [];
      let startPosition = 1;
      let hasMore = true;

      while (hasMore) {
        const paginatedQuery = query.replace(/STARTPOSITION \d+/i, '') + ` STARTPOSITION ${startPosition}`;
        const data = await this.deps.httpClient.get<Record<string, unknown>>(
          realmId,
          `/v3/company/${realmId}/query?query=${encodeURIComponent(paginatedQuery)}`,
          { group: 'accounting-crud' },
        );

        const qr = data.QueryResponse as Record<string, unknown> | undefined;
        if (!qr) break;

        // Extract entities (first non-metadata key)
        for (const [key, value] of Object.entries(qr)) {
          if (Array.isArray(value)) {
            allResults.push(...value);
            if (value.length < maxResults) {
              hasMore = false;
            }
            break;
          }
        }

        startPosition += maxResults;
        if (allResults.length >= 10000) {
          hasMore = false; // Safety limit
        }
      }

      return result(JSON.stringify({
        totalFetched: allResults.length,
        results: allResults,
        paginatedAutomatically: true,
      }, null, 2));
    }

    const data = await this.deps.httpClient.get(
      realmId,
      `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`,
      { group: 'accounting-crud' },
    );

    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId,
      toolName: 'qbo_query',
      entityType: 'Query',
      operation: 'QUERY',
      responseStatus: 200,
    });

    return result(JSON.stringify(data, null, 2));
  }

  async handleCompanyInfo(ctx: ToolContext, params: Record<string, unknown>): Promise<ToolResult> {
    const realmId = params.realmId as string;
    const data = await this.deps.httpClient.get(
      realmId,
      `/v3/company/${realmId}/companyinfo/${realmId}`,
      { group: 'accounting-crud' },
    );

    return result(JSON.stringify(data, null, 2));
  }
}
