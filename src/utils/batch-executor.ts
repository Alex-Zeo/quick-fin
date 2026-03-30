/**
 * Batch executor with per-item tracking and retry-failed helper.
 *
 * Wraps the QBO batch API endpoint, enforcing maximum batch size
 * and providing per-item success/error tracking.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchHttpClient {
  post<T>(realmId: string, path: string, body: unknown, options?: Record<string, unknown>): Promise<T>;
}

export interface BatchOperation {
  /** Unique identifier for this operation within the batch */
  bId: string;
  /** Operation type */
  operation: 'create' | 'update' | 'delete' | 'query';
  /** QBO entity type (e.g. 'Invoice', 'Customer') */
  entityType: string;
  /** Entity payload (for create/update/delete) */
  entity?: Record<string, unknown>;
  /** Query string (for query operations) */
  query?: string;
}

export interface BatchItemResult {
  /** Index in the original operations array */
  index: number;
  /** Batch item ID */
  bId: string;
  /** Success or error */
  status: 'success' | 'error';
  /** Returned entity on success */
  entity?: unknown;
  /** Error detail on failure */
  error?: unknown;
}

export interface BatchResult {
  items: BatchItemResult[];
  successCount: number;
  errorCount: number;
}

// ---------------------------------------------------------------------------
// BatchExecutor
// ---------------------------------------------------------------------------

export class BatchExecutor {
  private readonly maxBatchSize: number;

  /**
   * @param maxBatchSize  Maximum operations per batch (default 25, QBO limit)
   */
  constructor(maxBatchSize: number = 25) {
    this.maxBatchSize = maxBatchSize;
  }

  /**
   * Execute a batch of operations against the QBO batch API.
   *
   * @param realmId      QBO company ID
   * @param operations   Array of batch operations (max 25)
   * @param httpClient   HTTP client
   */
  async execute(
    realmId: string,
    operations: BatchOperation[],
    httpClient: BatchHttpClient,
  ): Promise<BatchResult> {
    if (operations.length === 0) {
      return { items: [], successCount: 0, errorCount: 0 };
    }

    if (operations.length > this.maxBatchSize) {
      throw new Error(
        `Batch size ${operations.length} exceeds maximum ${this.maxBatchSize}. Split into smaller batches.`,
      );
    }

    const payload = {
      BatchItemRequest: operations.map((op, index) => {
        const item: Record<string, unknown> = {
          bId: op.bId || String(index),
          operation: op.operation,
        };
        if (op.operation === 'query') {
          item.Query = op.query;
        } else {
          item[op.entityType] = op.entity;
        }
        return item;
      }),
    };

    const data = await httpClient.post<Record<string, unknown>>(
      realmId,
      `/v3/company/${realmId}/batch`,
      payload,
      { group: 'accounting-crud', timeout: 60000 },
    );

    const batchResponse = (data.BatchItemResponse ?? []) as Array<Record<string, unknown>>;

    // Map batch response items back to operations by bId
    const responseMap = new Map<string, Record<string, unknown>>();
    for (const item of batchResponse) {
      const bId = item.bId as string;
      if (bId) responseMap.set(bId, item);
    }

    const items: BatchItemResult[] = operations.map((op, index) => {
      const bId = op.bId || String(index);
      const responseItem = responseMap.get(bId);

      if (!responseItem) {
        return {
          index,
          bId,
          status: 'error' as const,
          error: { message: 'No response received for this batch item' },
        };
      }

      const hasFault = responseItem.Fault != null;
      return {
        index,
        bId,
        status: hasFault ? 'error' as const : 'success' as const,
        entity: hasFault ? undefined : responseItem,
        error: hasFault ? responseItem.Fault : undefined,
      };
    });

    return {
      items,
      successCount: items.filter((i) => i.status === 'success').length,
      errorCount: items.filter((i) => i.status === 'error').length,
    };
  }

  /**
   * Retry only the failed items from a previous batch result.
   *
   * @param realmId             QBO company ID
   * @param originalOperations  The original operations array
   * @param previousResult      Result from the previous execute() call
   * @param httpClient          HTTP client
   */
  async retryFailed(
    realmId: string,
    originalOperations: BatchOperation[],
    previousResult: BatchResult,
    httpClient: BatchHttpClient,
  ): Promise<BatchResult> {
    const failedBIds = new Set(
      previousResult.items
        .filter((i) => i.status === 'error')
        .map((i) => i.bId),
    );

    const retryOps = originalOperations.filter(
      (op, index) => failedBIds.has(op.bId || String(index)),
    );

    if (retryOps.length === 0) {
      return { items: [], successCount: 0, errorCount: 0 };
    }

    return this.execute(realmId, retryOps, httpClient);
  }
}
