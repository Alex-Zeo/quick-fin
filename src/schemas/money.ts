import Decimal from 'decimal.js';
import { z } from 'zod';

// Configure Decimal for financial precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/** Zod schema that coerces string|number to Decimal */
export const QBOMoney = z.union([z.string(), z.number()]).transform((v) => new Decimal(String(v)));

/** Zod schema for optional money fields */
export const QBOMoneyOptional = z.union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => (v == null ? null : new Decimal(String(v))));

export type Money = Decimal;

/** Serialize Decimal back to string for QBO API */
export function moneyToQBO(amount: Decimal): string {
  return amount.toFixed(2);
}

/** Add two Money values safely */
export function moneyAdd(a: Decimal, b: Decimal): Decimal {
  return a.plus(b);
}

/** Subtract b from a safely */
export function moneySub(a: Decimal, b: Decimal): Decimal {
  return a.minus(b);
}

/** Multiply money by a factor */
export function moneyMul(a: Decimal, factor: Decimal | number): Decimal {
  return a.times(factor);
}

/** Check if debits equal credits (for JE validation) */
export function moneyBalances(debits: Decimal[], credits: Decimal[]): boolean {
  const totalDebit = debits.reduce((sum, d) => sum.plus(d), new Decimal(0));
  const totalCredit = credits.reduce((sum, c) => sum.plus(c), new Decimal(0));
  return totalDebit.equals(totalCredit);
}

/** Parse a money value from any input */
export function parseMoney(value: string | number | null | undefined): Decimal | null {
  if (value == null || value === '') return null;
  return new Decimal(String(value));
}

/** Zero value */
export const ZERO = new Decimal(0);
