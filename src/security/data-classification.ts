/**
 * Four-tier data classification system for QBO entities.
 *
 * Classifies every field by sensitivity so that masking, access-control, and
 * audit layers can enforce the appropriate protection level.
 */

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export enum DataTier {
  /** Freely shareable — entity IDs, types, dates. */
  PUBLIC = 'PUBLIC',
  /** Business-sensitive — amounts, account names. */
  INTERNAL = 'INTERNAL',
  /** PII / contact data — emails, phones, addresses. */
  CONFIDENTIAL = 'CONFIDENTIAL',
  /** Regulated data — SSN, TIN, bank accounts, card numbers, compensation. */
  RESTRICTED = 'RESTRICTED',
}

// ---------------------------------------------------------------------------
// Classification map
// ---------------------------------------------------------------------------

/**
 * Nested map: entityType -> fieldPath -> DataTier.
 *
 * Use `*` as entityType for cross-entity defaults.
 * Field paths support dot notation (e.g. `PrimaryAddr.Line1`).
 */
const FIELD_CLASSIFICATIONS: Record<string, Record<string, DataTier>> = {
  // ── Cross-entity defaults ───────────────────────────────────────────────
  '*': {
    Id: DataTier.PUBLIC,
    SyncToken: DataTier.PUBLIC,
    MetaData: DataTier.PUBLIC,
    'MetaData.CreateTime': DataTier.PUBLIC,
    'MetaData.LastUpdatedTime': DataTier.PUBLIC,
    domain: DataTier.PUBLIC,
    sparse: DataTier.PUBLIC,
    TxnDate: DataTier.PUBLIC,
    DueDate: DataTier.PUBLIC,
    DocNumber: DataTier.INTERNAL,
    TotalAmt: DataTier.INTERNAL,
    Balance: DataTier.INTERNAL,
    PrivateNote: DataTier.INTERNAL,
  },

  // ── Customer ────────────────────────────────────────────────────────────
  Customer: {
    DisplayName: DataTier.INTERNAL,
    CompanyName: DataTier.INTERNAL,
    GivenName: DataTier.CONFIDENTIAL,
    FamilyName: DataTier.CONFIDENTIAL,
    MiddleName: DataTier.CONFIDENTIAL,
    Suffix: DataTier.CONFIDENTIAL,
    Title: DataTier.CONFIDENTIAL,
    PrimaryEmailAddr: DataTier.CONFIDENTIAL,
    'PrimaryEmailAddr.Address': DataTier.CONFIDENTIAL,
    PrimaryPhone: DataTier.CONFIDENTIAL,
    'PrimaryPhone.FreeFormNumber': DataTier.CONFIDENTIAL,
    Mobile: DataTier.CONFIDENTIAL,
    'Mobile.FreeFormNumber': DataTier.CONFIDENTIAL,
    Fax: DataTier.CONFIDENTIAL,
    'Fax.FreeFormNumber': DataTier.CONFIDENTIAL,
    BillAddr: DataTier.CONFIDENTIAL,
    'BillAddr.Line1': DataTier.CONFIDENTIAL,
    'BillAddr.Line2': DataTier.CONFIDENTIAL,
    'BillAddr.City': DataTier.CONFIDENTIAL,
    'BillAddr.CountrySubDivisionCode': DataTier.CONFIDENTIAL,
    'BillAddr.PostalCode': DataTier.CONFIDENTIAL,
    ShipAddr: DataTier.CONFIDENTIAL,
    'ShipAddr.Line1': DataTier.CONFIDENTIAL,
    'ShipAddr.Line2': DataTier.CONFIDENTIAL,
    'ShipAddr.City': DataTier.CONFIDENTIAL,
    'ShipAddr.CountrySubDivisionCode': DataTier.CONFIDENTIAL,
    'ShipAddr.PostalCode': DataTier.CONFIDENTIAL,
    PrimaryTaxIdentifier: DataTier.RESTRICTED,
    TaxIdentifier: DataTier.RESTRICTED,
    SSN: DataTier.RESTRICTED,
  },

  // ── Vendor ──────────────────────────────────────────────────────────────
  Vendor: {
    DisplayName: DataTier.INTERNAL,
    CompanyName: DataTier.INTERNAL,
    GivenName: DataTier.CONFIDENTIAL,
    FamilyName: DataTier.CONFIDENTIAL,
    PrimaryEmailAddr: DataTier.CONFIDENTIAL,
    'PrimaryEmailAddr.Address': DataTier.CONFIDENTIAL,
    PrimaryPhone: DataTier.CONFIDENTIAL,
    'PrimaryPhone.FreeFormNumber': DataTier.CONFIDENTIAL,
    BillAddr: DataTier.CONFIDENTIAL,
    'BillAddr.Line1': DataTier.CONFIDENTIAL,
    'BillAddr.Line2': DataTier.CONFIDENTIAL,
    'BillAddr.City': DataTier.CONFIDENTIAL,
    'BillAddr.PostalCode': DataTier.CONFIDENTIAL,
    TaxIdentifier: DataTier.RESTRICTED,
    AcctNum: DataTier.RESTRICTED,
    'BankAccountDetails.BankAccountNumber': DataTier.RESTRICTED,
    'BankAccountDetails.RoutingNumber': DataTier.RESTRICTED,
    Vendor1099: DataTier.RESTRICTED,
  },

  // ── Employee ────────────────────────────────────────────────────────────
  Employee: {
    DisplayName: DataTier.INTERNAL,
    GivenName: DataTier.CONFIDENTIAL,
    FamilyName: DataTier.CONFIDENTIAL,
    PrimaryEmailAddr: DataTier.CONFIDENTIAL,
    'PrimaryEmailAddr.Address': DataTier.CONFIDENTIAL,
    PrimaryPhone: DataTier.CONFIDENTIAL,
    'PrimaryPhone.FreeFormNumber': DataTier.CONFIDENTIAL,
    PrimaryAddr: DataTier.CONFIDENTIAL,
    'PrimaryAddr.Line1': DataTier.CONFIDENTIAL,
    'PrimaryAddr.City': DataTier.CONFIDENTIAL,
    'PrimaryAddr.PostalCode': DataTier.CONFIDENTIAL,
    SSN: DataTier.RESTRICTED,
    BirthDate: DataTier.RESTRICTED,
    HiredDate: DataTier.CONFIDENTIAL,
    CostRate: DataTier.RESTRICTED,
    BillRate: DataTier.RESTRICTED,
  },

  // ── Invoice ─────────────────────────────────────────────────────────────
  Invoice: {
    TotalAmt: DataTier.INTERNAL,
    Balance: DataTier.INTERNAL,
    'Line.Amount': DataTier.INTERNAL,
    BillEmail: DataTier.CONFIDENTIAL,
    'BillEmail.Address': DataTier.CONFIDENTIAL,
    ShipAddr: DataTier.CONFIDENTIAL,
    'ShipAddr.Line1': DataTier.CONFIDENTIAL,
    BillAddr: DataTier.CONFIDENTIAL,
    'BillAddr.Line1': DataTier.CONFIDENTIAL,
  },

  // ── Bill ────────────────────────────────────────────────────────────────
  Bill: {
    TotalAmt: DataTier.INTERNAL,
    Balance: DataTier.INTERNAL,
    'Line.Amount': DataTier.INTERNAL,
    'VendorAddr.Line1': DataTier.CONFIDENTIAL,
  },

  // ── Payment ─────────────────────────────────────────────────────────────
  Payment: {
    TotalAmt: DataTier.INTERNAL,
    'CreditCardPayment.CreditChargeInfo.Number': DataTier.RESTRICTED,
    'CreditCardPayment.CreditChargeInfo.CcExpiryMonth': DataTier.RESTRICTED,
    'CreditCardPayment.CreditChargeInfo.CcExpiryYear': DataTier.RESTRICTED,
    'CreditCardPayment.CreditChargeInfo.NameOnAcct': DataTier.CONFIDENTIAL,
    'CreditCardPayment.CreditChargeInfo.BillAddrStreet': DataTier.CONFIDENTIAL,
  },

  // ── Account ─────────────────────────────────────────────────────────────
  Account: {
    Name: DataTier.INTERNAL,
    AccountType: DataTier.INTERNAL,
    AccountSubType: DataTier.INTERNAL,
    CurrentBalance: DataTier.INTERNAL,
    AcctNum: DataTier.RESTRICTED,
    BankNum: DataTier.RESTRICTED,
  },

  // ── JournalEntry ────────────────────────────────────────────────────────
  JournalEntry: {
    TotalAmt: DataTier.INTERNAL,
    'Line.Amount': DataTier.INTERNAL,
    'Line.JournalEntryLineDetail.AccountRef': DataTier.INTERNAL,
  },
};

