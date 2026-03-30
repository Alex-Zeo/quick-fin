/**
 * PCI PAN (Primary Account Number) detection and masking.
 *
 * Implements Luhn check and regex-based card number detection for
 * Visa, MasterCard, American Express, and Discover. Deep-scans
 * arbitrary objects and replaces any detected PANs with masked values.
 */

// ---------------------------------------------------------------------------
// Luhn algorithm
// ---------------------------------------------------------------------------

/**
 * Validate a number string using the Luhn (mod-10) algorithm.
 */
export function luhnCheck(digits: string): boolean {
  const cleaned = digits.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(cleaned)) return false;

  let sum = 0;
  let alternate = false;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    let n = parseInt(cleaned[i]!, 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// Card number patterns
// ---------------------------------------------------------------------------

/**
 * Regex patterns that match common card number formats.
 *
 * These patterns match with optional spaces/dashes between groups.
 * We use a global scan approach rather than trying to anchor, since
 * PANs can appear anywhere in free text.
 */
const CARD_PATTERNS: RegExp[] = [
  // Visa: starts with 4, 13 or 16 digits
  /\b4\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,4}\b/g,
  // MasterCard: starts with 51-55 or 2221-2720, 16 digits
  /\b5[1-5]\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  /\b2[2-7]\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  // American Express: starts with 34 or 37, 15 digits
  /\b3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5}\b/g,
  // Discover: starts with 6011, 622126-622925, 644-649, 65, 16 digits
  /\b6(?:011|5\d{2}|4[4-9]\d)[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  /\b622[1-9]\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{2}\b/g,
];

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Check whether a string contains what appears to be a valid PAN.
 */
export function containsPAN(text: string): boolean {
  for (const pattern of CARD_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = match[0].replace(/[\s-]/g, '');
      if (luhnCheck(candidate)) return true;
    }
  }
  return false;
}

/**
 * Mask a PAN string to show only the last 4 digits.
 * `4111111111111111` -> `****1111`
 */
function maskPAN(pan: string): string {
  const digits = pan.replace(/[\s-]/g, '');
  return `****${digits.slice(-4)}`;
}

/**
 * Replace all PAN occurrences in a string with masked versions.
 */
function maskPANsInString(text: string): string {
  let result = text;
  for (const pattern of CARD_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match) => {
      const digits = match.replace(/[\s-]/g, '');
      if (luhnCheck(digits)) return maskPAN(match);
      return match;
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Deep scan
// ---------------------------------------------------------------------------

/**
 * Recursively scan any value (string, object, array) and mask all PANs found.
 *
 * Returns a deep copy with PANs replaced; the original is NOT mutated.
 */
export function scanAndMask(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return maskPANsInString(data);
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => scanAndMask(item));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = scanAndMask(value);
    }
    return result;
  }

  return data;
}
