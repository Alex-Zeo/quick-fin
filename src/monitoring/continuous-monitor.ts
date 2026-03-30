/**
 * Continuous monitoring rule engine.
 *
 * Evaluates real-time events against configurable rules to detect
 * velocity spikes, split transactions, off-hours activity, and
 * new entity surges.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertSeverity = 'WARNING' | 'REVIEW' | 'CRITICAL';

export interface Alert {
  ruleId: string;
  severity: AlertSeverity;
  realmId: string;
  message: string;
  timestamp: string;
  meta: Record<string, unknown>;
}

export interface MonitorEvent {
  realmId: string;
  entityType: string;
  entityId: string;
  operation: string;
  amount?: number;
  timestamp: string;
  userId?: string;
  meta?: Record<string, unknown>;
}

export interface MonitorRule {
  id: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  evaluate(context: RuleContext, event: MonitorEvent): Alert | null;
}

export interface RuleContext {
  getRecentEvents(realmId: string, windowMs: number): MonitorEvent[];
  getEventCount(realmId: string, windowMs: number): number;
}

// ---------------------------------------------------------------------------
// Built-in rules
// ---------------------------------------------------------------------------

/**
 * Velocity spike: alerts when the event count in a time window
 * exceeds a threshold (indicating unusual batch activity).
 */
export function createVelocitySpikeRule(opts?: {
  windowMs?: number;
  threshold?: number;
  severity?: AlertSeverity;
}): MonitorRule {
  const windowMs = opts?.windowMs ?? 60 * 60 * 1000; // 1 hour
  const threshold = opts?.threshold ?? 50;
  const severity = opts?.severity ?? 'WARNING';

  return {
    id: 'velocity-spike',
    name: 'Velocity Spike Detection',
    description: `Alerts when more than ${threshold} events occur within ${windowMs / 60000} minutes`,
    severity,
    evaluate(context, event) {
      const count = context.getEventCount(event.realmId, windowMs);
      if (count >= threshold) {
        return {
          ruleId: 'velocity-spike',
          severity,
          realmId: event.realmId,
          message: `Velocity spike detected: ${count} events in the last ${windowMs / 60000} minutes (threshold: ${threshold})`,
          timestamp: event.timestamp,
          meta: { count, threshold, windowMs },
        };
      }
      return null;
    },
  };
}

/**
 * Split-transaction detection: alerts when multiple transactions
 * are created just below an approval threshold.
 */
export function createSplitTransactionRule(opts?: {
  thresholds?: number[];
  proximityPct?: number;
  windowMs?: number;
  minCount?: number;
  severity?: AlertSeverity;
}): MonitorRule {
  const thresholds = opts?.thresholds ?? [1000, 5000, 10000, 25000, 50000];
  const proximityPct = opts?.proximityPct ?? 15; // within 15% below threshold
  const windowMs = opts?.windowMs ?? 24 * 60 * 60 * 1000; // 24 hours
  const minCount = opts?.minCount ?? 3;
  const severity = opts?.severity ?? 'CRITICAL';

  return {
    id: 'split-transaction',
    name: 'Split Transaction Detection',
    description: `Alerts when ${minCount}+ transactions are just below approval thresholds`,
    severity,
    evaluate(context, event) {
      if (event.amount == null) return null;

      const recentEvents = context.getRecentEvents(event.realmId, windowMs);

      for (const threshold of thresholds) {
        const lowerBound = threshold * (1 - proximityPct / 100);
        const nearThreshold = recentEvents.filter(
          (e) => e.amount != null && e.amount >= lowerBound && e.amount < threshold,
        );

        if (nearThreshold.length >= minCount) {
          const totalAmount = nearThreshold.reduce((sum, e) => sum + (e.amount ?? 0), 0);
          return {
            ruleId: 'split-transaction',
            severity,
            realmId: event.realmId,
            message: `Possible split transaction: ${nearThreshold.length} transactions totaling ${totalAmount.toFixed(2)} are just below the ${threshold} threshold`,
            timestamp: event.timestamp,
            meta: {
              threshold,
              count: nearThreshold.length,
              totalAmount,
              transactions: nearThreshold.map((e) => ({
                entityId: e.entityId,
                amount: e.amount,
              })),
            },
          };
        }
      }

      return null;
    },
  };
}

/**
 * Off-hours activity: alerts on transactions created outside
 * business hours.
 */