// ---------------------------------------------------------------------------
// Lookup cache: flattened once on first access for fast runtime queries
// ---------------------------------------------------------------------------

let flatCache: Map<string, DataTier> | null = null;

function ensureFlat(): Map<string, DataTier> {
  if (flatCache) return flatCache;
  flatCache = new Map();
  for (const [entity, fields] of Object.entries(FIELD_CLASSIFICATIONS)) {
    for (const [field, tier] of Object.entries(fields)) {
      flatCache.set(`${entity}.${field}`, tier);
    }
  }
  return flatCache;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the data tier for a specific field on a specific entity type.
 *
 * Falls back to the `*` wildcard entity, then defaults to INTERNAL.
 */
export function getFieldTier(entityType: string, fieldPath: string): DataTier {
  const flat = ensureFlat();

  // Exact match on entity
  const exact = flat.get(`${entityType}.${fieldPath}`);
  if (exact) return exact;

  // Wildcard match
  const wildcard = flat.get(`*.${fieldPath}`);
  if (wildcard) return wildcard;

  // Default to INTERNAL — unknown fields are not public by default
  return DataTier.INTERNAL;
}

/**
 * Get all RESTRICTED field paths for a given entity type.
 */
export function getRestrictedFields(entityType: string): string[] {
  const flat = ensureFlat();
  const results: string[] = [];

  for (const [key, tier] of flat) {
    if (tier !== DataTier.RESTRICTED) continue;
    if (key.startsWith(`${entityType}.`) || key.startsWith('*.')) {
      const field = key.slice(key.indexOf('.') + 1);
      results.push(field);
    }
  }

  // Deduplicate (a field may appear under both entity and *)
  return [...new Set(results)];
}

/**
 * Get all field paths at or above a given tier for an entity type.
 */
export function getFieldsAtOrAboveTier(entityType: string, minTier: DataTier): string[] {
  const tierOrder: Record<DataTier, number> = {
    [DataTier.PUBLIC]: 0,
    [DataTier.INTERNAL]: 1,
    [DataTier.CONFIDENTIAL]: 2,
    [DataTier.RESTRICTED]: 3,
  };

  const flat = ensureFlat();
  const results: string[] = [];
  const minLevel = tierOrder[minTier];

  for (const [key, tier] of flat) {
    if (tierOrder[tier] < minLevel) continue;
    if (key.startsWith(`${entityType}.`) || key.startsWith('*.')) {
      const field = key.slice(key.indexOf('.') + 1);
      results.push(field);
    }
  }

  return [...new Set(results)];
}
