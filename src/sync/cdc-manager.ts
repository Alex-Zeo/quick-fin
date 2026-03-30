/**
 * Change Data Capture (CDC) polling with truncation detection.
 *
 * QBO CDC endpoint returns changes since a given timestamp.
 * If any entity type returns exactly 1000 rows, the window may be
 * truncated — binary-search to find the safe boundary.
 */

import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpClient {
  get(realmId: string, path: string): Promise<{ statusCode: number; body: unknown }>;
  query(realmId: string, query: string): Promise<{ statusCode: number; body: unknown }>;
}

export interface CDCChange {
  entityType: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  lastUpdated: string;
  entity: Record<string, unknown>;
}

export interface CDCResult {
  changes: CDCChange[];
  since: string;
  until: string;
  truncated: boolean;
  entityCounts: Record<string, number>;
}

export interface CDCHealth {
  realmId: string;
  lastPoll: Date | null;
  staleness: number; // ms since last poll
  isStale: boolean;
  hasGaps: boolean;
}

interface CDCQueryResponseEntry {
  [entityType: string]: Array<Record<string, unknown>> | number | undefined;
}

interface CDCResponseBody {
  CDCResponse?: Array<{
    QueryResponse?: CDCQueryResponseEntry[];
  }>;
}

interface PollStateRow {
  realm_id: string;
  last_poll: string;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** QBO CDC truncation threshold */
const TRUNCATION_THRESHOLD = 1000;

/** Maximum staleness before health check reports stale (1 hour) */
const STALE_THRESHOLD_MS = 60 * 60 * 1000;

/** Binary search max iterations */
const MAX_BISECT_ITERATIONS = 10;

// ---------------------------------------------------------------------------
// CDCManager
// ---------------------------------------------------------------------------

export class CDCManager {
  private readonly db: Database.Database;

  /**
   * @param dbPath  Path to SQLite database for poll state persistence
   */
  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.init();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Poll for changes since the given timestamp.
   *
   * @param realmId    QBO company ID
   * @param entities   Entity types to poll (e.g. ['Invoice', 'Payment'])
   * @param since      ISO timestamp to poll from
   * @param httpClient HTTP client for QBO API calls
   */
  async poll(
    realmId: string,
    entities: string[],
    since: string,
    httpClient: HttpClient,
  ): Promise<CDCResult> {
    const until = new Date().toISOString();
    const entityList = entities.join(',');

    const response = await httpClient.get(
      realmId,
      `/cdc?changedSince=${encodeURIComponent(since)}&entities=${encodeURIComponent(entityList)}`,
    );

    const body = response.body as CDCResponseBody;
    const cdcResponses = body?.CDCResponse ?? [];

    const allChanges: CDCChange[] = [];
    const entityCounts: Record<string, number> = {};
    let truncated = false;

    for (const cdcResponse of cdcResponses) {
      const queryResponses = cdcResponse.QueryResponse ?? [];

      for (const queryResponse of queryResponses) {
        for (const entityType of entities) {
          const entityChanges = queryResponse[entityType] as Array<Record<string, unknown>> | undefined;
          if (!entityChanges) continue;

          entityCounts[entityType] = (entityCounts[entityType] ?? 0) + entityChanges.length;

          // Truncation detection
          if (entityChanges.length >= TRUNCATION_THRESHOLD) {
            truncated = true;
            // Binary search for the safe time boundary
            const safeChanges = await this.binarySearchWindow(
              realmId, entityType, since, until, httpClient,
            );
            allChanges.push(...safeChanges);
            entityCounts[entityType] = safeChanges.length;
          } else {
            for (const entity of entityChanges) {
              allChanges.push(this.toChange(entityType, entity));
            }
          }
        }
      }
    }

    // Deduplicate by (entityType, entityId), keeping the latest
    const deduped = this.deduplicate(allChanges);

    // Update poll state
    this.updatePollState(realmId, until);

    return {
      changes: deduped,
      since,
      until,
      truncated,
      entityCounts,
    };
  }

