/**
 * Benford's Law analysis for financial amounts.
 *
 * Compares the first-digit distribution of a set of amounts against
 * the expected Benford distribution and runs a chi-squared test.
 */

import Decimal from 'decimal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenfordsResult {
  sampleSize: number;
  observed: Record<number, number>;  // digit -> count
  expected: Record<number, number>;  // digit -> expected count
  observedPct: Record<number, number>; // digit -> observed %
  expectedPct: Record<number, number>; // digit -> expected %
  chiSquared: number;
  degreesOfFreedom: number;
  pValue: number;
  verdict: BenfordsVerdict;
}

export type BenfordsVerdict = 'conforming' | 'suspicious' | 'non-conforming';

// ---------------------------------------------------------------------------
// Benford's expected frequencies (first digit 1-9)
// ---------------------------------------------------------------------------

/**
 * P(d) = log10(1 + 1/d)
 */
const BENFORD_EXPECTED: Record<number, number> = {
  1: 0.30103,
  2: 0.17609,
  3: 0.12494,
  4: 0.09691,
  5: 0.07918,
  6: 0.06695,
  7: 0.05799,
  8: 0.05115,
  9: 0.04576,
};

// ---------------------------------------------------------------------------
// Chi-squared p-value approximation
// ---------------------------------------------------------------------------

/**
 * Approximate the upper-tail probability of the chi-squared distribution.
 * Uses the Wilson-Hilferty normal approximation for df >= 8.
 */
function chiSquaredPValue(chiSq: number, df: number): number {
  if (df <= 0 || chiSq < 0) return 1;

  // Wilson-Hilferty approximation
  const k = df;
  const z = Math.pow(chiSq / k, 1 / 3) - (1 - 2 / (9 * k));
  const denom = Math.sqrt(2 / (9 * k));
  const normZ = z / denom;

  // Standard normal CDF approximation (Abramowitz and Stegun 26.2.17)
  return 1 - normalCDF(normZ);
}

function normalCDF(z: number): number {
  if (z < -8) return 0;
  if (z > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * erf);
}

// ---------------------------------------------------------------------------
// BenfordsAnalyzer
// ---------------------------------------------------------------------------

export class BenfordsAnalyzer {
  /**
   * Analyze the first-digit distribution of a set of amounts.
   *
   * @param amounts  Array of monetary amounts (string, number, or Decimal)
   */
  analyze(amounts: Array<string | number | Decimal>): BenfordsResult {
    // Extract first digits
    const digitCounts: Record<number, number> = {};
    for (let d = 1; d <= 9; d++) {
      digitCounts[d] = 0;
    }

    let validCount = 0;

    for (const raw of amounts) {
      const firstDigit = this.getFirstDigit(raw);
      if (firstDigit !== null) {
        digitCounts[firstDigit]++;
        validCount++;
      }
    }

    if (validCount === 0) {
      return this.emptyResult();
    }

    // Compute observed and expected
    const observed: Record<number, number> = {};
    const expected: Record<number, number> = {};
    const observedPct: Record<number, number> = {};
    const expectedPct: Record<number, number> = {};

    for (let d = 1; d <= 9; d++) {
      observed[d] = digitCounts[d];
      expected[d] = Math.round(validCount * BENFORD_EXPECTED[d] * 100) / 100;
      observedPct[d] = Math.round((digitCounts[d] / validCount) * 10000) / 100;
      expectedPct[d] = Math.round(BENFORD_EXPECTED[d] * 10000) / 100;
    }

    // Chi-squared statistic
    let chiSquared = 0;
    for (let d = 1; d <= 9; d++) {
      const exp = validCount * BENFORD_EXPECTED[d];
      if (exp > 0) {
        chiSquared += Math.pow(digitCounts[d] - exp, 2) / exp;
      }
    }
    chiSquared = Math.round(chiSquared * 1000) / 1000;

    const degreesOfFreedom = 8; // 9 digits - 1
    const pValue = Math.round(chiSquaredPValue(chiSquared, degreesOfFreedom) * 10000) / 10000;

    // Verdict
    let verdict: BenfordsVerdict;
    if (pValue >= 0.05) {
      verdict = 'conforming';
    } else if (pValue >= 0.01) {
      verdict = 'suspicious';
    } else {
      verdict = 'non-conforming';
    }

    return {
      sampleSize: validCount,
      observed,
      expected,
      observedPct,
      expectedPct,
      chiSquared,
      degreesOfFreedom,
      pValue,
      verdict,
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private getFirstDigit(value: string | number | Decimal): number | null {
    let str: string;

    if (value instanceof Decimal) {
      if (value.isZero() || value.isNaN()) return null;
      str = value.abs().toFixed();
    } else {
      const num = typeof value === 'string' ? parseFloat(value) : value;
      if (isNaN(num) || num === 0) return null;
      str = Math.abs(num).toString();
    }

    // Find first non-zero digit
    for (const ch of str) {
      if (ch >= '1' && ch <= '9') {
        return parseInt(ch, 10);
      }
    }

    return null;
  }

  private emptyResult(): BenfordsResult {
    const empty: Record<number, number> = {};
    for (let d = 1; d <= 9; d++) {
      empty[d] = 0;
    }
    return {
      sampleSize: 0,
      observed: { ...empty },
      expected: { ...empty },
      observedPct: { ...empty },
      expectedPct: { ...empty },
      chiSquared: 0,
      degreesOfFreedom: 8,
      pValue: 1,
      verdict: 'conforming',
    };
  }
}
