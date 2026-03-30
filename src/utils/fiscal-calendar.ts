/**
 * Fiscal calendar utilities.
 *
 * Supports arbitrary fiscal year start months for companies
 * whose fiscal year does not align with the calendar year.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FiscalPeriod {
  start: Date;
  end: Date;
  name: string;
}

// ---------------------------------------------------------------------------
// FiscalCalendar
// ---------------------------------------------------------------------------

export class FiscalCalendar {
  private readonly startMonth: number; // 1-12

  /**
   * @param fiscalYearStartMonth  1 = January, 4 = April (UK tax year), etc.
   */
  constructor(fiscalYearStartMonth: number = 1) {
    if (fiscalYearStartMonth < 1 || fiscalYearStartMonth > 12) {
      throw new Error(`fiscalYearStartMonth must be 1-12, got ${fiscalYearStartMonth}`);
    }
    this.startMonth = fiscalYearStartMonth;
  }

  /**
   * Get the fiscal period (quarter) containing the given date.
   *
   * @returns Object with start/end dates and name like "FY2026-Q1"
   */
  getPeriod(date: Date): FiscalPeriod {
    const fy = this.getFiscalYear(date);
    const q = this.getQuarter(date);

    // Calculate the number of months into the fiscal year
    const monthInFY = (date.getMonth() + 1 - this.startMonth + 12) % 12;
    const quarterIndex = Math.floor(monthInFY / 3); // 0-3

    // Quarter start: fiscal year start + quarterIndex * 3 months
    const fyStartYear = this.startMonth === 1 ? fy : fy - 1;
    const qStartMonth = (this.startMonth - 1 + quarterIndex * 3) % 12;
    const qStartYear = this.startMonth - 1 + quarterIndex * 3 >= 12
      ? fyStartYear + 1
      : fyStartYear;

    const start = new Date(qStartYear, qStartMonth, 1);
    start.setHours(0, 0, 0, 0);

    // Quarter end: 3 months after start, last day
    const end = new Date(start);
    end.setMonth(end.getMonth() + 3);
    end.setDate(0); // Last day of previous month
    end.setHours(23, 59, 59, 999);

    return { start, end, name: `FY${fy}-Q${q}` };
  }

  /**
   * Get the fiscal quarter (1-4) for a date.
   */
  getQuarter(date: Date): number {
    const monthInFY = (date.getMonth() + 1 - this.startMonth + 12) % 12;
    return Math.floor(monthInFY / 3) + 1;
  }

  /**
   * Get the fiscal year for a date.
   *
   * For a January start, FY = calendar year.
   * For non-January starts, FY is the calendar year the fiscal year ends in.
   * E.g., if fiscal year starts April, then March 2026 is FY2026,
   * and April 2026 is FY2027.
   */
  getFiscalYear(date: Date): number {
    const month = date.getMonth() + 1; // 1-based
    if (this.startMonth === 1) {
      return date.getFullYear();
    }
    // FY = year the fiscal year ends in
    return month >= this.startMonth
      ? date.getFullYear() + 1
      : date.getFullYear();
  }

  /**
   * Check if the given date is the last day of the fiscal year.
   */
  isYearEnd(date: Date): boolean {
    // Last month of fiscal year is (startMonth - 2 + 12) % 12 + 1
    const lastMonth = (this.startMonth - 2 + 12) % 12 + 1;
    const month = date.getMonth() + 1;
    const lastDayOfMonth = new Date(date.getFullYear(), month, 0).getDate();
    return month === lastMonth && date.getDate() === lastDayOfMonth;
  }

  /**
   * Get all four fiscal periods for a given fiscal year.
   */
  getPeriods(fiscalYear: number): FiscalPeriod[] {
    const periods: FiscalPeriod[] = [];
    const startYear = this.startMonth === 1 ? fiscalYear : fiscalYear - 1;

    for (let q = 0; q < 4; q++) {
      const monthOffset = this.startMonth - 1 + q * 3;
      const year = startYear + Math.floor(monthOffset / 12);
      const month = monthOffset % 12;

      const start = new Date(year, month, 1);
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setMonth(end.getMonth() + 3);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);

      periods.push({ start, end, name: `FY${fiscalYear}-Q${q + 1}` });
    }

    return periods;
  }
}
