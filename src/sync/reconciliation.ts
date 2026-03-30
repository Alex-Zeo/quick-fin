/**
 * QBO-to-MCP reconciliation engine.
 *
 * Compares QBO query results against audit log entries to detect
 * discrepancies between what the MCP server processed and what
 * actually exists in QBO.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpClient {
  get(realmId: string, path: string): Promise<{ statusCode: number; body: unknown }>;
  query(realmId: string, query: string): Promise<{ statusCode: number; body: unknown }>;
}

export interface AuditLogProvider {
  getEntries(
    realmId: string,
    entityType: string,
    dateRange: DateRange,
  ): Promise<AuditEntry[]>;
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export interface AuditEntry {
  entityType: string;
  entityId: string;
  operation: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface ReconciliationMatch {
  entityType: string;
  entityId: string;
  qboLastUpdated: string;
  mcpLastOperation: string;
  mcpTimestamp: string;
}

export interface ReconciliationMismatch {
  entityType: string;
  entityId: string;
  reason: string;
  qboData?: Record<string, unknown>;
  mcpData?: AuditEntry;
}

export interface ReconciliationResult {
  realmId: string;
  dateRange: DateRange;
  entityTypes: string[];
  matched: ReconciliationMatch[];
  qboOnly: Array<{ entityType: string; entityId: string; lastUpdated: string }>;
  mcpOnly: Array<{ entityType: string; entityId: string; operation: string; timestamp: string }>;
  mismatched: ReconciliationMismatch[];
  summary: ReconciliationSummary;
}

export interface ReconciliationSummary {
  totalQBO: number;
  totalMCP: number;
  matchedCount: number;
  qboOnlyCount: number;
  mcpOnlyCount: number;
  mismatchedCount: number;
  reconciliationRate: number; // 0-1
}

interface QBOQueryResponse {
  QueryResponse?: {
    [key: string]: Array<Record<string, unknown>> | number | undefined;
    totalCount?: number;
  };
}

// ---------------------------------------------------------------------------
// ReconciliationEngine
// ---------------------------------------------------------------------------

export class ReconciliationEngine {
  private readonly auditLog: AuditLogProvider;

  /**
   * @param auditLog  Provider for audit log entries
   */
  constructor(auditLog: AuditLogProvider) {
    this.auditLog = auditLog;
  }

  /**
   * Run reconciliation for the given entity types and date range.
   *
   * @param realmId      QBO company ID
   * @param entityTypes  Entity types to reconcile
   * @param dateRange    Date range to compare
   * @param httpClient   HTTP client for QBO API calls
   */
  async run(
    realmId: string,
    entityTypes: string[],
    dateRange: DateRange,
    httpClient: HttpClient,
  ): Promise<ReconciliationResult> {
    const matched: ReconciliationMatch[] = [];
    const qboOnly: ReconciliationResult['qboOnly'] = [];
    const mcpOnly: ReconciliationResult['mcpOnly'] = [];
    const mismatched: ReconciliationMismatch[] = [];

    for (const entityType of entityTypes) {
      // Fetch QBO entities in date range
      const qboEntities = await this.fetchQBOEntities(
        realmId, entityType, dateRange, httpClient,
      );

      // Fetch MCP audit entries in date range
      const mcpEntries = await this.auditLog.getEntries(realmId, entityType, dateRange);

      // Build lookup maps
      const qboMap = new Map<string, Record<string, unknown>>();
      for (const entity of qboEntities) {
        const id = String(entity.Id ?? '');
        if (id) qboMap.set(id, entity);
      }

      const mcpMap = new Map<string, AuditEntry>();
      for (const entry of mcpEntries) {
        // Keep the latest operation per entity
        const existing = mcpMap.get(entry.entityId);
        if (!existing || entry.timestamp > existing.timestamp) {
          mcpMap.set(entry.entityId, entry);
        }
      }

      // Compare
      const allIds = new Set([...qboMap.keys(), ...mcpMap.keys()]);

      for (const id of allIds) {
        const qboEntity = qboMap.get(id);
        const mcpEntry = mcpMap.get(id);

        if (qboEntity && mcpEntry) {
          // Both exist — check for mismatches
          const qboMeta = qboEntity.MetaData as { LastUpdatedTime?: string } | undefined;
          const qboLastUpdated = qboMeta?.LastUpdatedTime ?? '';

          // Check SyncToken consistency
          const qboSyncToken = String(qboEntity.SyncToken ?? '');
          const mcpSyncToken = mcpEntry.payload?.SyncToken != null
            ? String(mcpEntry.payload.SyncToken)
            : undefined;

          if (mcpSyncToken && qboSyncToken && mcpSyncToken !== qboSyncToken) {
            mismatched.push({
              entityType,
              entityId: id,
              reason: `SyncToken mismatch: QBO=${qboSyncToken}, MCP=${mcpSyncToken} — entity was modified outside MCP`,
              qboData: qboEntity,
              mcpData: mcpEntry,
            });
          } else {
            matched.push({
              entityType,
              entityId: id,
              qboLastUpdated,
              mcpLastOperation: mcpEntry.operation,
              mcpTimestamp: mcpEntry.timestamp,
            });
          }
        } else if (qboEntity && !mcpEntry) {
          // Only in QBO — created/modified outside MCP
          const meta = qboEntity.MetaData as { LastUpdatedTime?: string } | undefined;
          qboOnly.push({
            entityType,
            entityId: id,
            lastUpdated: meta?.LastUpdatedTime ?? '',
          });
        } else if (!qboEntity && mcpEntry) {
          // Only in MCP audit — entity deleted from QBO or MCP has stale reference
          mcpOnly.push({
            entityType,
            entityId: id,
            operation: mcpEntry.operation,
            timestamp: mcpEntry.timestamp,
          });
        }
      }
    }

    const totalQBO = matched.length + qboOnly.length + mismatched.length;
    const totalMCP = matched.length + mcpOnly.length + mismatched.length;
    const total = Math.max(totalQBO, totalMCP, 1);

    return {
      realmId,
      dateRange,
      entityTypes,
      matched,
      qboOnly,
      mcpOnly,
      mismatched,
      summary: {
        totalQBO,
        totalMCP,
        matchedCount: matched.length,
        qboOnlyCount: qboOnly.length,
        mcpOnlyCount: mcpOnly.length,
        mismatchedCount: mismatched.length,
        reconciliationRate: matched.length / total,
      },
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async fetchQBOEntities(
    realmId: string,
    entityType: string,
    dateRange: DateRange,
    httpClient: HttpClient,
  ): Promise<Array<Record<string, unknown>>> {
    const allEntities: Array<Record<string, unknown>> = [];
    let startPosition = 1;
    const pageSize = 1000;

    while (true) {
      const sql = `SELECT * FROM ${entityType} WHERE MetaData.LastUpdatedTime >= '${dateRange.start}' AND MetaData.LastUpdatedTime <= '${dateRange.end}T23:59:59Z' STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`;

      try {
        const result = await httpClient.query(realmId, sql);
        const body = result.body as QBOQueryResponse;
        const entities = (body?.QueryResponse?.[entityType] as Array<Record<string, unknown>>) ?? [];

        allEntities.push(...entities);

        if (entities.length < pageSize) break;
        startPosition += pageSize;
      } catch {
        break;
      }
    }

    return allEntities;
  }
}