  /**
   * Get the last poll timestamp for a realm.
   */
  getLastPoll(realmId: string): Date | null {
    const row = this.db.prepare(
      'SELECT last_poll FROM cdc_poll_state WHERE realm_id = ?',
    ).get(realmId) as PollStateRow | undefined;

    return row ? new Date(row.last_poll) : null;
  }

  /**
   * Check CDC health for a realm.
   */
  checkHealth(realmId: string): CDCHealth {
    const lastPoll = this.getLastPoll(realmId);
    const now = Date.now();
    const staleness = lastPoll ? now - lastPoll.getTime() : Infinity;

    return {
      realmId,
      lastPoll,
      staleness,
      isStale: staleness > STALE_THRESHOLD_MS,
      hasGaps: lastPoll === null,
    };
  }

  /**
   * Shut down the manager.
   */
  destroy(): void {
    this.db.close();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private init(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cdc_poll_state (
        realm_id   TEXT PRIMARY KEY,
        last_poll  TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  private updatePollState(realmId: string, until: string): void {
    this.db.prepare(`
      INSERT INTO cdc_poll_state (realm_id, last_poll, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(realm_id) DO UPDATE SET
        last_poll = excluded.last_poll,
        updated_at = excluded.updated_at
    `).run(realmId, until, Date.now());
  }

  /**
   * Binary search to find the largest time window that doesn't truncate.
   */
  private async binarySearchWindow(
    realmId: string,
    entityType: string,
    since: string,
    until: string,
    httpClient: HttpClient,
  ): Promise<CDCChange[]> {
    let low = new Date(since).getTime();
    let high = new Date(until).getTime();
    let allChanges: CDCChange[] = [];

    for (let i = 0; i < MAX_BISECT_ITERATIONS; i++) {
      const mid = new Date(low + (high - low) / 2).toISOString();

      const response = await httpClient.get(
        realmId,
        `/cdc?changedSince=${encodeURIComponent(since)}&entities=${encodeURIComponent(entityType)}`,
      );

      const body = response.body as CDCResponseBody;
      const queryResponses = body?.CDCResponse?.[0]?.QueryResponse ?? [];

      let count = 0;
      const changes: CDCChange[] = [];

      for (const qr of queryResponses) {
        const entities = qr[entityType] as Array<Record<string, unknown>> | undefined;
        if (entities) {
          count += entities.length;
          for (const entity of entities) {
            changes.push(this.toChange(entityType, entity));
          }
        }
      }

      if (count < TRUNCATION_THRESHOLD) {
        // This window is safe — try expanding
        allChanges = changes;
        low = new Date(mid).getTime();
      } else {
        // Still truncated — narrow the window
        high = new Date(mid).getTime();
      }

      // If the window is less than 1 second, stop bisecting
      if (high - low < 1000) break;
    }

    // After bisecting, collect remaining changes from the unprocessed window
    if (allChanges.length > 0) {
      const lastTimestamp = allChanges[allChanges.length - 1].lastUpdated;
      if (new Date(lastTimestamp).getTime() < new Date(until).getTime()) {
        // Recursively poll the remaining window
        try {
          const remaining = await this.poll(
            realmId, [entityType], lastTimestamp,
            { get: (r, p) => httpClient.get(r, p), query: (r, q) => httpClient.query(r, q) },
          );
          allChanges.push(...remaining.changes);
        } catch {
          // Best-effort
        }
      }
    }

    return allChanges;
  }

  private toChange(entityType: string, entity: Record<string, unknown>): CDCChange {
    const metaData = entity.MetaData as { LastUpdatedTime?: string } | undefined;
    const status = entity.status as string | undefined;

    return {
      entityType,
      entityId: String(entity.Id ?? ''),
      operation: status === 'Deleted' ? 'delete' : (entity.Id ? 'update' : 'create'),
      lastUpdated: metaData?.LastUpdatedTime ?? new Date().toISOString(),
      entity,
    };
  }

  private deduplicate(changes: CDCChange[]): CDCChange[] {
    const map = new Map<string, CDCChange>();

    for (const change of changes) {
      const key = `${change.entityType}:${change.entityId}`;
      const existing = map.get(key);

      if (!existing || change.lastUpdated > existing.lastUpdated) {
        map.set(key, change);
      }
    }

    return Array.from(map.values());
  }
}
