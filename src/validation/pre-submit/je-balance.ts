/**
 * Journal Entry debit=credit balance validation.
 *
 * Uses Decimal.js for precise financial arithmetic — never JavaScript number.
 */

import Decimal from 'decimal.js';
import { ZERO, moneyToQBO } from '../../schemas/money.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
  meta?: Record<string, unknown>;
}

interface JournalEntryLine {
  Amount?: string | number | null;
  DetailType?: string;
  JournalEntryLineDetail?: {
    PostingType?: 'Debit' | 'Credit';
    AccountRef?: { value: string; name?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface JournalEntryPayload {
  Line?: JournalEntryLine[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate that a journal entry's total debits equal total credits.
 *
 * Sums all lines with PostingType 'Debit' and 'Credit' separately,
 * then verifies equality using Decimal.js precision.
 */
export function validateJEBalance(journalEntry: JournalEntryPayload): ValidationResult {
  const errors: ValidationError[] = [];
  const lines = journalEntry.Line;

  if (!lines || lines.length === 0) {
    return {
      valid: false,
      errors: [{
        field: 'Line',
        code: 'JE_NO_LINES',
        message: 'Journal entry must have at least one line',
      }],
    };
  }

  let totalDebit = ZERO;
  let totalCredit = ZERO;
  let debitCount = 0;
  let creditCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const detail = line.JournalEntryLineDetail;

    if (!detail) {
      // Lines without JournalEntryLineDetail (e.g. descriptive) are skipped
      continue;
    }

    const postingType = detail.PostingType;
    if (!postingType) {
      errors.push({
        field: `Line[${i}].JournalEntryLineDetail.PostingType`,
        code: 'JE_MISSING_POSTING_TYPE',
        message: `Line ${i} is missing PostingType (must be 'Debit' or 'Credit')`,
      });
      continue;
    }

    const rawAmount = line.Amount;
    if (rawAmount == null) {
      errors.push({
        field: `Line[${i}].Amount`,
        code: 'JE_MISSING_AMOUNT',
        message: `Line ${i} is missing Amount`,
      });
      continue;
    }

    let amount: Decimal;
    try {
      amount = new Decimal(String(rawAmount));
    } catch {
      errors.push({
        field: `Line[${i}].Amount`,
        code: 'JE_INVALID_AMOUNT',
        message: `Line ${i} has invalid amount: ${rawAmount}`,
      });
      continue;
    }

    if (amount.isNegative()) {
      errors.push({
        field: `Line[${i}].Amount`,
        code: 'JE_NEGATIVE_AMOUNT',
        message: `Line ${i} has negative amount ${moneyToQBO(amount)}; use PostingType to indicate debit/credit`,
      });
      continue;
    }

    if (postingType === 'Debit') {
      totalDebit = totalDebit.plus(amount);
      debitCount++;
    } else if (postingType === 'Credit') {
      totalCredit = totalCredit.plus(amount);
      creditCount++;
    } else {
      errors.push({
        field: `Line[${i}].JournalEntryLineDetail.PostingType`,
        code: 'JE_INVALID_POSTING_TYPE',
        message: `Line ${i} has invalid PostingType '${postingType}'; must be 'Debit' or 'Credit'`,
      });
    }
  }

  // Must have at least one debit and one credit
  if (debitCount === 0) {
    errors.push({
      field: 'Line',
      code: 'JE_NO_DEBITS',
      message: 'Journal entry must have at least one debit line',
    });
  }
  if (creditCount === 0) {
    errors.push({
      field: 'Line',
      code: 'JE_NO_CREDITS',
      message: 'Journal entry must have at least one credit line',
    });
  }

  // Check balance
  if (!totalDebit.equals(totalCredit)) {
    const difference = totalDebit.minus(totalCredit);
    errors.push({
      field: 'Line',
      code: 'JE_UNBALANCED',
      message: `Journal entry is unbalanced: total debits ${moneyToQBO(totalDebit)} != total credits ${moneyToQBO(totalCredit)} (difference: ${moneyToQBO(difference.abs())})`,
      meta: {
        totalDebit: moneyToQBO(totalDebit),
        totalCredit: moneyToQBO(totalCredit),
        difference: moneyToQBO(difference.abs()),
        direction: difference.isPositive() ? 'debit-heavy' : 'credit-heavy',
      },
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
