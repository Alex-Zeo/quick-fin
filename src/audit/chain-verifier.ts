/**
 * Audit chain integrity verification.
 *
 * Walks the hash chain in the audit log, recomputes hashes, and checks
 * for gaps, tampering, or broken links.
 */

import type { AuditLogger, AuditRecord } from './audit-logger.js';
import { recomputeHash } from './audit-logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationResult {
  /** Whether the entire verified range is valid. */
  valid: boolean;
  /** Number of entries checked. */
  entriesChecked: number;
  /** ID of the first invalid entry, if any. */
  firstInvalidId?: number;
  /** Description of what went wrong, if anything. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Genesis hash (must match audit-logger.ts)
// ---------------------------------------------------------------------------

const GENESIS_HASH = '0'.repeat(64);

// ---------------------------------------------------------------------------
// Batch-fetch helper
// ---------------------------------------------------------------------------

const BATCH_SIZE = 1000;

/**
 * Fetch audit records in ascending ID order within an optional range.
 * Yields batches to handle very large chains without loading everything into memory.
 */
function* fetchBatches(
  logger: AuditLogger,
  startId: number,
  endId: number | undefined,
): Generator<AuditRecord[]> {
  let offset = 0;
  let done = false;

  while (!done) {
    // We query in ascending order with a range filter
    const records = logger.query({
      limit: BATCH_SIZE,
      offset,
    });

    // query() returns DESC by default, but we need ASC for chain verification,
    // so we filter and sort ourselves
    const filtered = records
      .filter((r) => r.id >= startId && (endId === undefined || r.id <= endId))
      .sort((a, b) => a.id - b.id);

    if (records.length < BATCH_SIZE) {
      done = true;
    } else {
      offset += BATCH_SIZE;
    }

    if (filtered.length > 0) {
      yield filtered;
    }

    if (records.length < BATCH_SIZE) break;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify the integrity of the audit hash chain.
 *
 * Walks every entry in [startId..endId] (inclusive), recomputes hashes,
 * and checks that:
 * 1. Each entry's hash matches the recomputed hash.
 * 2. Each entry's `previousHash` matches the prior entry's `entryHash`.
 * 3. There are no gaps in the ID sequence.
 *
 * @param logger   The AuditLogger instance to verify against.
 * @param startId  First entry ID to verify (default: 1).
 * @param endId    Last entry ID to verify (default: chain tip).
 */
export function verifyChain(
  logger: AuditLogger,
  startId: number = 1,
  endId?: number,
): VerificationResult {
  let entriesChecked = 0;
  let expectedPreviousHash: string | null = null;

  // If starting from the beginning, the first entry should reference genesis
  if (startId <= 1) {
    expectedPreviousHash = GENESIS_HASH;
  } else {
    // Load the entry just before startId to get its hash
    const prior = logger.getById(startId - 1);
    if (prior) {
      expectedPreviousHash = prior.entryHash;
    }
    // If prior doesn't exist and startId > 1, we can't verify the link
    // but we can still verify internal consistency
  }

  let lastId: number | null = null;

  for (const batch of fetchBatches(logger, startId, endId)) {
    for (const record of batch) {
      entriesChecked++;

      // Check for ID gaps
      if (lastId !== null && record.id !== lastId + 1) {
        return {
          valid: false,
          entriesChecked,
          firstInvalidId: record.id,
          error: `Gap detected: expected ID ${lastId + 1} but found ${record.id}`,
        };
      }

      // Verify hash chain link
      if (expectedPreviousHash !== null && record.previousHash !== expectedPreviousHash) {
        return {
          valid: false,
          entriesChecked,
          firstInvalidId: record.id,
          error: `Chain break at ID ${record.id}: previousHash mismatch (expected ${expectedPreviousHash.slice(0, 16)}..., got ${record.previousHash.slice(0, 16)}...)`,
        };
      }

      // Recompute and verify entry hash
      const recomputed = recomputeHash(record);
      if (record.entryHash !== recomputed) {
        return {
          valid: false,
          entriesChecked,
          firstInvalidId: record.id,
          error: `Tampered entry at ID ${record.id}: hash mismatch (stored ${record.entryHash.slice(0, 16)}..., computed ${recomputed.slice(0, 16)}...)`,
        };
      }

      expectedPreviousHash = record.entryHash;
      lastId = record.id;
    }
  }

  return {
    valid: true,
    entriesChecked,
  };
}
