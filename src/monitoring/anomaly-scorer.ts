/**
 * Journal entry anomaly scoring.
 *
 * Multi-dimensional scoring that flags journal entries for human review
 * based on statistical and heuristic anomaly signals.
 */

import Decimal from 'decimal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnomalyScore {
  total: number; // 0-100 composite score
  dimensions: AnomalyDimension[];
  requiresReview: boolean;
  explanation: string;
}

export interface AnomalyDimension {
  name: string;
  score: number; // 0-100
  weight: number;
  detail: string;
}

interface JournalEntryForScoring {
  TotalAmt?: string | number | null;
  TxnDate?: string;
  DocNumber?: string;
  PrivateNote?: string;
  Line?: Array<{
    Amount?: string | number | null;
    Description?: string;
    JournalEntryLineDetail?: {
      PostingType?: string;
      AccountRef?: { value: string; name?: string };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  MetaData?: {
    CreateTime?: string;
    LastUpdatedTime?: string;
  };
  [key: string]: unknown;
}

export interface HistoricalStats {
  meanAmount: number;
  stdDevAmount: number;
  commonAccounts: Set<string>;  // Account IDs used >5% of the time
  commonHours: Set<number>;     // Hours with >5% activity
  totalEntries: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Score threshold for flagging review */
const REVIEW_THRESHOLD = 65;

/** Common approval thresholds to check proximity against */
const COMMON_THRESHOLDS = [1000, 2500, 5000, 10000, 25000, 50000, 100000];

// ---------------------------------------------------------------------------
// AnomalyScorer
// ---------------------------------------------------------------------------

export class AnomalyScorer {
  private stats: HistoricalStats | null = null;

  /**
   * Load historical statistics for contextual scoring.
   * If not loaded, z-score and rarity dimensions are skipped.
   */
  loadStats(stats: HistoricalStats): void {
    this.stats = stats;
  }

  /**
   * Score a journal entry for anomalies.
   *
   * @param journalEntry  The journal entry to score
   */
  score(journalEntry: JournalEntryForScoring): AnomalyScore {
    const dimensions: AnomalyDimension[] = [];

    // 1. Amount z-score
    dimensions.push(this.scoreAmountZScore(journalEntry));

    // 2. Round number detection
    dimensions.push(this.scoreRoundNumber(journalEntry));

    // 3. Threshold proximity
    dimensions.push(this.scoreThresholdProximity(journalEntry));

    // 4. Unusual hour
    dimensions.push(this.scoreUnusualHour(journalEntry));

    // 5. Account rarity
    dimensions.push(this.scoreAccountRarity(journalEntry));

    // 6. Description quality
    dimensions.push(this.scoreDescriptionQuality(journalEntry));

    // Compute weighted composite
    let weightedSum = 0;
    let totalWeight = 0;
    for (const dim of dimensions) {
      weightedSum += dim.score * dim.weight;
      totalWeight += dim.weight;
    }
    const total = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

    const requiresReview = total >= REVIEW_THRESHOLD;
    const flaggedDimensions = dimensions
      .filter((d) => d.score >= 50)
      .map((d) => d.name);

    const explanation = requiresReview
      ? `Anomaly score ${total}/100 exceeds review threshold. Flagged dimensions: ${flaggedDimensions.join(', ')}`
      : `Anomaly score ${total}/100 is within normal range`;

    return { total, dimensions, requiresReview, explanation };
  }

  // ── Scoring dimensions ──────────────────────────────────────────────────

  private scoreAmountZScore(je: JournalEntryForScoring): AnomalyDimension {
    const amount = this.extractTotalAmount(je);

    if (!this.stats || this.stats.stdDevAmount === 0 || amount === null) {
      return { name: 'amount_zscore', score: 0, weight: 25, detail: 'No historical data available' };
    }

    const zScore = Math.abs(
      (amount.toNumber() - this.stats.meanAmount) / this.stats.stdDevAmount,
    );

    // z > 3 → 100, z > 2 → 70, z > 1.5 → 40, else 0
    let score: number;
    if (zScore > 3) score = 100;
    else if (zScore > 2) score = 70;
    else if (zScore > 1.5) score = 40;
    else score = Math.round(zScore * 13); // gradual 0-20

    return {
      name: 'amount_zscore',
      score,
      weight: 25,
      detail: `z-score: ${zScore.toFixed(2)} (mean: ${this.stats.meanAmount.toFixed(2)}, stddev: ${this.stats.stdDevAmount.toFixed(2)})`,
    };
  }

  private scoreRoundNumber(je: JournalEntryForScoring): AnomalyDimension {
    const amount = this.extractTotalAmount(je);
    if (amount === null) {
      return { name: 'round_number', score: 0, weight: 10, detail: 'No amount' };
    }

    const str = amount.toFixed(2);
    // Check if ends in 000.00, 00.00, or 0.00
    let score = 0;
    let detail = 'Not a round number';

    if (/\d+000\.00$/.test(str)) {
      score = 60;
      detail = `Round thousands: ${str}`;
    } else if (/\d+00\.00$/.test(str)) {
      score = 30;
      detail = `Round hundreds: ${str}`;
    } else if (/\d+0\.00$/.test(str)) {
      score = 10;
      detail = `Round tens: ${str}`;
    }

    // Very large round numbers are more suspicious
    if (score > 0 && amount.gte(10000)) {
      score = Math.min(100, score + 20);
    }

    return { name: 'round_number', score, weight: 10, detail };
  }

  private scoreThresholdProximity(je: JournalEntryForScoring): AnomalyDimension {
    const amount = this.extractTotalAmount(je);
    if (amount === null) {
      return { name: 'threshold_proximity', score: 0, weight: 20, detail: 'No amount' };
    }

    const amountNum = amount.toNumber();
    let maxScore = 0;
    let closestThreshold = 0;
    let closestPct = 100;

    for (const threshold of COMMON_THRESHOLDS) {
      if (amountNum <= 0) continue;

      const pctOfThreshold = (amountNum / threshold) * 100;

      // Flag amounts that are 85-99% of a threshold (just under)
      if (pctOfThreshold >= 85 && pctOfThreshold < 100) {
        const proximity = 100 - pctOfThreshold; // 1-15% below
        const score = Math.round(100 - proximity * 6.67); // 100 at 100%, 0 at 85%

        if (score > maxScore) {
          maxScore = score;
          closestThreshold = threshold;
          closestPct = pctOfThreshold;
        }
      }
    }

    const detail = maxScore > 0
      ? `Amount is ${closestPct.toFixed(1)}% of ${closestThreshold} threshold`
      : 'Not near any common threshold';

    return { name: 'threshold_proximity', score: maxScore, weight: 20, detail };
  }

  private scoreUnusualHour(je: JournalEntryForScoring): AnomalyDimension {
    const createTime = je.MetaData?.CreateTime;
    if (!createTime) {
      return { name: 'unusual_hour', score: 0, weight: 15, detail: 'No creation time' };
    }

    const date = new Date(createTime);
    const hour = date.getUTCHours();

    // If we have stats, check against common hours
    if (this.stats && this.stats.commonHours.size > 0) {
      if (!this.stats.commonHours.has(hour)) {
        return {
          name: 'unusual_hour',
          score: 70,
          weight: 15,
          detail: `Created at ${hour}:00 UTC — outside common business hours`,
        };
      }
      return {
        name: 'unusual_hour',
        score: 0,
        weight: 15,
        detail: `Created at ${hour}:00 UTC — within common hours`,
      };
    }

    // Default: flag nights/weekends (midnight-5am, 10pm-midnight UTC)
    if (hour >= 22 || hour < 5) {
      return {
        name: 'unusual_hour',
        score: 60,
        weight: 15,
        detail: `Created at ${hour}:00 UTC — outside typical business hours`,
      };
    }

    return { name: 'unusual_hour', score: 0, weight: 15, detail: `Created at ${hour}:00 UTC` };
  }

  private scoreAccountRarity(je: JournalEntryForScoring): AnomalyDimension {
    if (!this.stats || this.stats.commonAccounts.size === 0) {
      return { name: 'account_rarity', score: 0, weight: 15, detail: 'No historical data' };
    }

    const lines = je.Line ?? [];
    let rareCount = 0;
    let totalAccounts = 0;
    const rareAccounts: string[] = [];

    for (const line of lines) {
      const accountRef = line.JournalEntryLineDetail?.AccountRef;
      if (!accountRef?.value) continue;

      totalAccounts++;
      if (!this.stats.commonAccounts.has(accountRef.value)) {
        rareCount++;
        rareAccounts.push(accountRef.name ?? accountRef.value);
      }
    }

    if (totalAccounts === 0) {
      return { name: 'account_rarity', score: 0, weight: 15, detail: 'No account references' };
    }

    const rarePct = rareCount / totalAccounts;
    let score: number;

    if (rarePct >= 0.5) score = 80;
    else if (rarePct > 0) score = Math.round(rarePct * 100);
    else score = 0;

    return {
      name: 'account_rarity',
      score,
      weight: 15,
      detail: rareAccounts.length > 0
        ? `${rareCount}/${totalAccounts} account(s) are rarely used: ${rareAccounts.join(', ')}`
        : 'All accounts are commonly used',
    };
  }

  private scoreDescriptionQuality(je: JournalEntryForScoring): AnomalyDimension {
    const lines = je.Line ?? [];
    const memo = je.PrivateNote ?? '';

    let hasDescription = memo.length > 0;
    let totalLines = 0;
    let describedLines = 0;

    for (const line of lines) {
      if (!line.JournalEntryLineDetail) continue;
      totalLines++;
      if (line.Description && line.Description.trim().length > 0) {
        describedLines++;
        hasDescription = true;
      }
    }

    if (totalLines === 0) {
      return { name: 'description_quality', score: 0, weight: 15, detail: 'No lines to check' };
    }

    let score: number;
    let detail: string;

    if (!hasDescription) {
      score = 70;
      detail = 'No description or memo on any line';
    } else if (describedLines < totalLines) {
      const pct = Math.round((describedLines / totalLines) * 100);
      score = Math.round(50 * (1 - describedLines / totalLines));
      detail = `${pct}% of lines have descriptions`;
    } else {
      // Check description quality — very short descriptions are suspicious
      const avgLength = lines.reduce((sum, l) => sum + (l.Description?.length ?? 0), 0) / totalLines;
      if (avgLength < 5) {
        score = 30;
        detail = `Average description length is only ${avgLength.toFixed(0)} chars`;
      } else {
        score = 0;
        detail = 'All lines have adequate descriptions';
      }
    }

    return { name: 'description_quality', score, weight: 15, detail };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private extractTotalAmount(je: JournalEntryForScoring): Decimal | null {
    if (je.TotalAmt != null) {
      try {
        return new Decimal(String(je.TotalAmt));
      } catch {
        return null;
      }
    }

    // Sum debit side
    const lines = je.Line ?? [];
    let total = new Decimal(0);
    for (const line of lines) {
      if (line.JournalEntryLineDetail?.PostingType === 'Debit' && line.Amount != null) {
        try {
          total = total.plus(new Decimal(String(line.Amount)));
        } catch {
          // skip
        }
      }
    }

    return total.isZero() ? null : total;
  }
}
