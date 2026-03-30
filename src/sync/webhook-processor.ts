/**
 * Webhook handler for QBO real-time notifications.
 *
 * Verifies HMAC-SHA256 signatures, deduplicates events, and
 * processes them via an in-memory queue (no Redis dependency).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpClient {
  get(realmId: string, path: string): Promise<{ statusCode: number; body: unknown }>;
  query(realmId: string, query: string): Promise<{ statusCode: number; body: unknown }>;
}

export interface WebhookEvent {
  realmId: string;
  name: string; // entity type
  id: string;   // entity ID
  operation: 'Create' | 'Update' | 'Delete' | 'Merge' | 'Void';
  lastUpdated: string;
}

export interface WebhookPayload {
  eventNotifications?: Array<{
    realmId: string;
    dataChangeEvent?: {
      entities?: Array<{
        name: string;
        id: string;
        operation: string;
        lastUpdated: string;
      }>;
    };
  }>;
}

export type EntityChangeHandler = (
  event: WebhookEvent,
  entity: Record<string, unknown> | null,
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Dedup TTL: 24 hours in ms */
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

/** Max queue size before dropping events */
const MAX_QUEUE_SIZE = 10_000;

// ---------------------------------------------------------------------------
// WebhookProcessor
// ---------------------------------------------------------------------------

export class WebhookProcessor {
  private readonly verifierToken: string;
  private readonly queue: WebhookEvent[] = [];
  private readonly dedupSet = new Map<string, number>(); // key -> timestamp
  private readonly handlers: EntityChangeHandler[] = [];
  private processing = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param verifierToken  HMAC secret from Intuit webhook configuration
   */
  constructor(verifierToken: string) {
    this.verifierToken = verifierToken;
    this.startCleanup();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Handle an incoming webhook request.
   * Validates HMAC signature, parses events, deduplicates, and enqueues.
   *
   * @param body       Raw request body (string)
   * @param signature  The `intuit-signature` header value
   */
  async handleRequest(body: string, signature: string): Promise<void> {
    // HMAC-SHA256 verification
    if (!this.verifySignature(body, signature)) {
      throw new WebhookSignatureError('Invalid webhook signature');
    }

    const payload: WebhookPayload = JSON.parse(body);
    const notifications = payload.eventNotifications ?? [];

    for (const notification of notifications) {
      const realmId = notification.realmId;
      const entities = notification.dataChangeEvent?.entities ?? [];

      for (const entity of entities) {
        const event: WebhookEvent = {
          realmId,
          name: entity.name,
          id: entity.id,
          operation: entity.operation as WebhookEvent['operation'],
          lastUpdated: entity.lastUpdated,
        };

        // Dedup check
        const dedupKey = `${realmId}:${entity.name}:${entity.id}:${entity.lastUpdated}`;
        if (this.dedupSet.has(dedupKey)) {
          continue;
        }

        // Record in dedup set
        this.dedupSet.set(dedupKey, Date.now());

        // Enqueue
        if (this.queue.length < MAX_QUEUE_SIZE) {
          this.queue.push(event);
        }
      }
    }
  }

  /**
   * Process the event queue.
   * Fetches full entities from QBO and notifies handlers.
   *
   * @param httpClient  HTTP client for fetching entities
   */
  async processQueue(httpClient?: HttpClient): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;

    let processed = 0;

    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift()!;
        let entity: Record<string, unknown> | null = null;

        // Fetch full entity if httpClient is available and it's not a delete
        if (httpClient && event.operation !== 'Delete') {
          try {
            const result = await httpClient.get(
              event.realmId,
              `/${event.name.toLowerCase()}/${event.id}`,
            );
            const body = result.body as Record<string, unknown>;
            entity = (body[event.name] as Record<string, unknown>) ?? null;
          } catch {
            // Entity fetch failed — still notify handlers with null entity
          }
        }

        // Notify all handlers
        for (const handler of this.handlers) {
          try {
            await handler(event, entity);
          } catch {
            // Individual handler errors shouldn't stop processing
          }
        }

        processed++;
      }
    } finally {
      this.processing = false;
    }

    return processed;
  }

  /**
   * Register a handler for entity change events.
   */
  onEntityChange(handler: EntityChangeHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Current queue depth.
   */
  get queueDepth(): number {
    return this.queue.length;
  }

  /**
   * Shut down the processor.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.queue.length = 0;
    this.dedupSet.clear();
    this.handlers.length = 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private verifySignature(body: string, signature: string): boolean {
    try {
      const expected = createHmac('sha256', this.verifierToken)
        .update(body)
        .digest('base64');

      const sig = Buffer.from(signature, 'base64');
      const exp = Buffer.from(expected, 'base64');

      if (sig.length !== exp.length) return false;
      return timingSafeEqual(sig, exp);
    } catch {
      return false;
    }
  }

  private startCleanup(): void {
    // Clean expired dedup entries every 10 minutes
    this.cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - DEDUP_TTL_MS;
      for (const [key, timestamp] of this.dedupSet) {
        if (timestamp < cutoff) {
          this.dedupSet.delete(key);
        }
      }
    }, 10 * 60 * 1000);

    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}
