/**
 * Field-level PII masking based on data classification tiers.
 *
 * Masks entity fields according to the caller's access tier, using
 * the classification from `data-classification.ts`. Supports nested
 * objects and arrays.
 */

import { DataTier, getFieldTier } from './data-classification.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Access tier of the requesting principal. Higher = more access. */
export enum AccessLevel {
  /** Can see PUBLIC fields only. */
  PUBLIC = 0,
  /** Can see PUBLIC + INTERNAL fields. */
  INTERNAL = 1,
  /** Can see PUBLIC + INTERNAL + CONFIDENTIAL fields. */
  CONFIDENTIAL = 2,
  /** Can see all fields including RESTRICTED. */
  RESTRICTED = 3,
}

// Map DataTier to the minimum AccessLevel required to see it
const TIER_TO_LEVEL: Record<DataTier, AccessLevel> = {
  [DataTier.PUBLIC]: AccessLevel.PUBLIC,
  [DataTier.INTERNAL]: AccessLevel.INTERNAL,
  [DataTier.CONFIDENTIAL]: AccessLevel.CONFIDENTIAL,
  [DataTier.RESTRICTED]: AccessLevel.RESTRICTED,
};

// ---------------------------------------------------------------------------
// Masking strategies
// ---------------------------------------------------------------------------

/**
 * Mask a value based on its data tier.
 *
 * - RESTRICTED: last 4 characters visible (`***-**-1234`)
 * - CONFIDENTIAL: replaced with `[REDACTED]`
 * - INTERNAL: replaced with `[HIDDEN]`
 */
function maskValue(value: unknown, tier: DataTier): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    switch (tier) {
      case DataTier.RESTRICTED: {
        if (value.length <= 4) return '****';
        // SSN-like: ***-**-1234
        if (/^\d{3}-?\d{2}-?\d{4}$/.test(value)) {
          const last4 = value.replace(/\D/g, '').slice(-4);
          return `***-**-${last4}`;
        }
        // Generic: show last 4
        const last4 = value.slice(-4);
        return `${'*'.repeat(Math.max(value.length - 4, 4))}${last4}`;
      }
      case DataTier.CONFIDENTIAL:
        return '[REDACTED]';
      case DataTier.INTERNAL:
        return '[HIDDEN]';
      default:
        return value;
    }
  }

  if (typeof value === 'number') {
    switch (tier) {
      case DataTier.RESTRICTED:
      case DataTier.CONFIDENTIAL:
        return 0;
      case DataTier.INTERNAL:
        return 0;
      default:
        return value;
    }
  }

  // For non-primitive values, return a placeholder
  if (typeof value === 'object') {
    switch (tier) {
      case DataTier.RESTRICTED:
      case DataTier.CONFIDENTIAL:
        return '[REDACTED]';
      case DataTier.INTERNAL:
        return '[HIDDEN]';
      default:
        return value;
    }
  }

  return value;
}

// ---------------------------------------------------------------------------
// Deep masking
// ---------------------------------------------------------------------------

/**
 * Recursively mask fields in an entity based on the caller's access level.
 *
 * @param entityType   QBO entity type (e.g. 'Customer', 'Vendor')
 * @param entity       The entity object to mask (deep-copied, original untouched)
 * @param accessLevel  The caller's access level
 * @param parentPath   Internal: dot-path prefix for recursion
 */
export function maskEntity(
  entityType: string,
  entity: Record<string, unknown>,
  accessLevel: AccessLevel,
  parentPath: string = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(entity)) {
    const fieldPath = parentPath ? `${parentPath}.${key}` : key;
    const tier = getFieldTier(entityType, fieldPath);
    const requiredLevel = TIER_TO_LEVEL[tier];

    if (accessLevel >= requiredLevel) {
      // Caller has sufficient access — recurse into nested objects
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = maskEntity(
          entityType,
          value as Record<string, unknown>,
          accessLevel,
          fieldPath,
        );
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) => {
          if (item !== null && typeof item === 'object') {
            return maskEntity(
              entityType,
              item as Record<string, unknown>,
              accessLevel,
              fieldPath,
            );
          }
          return item;
        });
      } else {
        result[key] = value;
      }
    } else {
      // Mask the value
      result[key] = maskValue(value, tier);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Unmask (for elevated access tools)
// ---------------------------------------------------------------------------

/** In-memory store of original values, keyed by `entityType:entityId:fieldPath`. */
const unmaskedCache = new Map<string, unknown>();

/**
 * Register an entity's original (unmasked) values so they can be
 * retrieved later via `unmaskField`.
 */
export function registerUnmaskedEntity(
  entityType: string,
  entityId: string,
  entity: Record<string, unknown>,
  parentPath: string = '',
): void {
  for (const [key, value] of Object.entries(entity)) {
    const fieldPath = parentPath ? `${parentPath}.${key}` : key;
    const cacheKey = `${entityType}:${entityId}:${fieldPath}`;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      registerUnmaskedEntity(
        entityType,
        entityId,
        value as Record<string, unknown>,
        fieldPath,
      );
    } else {
      unmaskedCache.set(cacheKey, value);
    }
  }
}

/**
 * Retrieve the original unmasked value of a specific field.
 *
 * This should only be called for elevated-access tools that have
 * passed additional authorization checks (e.g. dual approval).
 */
export function unmaskField(
  entityType: string,
  fieldPath: string,
  entityId: string,
): unknown | undefined {
  const cacheKey = `${entityType}:${entityId}:${fieldPath}`;
  return unmaskedCache.get(cacheKey);
}

/**
 * Clear the unmask cache (e.g. on session end).
 */
export function clearUnmaskCache(): void {
  unmaskedCache.clear();
}