export function createOffHoursRule(opts?: {
  startHour?: number; // UTC
  endHour?: number;   // UTC
  severity?: AlertSeverity;
}): MonitorRule {
  const startHour = opts?.startHour ?? 6;  // 6 AM UTC
  const endHour = opts?.endHour ?? 22;     // 10 PM UTC
  const severity = opts?.severity ?? 'WARNING';

  return {
    id: 'off-hours',
    name: 'Off-Hours Activity',
    description: `Alerts on activity outside ${startHour}:00-${endHour}:00 UTC`,
    severity,
    evaluate(_context, event) {
      const hour = new Date(event.timestamp).getUTCHours();

      if (hour < startHour || hour >= endHour) {
        return {
          ruleId: 'off-hours',
          severity,
          realmId: event.realmId,
          message: `Off-hours activity: ${event.operation} on ${event.entityType} ${event.entityId} at ${hour}:00 UTC`,
          timestamp: event.timestamp,
          meta: { hour, startHour, endHour, entityType: event.entityType, entityId: event.entityId },
        };
      }

      return null;
    },
  };
}

/**
 * New entity surge: alerts when many new entities of the same type
 * are created in a short window.
 */
export function createNewEntitySurgeRule(opts?: {
  windowMs?: number;
  threshold?: number;
  severity?: AlertSeverity;
}): MonitorRule {
  const windowMs = opts?.windowMs ?? 60 * 60 * 1000; // 1 hour
  const threshold = opts?.threshold ?? 20;
  const severity = opts?.severity ?? 'REVIEW';

  return {
    id: 'new-entity-surge',
    name: 'New Entity Surge',
    description: `Alerts when ${threshold}+ new entities of the same type are created within ${windowMs / 60000} minutes`,
    severity,
    evaluate(context, event) {
      if (event.operation !== 'CREATE' && event.operation !== 'Create') {
        return null;
      }

      const recentEvents = context.getRecentEvents(event.realmId, windowMs);
      const sameTypeCreates = recentEvents.filter(
        (e) =>
          e.entityType === event.entityType &&
          (e.operation === 'CREATE' || e.operation === 'Create'),
      );

      if (sameTypeCreates.length >= threshold) {
        return {
          ruleId: 'new-entity-surge',
          severity,
          realmId: event.realmId,
          message: `New entity surge: ${sameTypeCreates.length} new ${event.entityType} entities created in the last ${windowMs / 60000} minutes`,
          timestamp: event.timestamp,
          meta: {
            entityType: event.entityType,
            count: sameTypeCreates.length,
            threshold,
          },
        };
      }

      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// ContinuousMonitor
// ---------------------------------------------------------------------------

export class ContinuousMonitor implements RuleContext {
  private readonly rules: MonitorRule[] = [];
  private readonly eventBuffer = new Map<string, MonitorEvent[]>(); // realmId -> events
  private readonly maxBufferSize: number;
  private readonly bufferRetentionMs: number;

  constructor(opts?: { maxBufferSize?: number; bufferRetentionMs?: number }) {
    this.maxBufferSize = opts?.maxBufferSize ?? 10_000;
    this.bufferRetentionMs = opts?.bufferRetentionMs ?? 24 * 60 * 60 * 1000;
  }

  /**
   * Add a monitoring rule.
   */
  addRule(rule: MonitorRule): void {
    this.rules.push(rule);
  }

  /**
   * Evaluate an event against all rules.
   * Returns any triggered alerts.
   */
  evaluate(realmId: string, event: MonitorEvent): Alert[] {
    // Record the event
    this.recordEvent(event);

    // Evaluate all rules
    const alerts: Alert[] = [];
    for (const rule of this.rules) {
      try {
        const alert = rule.evaluate(this, event);
        if (alert) {
          alerts.push(alert);
        }
      } catch {
        // Rule evaluation failure should not block other rules
      }
    }

    return alerts;
  }

  // ── RuleContext implementation ───────────────────────────────────────────

  getRecentEvents(realmId: string, windowMs: number): MonitorEvent[] {
    const events = this.eventBuffer.get(realmId) ?? [];
    const cutoff = Date.now() - windowMs;
    return events.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
  }

  getEventCount(realmId: string, windowMs: number): number {
    return this.getRecentEvents(realmId, windowMs).length;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private recordEvent(event: MonitorEvent): void {
    const realmId = event.realmId;
    let events = this.eventBuffer.get(realmId);
    if (!events) {
      events = [];
      this.eventBuffer.set(realmId, events);
    }

    events.push(event);

    // Trim old events
    const cutoff = Date.now() - this.bufferRetentionMs;
    while (events.length > 0 && new Date(events[0].timestamp).getTime() < cutoff) {
      events.shift();
    }

    // Cap buffer size
    if (events.length > this.maxBufferSize) {
      events.splice(0, events.length - this.maxBufferSize);
    }
  }
}
