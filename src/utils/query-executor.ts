/**
 * QBO query helper with auto-pagination and OR rewriting.
 *
 * Supports time-based cursor pagination using MetaData.LastUpdatedTime,
 * STARTPOSITION fallback for complex WHERE clauses, and OR rewriting
 * that splits OR conditions into parallel queries and merges results.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryHttpClient {
  get<T>(realmId: string, path: string, options?: Record<string, unknown>): Promise<T>;
}

export interface QueryOptions {
  /** Maximum results per page (default 1000, max 1000) */
  maxResults?: number;
  /** Fetch all pages (default true) */
  fetchAll?: boolean;
  /** Request timeout in ms */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// QueryExecutor
// ---------------------------------------------------------------------------

export class QueryExecutor {
  /**
   * Execute a paginated QBO query, yielding pages of results.
   *
   * Uses time-based cursor pagination when possible (orderBy on
   * MetaData.LastUpdatedTime), falling back to STARTPOSITION for
   * complex WHERE clauses.
   *
   * @param realmId     QBO company ID
   * @param entityType  Entity type (e.g. 'Invoice', 'Customer')
   * @param where       Optional WHERE clause
   * @param orderBy     Optional ORDER BY clause
   * @param httpClient  HTTP client
   * @param options     Pagination and timeout options
   */
  async *query<T>(
    realmId: string,
    entityType: string,
    where: string | undefined,
    orderBy: string | undefined,
    httpClient: QueryHttpClient,
    options: QueryOptions = {},
  ): AsyncGenerator<T[]> {
    const maxResults = Math.min(options.maxResults ?? 1000, 1000);
    const fetchAll = options.fetchAll !== false;

    // Check if OR rewriting is needed
    if (where && /\bOR\b/i.test(where)) {
      yield* this.queryWithOrRewrite<T>(realmId, entityType, where, orderBy, httpClient, options);
      return;
    }

    // Try time-based cursor pagination for simple cases
    const useTimeCursor = !where || !/STARTPOSITION/i.test(where);
    const effectiveOrderBy = orderBy ?? (useTimeCursor ? 'MetaData.LastUpdatedTime ASC' : undefined);

    let startPosition = 1;
    let lastTimestamp: string | undefined;
    let hasMore = true;

    while (hasMore) {
      let q = `SELECT * FROM ${entityType}`;

      if (useTimeCursor && lastTimestamp && !where) {
        // Time-based cursor: use LastUpdatedTime > last seen
        q += ` WHERE MetaData.LastUpdatedTime > '${lastTimestamp}'`;
      } else if (useTimeCursor && lastTimestamp && where) {
        q += ` WHERE ${where} AND MetaData.LastUpdatedTime > '${lastTimestamp}'`;
      } else if (where) {
        q += ` WHERE ${where}`;
      }

      if (effectiveOrderBy) q += ` ORDERBY ${effectiveOrderBy}`;

      // Fallback to STARTPOSITION when not using time cursor
      if (!useTimeCursor || !lastTimestamp) {
        q += ` STARTPOSITION ${startPosition}`;
      }

      q += ` MAXRESULTS ${maxResults}`;

      const data = await httpClient.get<Record<string, unknown>>(
        realmId,
        `/v3/company/${realmId}/query?query=${encodeURIComponent(q)}`,
        { group: 'accounting-crud', timeout: options.timeout ?? 10000 },
      );

      const qr = data.QueryResponse as Record<string, unknown> | undefined;
      const entities = (qr?.[entityType] ?? []) as T[];

      if (entities.length > 0) {
        yield entities;

        // Extract last timestamp for cursor-based pagination
        if (useTimeCursor) {
          const lastEntity = entities[entities.length - 1] as Record<string, unknown>;
          const metaData = lastEntity?.MetaData as { LastUpdatedTime?: string } | undefined;
          if (metaData?.LastUpdatedTime) {
            lastTimestamp = metaData.LastUpdatedTime;
          }
        }
      }

      hasMore = fetchAll && entities.length === maxResults;
      startPosition += maxResults;

      // Safety: cap at 100 pages
      if (startPosition > 100_000) break;
    }
  }

  /**
   * Count entities matching a query.
   */
  async count(
    realmId: string,
    entityType: string,
    where: string | undefined,
    httpClient: QueryHttpClient,
  ): Promise<number> {
    let q = `SELECT COUNT(*) FROM ${entityType}`;
    if (where) q += ` WHERE ${where}`;

    const data = await httpClient.get<Record<string, unknown>>(
      realmId,
      `/v3/company/${realmId}/query?query=${encodeURIComponent(q)}`,
      { group: 'accounting-crud' },
    );

    const qr = data.QueryResponse as { totalCount?: number } | undefined;
    return qr?.totalCount ?? 0;
  }

  /**
   * Rewrite OR conditions into parallel queries, merging deduplicated results.
   * Splits "A OR B OR C" into three separate queries and deduplicates by entity ID.
   */
  rewriteOR(query: string): string[] {
    if (!/\bOR\b/i.test(query)) return [query];

    const parts = query.split(/\bOR\b/i).map((p) => p.trim());
    return parts.map((part) => {
      if (!part.startsWith('SELECT')) {
        const baseMatch = query.match(/^(SELECT\s+.*?\s+FROM\s+\w+\s+WHERE\s+)/i);
        if (baseMatch) return baseMatch[1] + part;
      }
      return part;
    });
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async *queryWithOrRewrite<T>(
    realmId: string,
    entityType: string,
    where: string,
    orderBy: string | undefined,
    httpClient: QueryHttpClient,
    options: QueryOptions,
  ): AsyncGenerator<T[]> {
    // Split OR into separate conditions
    const conditions = where.split(/\bOR\b/i).map((c) => c.trim());

    // Track seen IDs for deduplication
    const seenIds = new Set<string>();

    for (const condition of conditions) {
      const subGenerator = this.query<T>(
        realmId, entityType, condition, orderBy, httpClient, options,
      );

      for await (const page of subGenerator) {
        const deduped = page.filter((entity) => {
          const id = (entity as Record<string, unknown>).Id as string | undefined;
          if (!id || seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
        });

        if (deduped.length > 0) {
          yield deduped;
        }
      }
    }
  }
}
