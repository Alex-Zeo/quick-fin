/**
 * Role-Based Access Control (RBAC) — 5-tier permission model.
 *
 * Maps QBO entity operations to permission tiers. Tier incompatibilities
 * enforce segregation at the identity level (Controller + Treasury clash).
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum PermissionTier {
  ANALYST = 1,
  BOOKKEEPER = 2,
  CONTROLLER = 3,
  CFO = 4,
  TREASURY = 5,
}

export enum Operation {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  VOID = 'VOID',
  SEND_EMAIL = 'SEND_EMAIL',
  PDF = 'PDF',
  QUERY = 'QUERY',
  BATCH = 'BATCH',
  APPROVE = 'APPROVE',
  PAYMENT = 'PAYMENT',
  PAYROLL_READ = 'PAYROLL_READ',
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface Session {
  sessionId: string;
  userId: string;
  tier: PermissionTier;
  realmId: string;
  createdAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// Permission result
// ---------------------------------------------------------------------------

export interface PermissionResult {
  allowed: boolean;
  reason: string;
  masked?: boolean;           // data should be masked for this tier
  requiresApproval?: boolean; // operation needs approval queue
  coApprovalTier?: PermissionTier; // tier of required co-approver
}

// ---------------------------------------------------------------------------
// Qualifier for tier-specific constraints
// ---------------------------------------------------------------------------

interface PermissionRule {
  minTier: PermissionTier;
  masked?: boolean;
  draftOnly?: boolean;
  requiresApproval?: boolean;
  coApprovalTier?: PermissionTier;
  aggregate?: boolean; // payroll: aggregate only, no individual records
}

// ---------------------------------------------------------------------------
// Permission matrix
// ---------------------------------------------------------------------------

const PERMISSION_MATRIX: Record<Operation, PermissionRule> = {
  [Operation.READ]: {
    minTier: PermissionTier.ANALYST,
    masked: true, // Tier 1 gets masked data; higher tiers progressively unmask
  },
  [Operation.QUERY]: {
    minTier: PermissionTier.ANALYST,
  },
  [Operation.PDF]: {
    minTier: PermissionTier.ANALYST,
  },
  [Operation.CREATE]: {
    minTier: PermissionTier.BOOKKEEPER,
    draftOnly: true, // Tier 2 = draft only; Tier 3+ = full
  },
  [Operation.UPDATE]: {
    minTier: PermissionTier.BOOKKEEPER,
    draftOnly: true,
  },
  [Operation.DELETE]: {
    minTier: PermissionTier.CONTROLLER,
    requiresApproval: true,
  },
  [Operation.VOID]: {
    minTier: PermissionTier.CONTROLLER,
  },
  [Operation.SEND_EMAIL]: {
    minTier: PermissionTier.CONTROLLER,
  },
  [Operation.BATCH]: {
    minTier: PermissionTier.CONTROLLER,
    requiresApproval: true,
  },
  [Operation.APPROVE]: {
    minTier: PermissionTier.CFO,
  },
  [Operation.PAYMENT]: {
    minTier: PermissionTier.CFO,
    coApprovalTier: PermissionTier.TREASURY,
  },
  [Operation.PAYROLL_READ]: {
    minTier: PermissionTier.CFO,
    aggregate: true,
  },
};

// ---------------------------------------------------------------------------
// Tier incompatibilities
// ---------------------------------------------------------------------------

const INCOMPATIBLE_TIERS: ReadonlyArray<[PermissionTier, PermissionTier]> = [
  [PermissionTier.CONTROLLER, PermissionTier.TREASURY],
];

/**
 * Validate that a tier combination is not incompatible.
 * Used when assigning multiple roles to a single user.
 */
export function assertTierCompatibility(
  tiers: PermissionTier[],
): { compatible: boolean; conflict?: string } {
  for (const [a, b] of INCOMPATIBLE_TIERS) {
    if (tiers.includes(a) && tiers.includes(b)) {
      return {
        compatible: false,
        conflict: `Tier ${PermissionTier[a]} and Tier ${PermissionTier[b]} cannot be held by the same user`,
      };
    }
  }
  return { compatible: true };
}

// ---------------------------------------------------------------------------
// Core permission check
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a session is allowed to perform an operation on an entity.
 */
export function checkPermission(
  session: Session,
  operation: Operation,
  _entityType?: string,
): PermissionResult {
  const rule = PERMISSION_MATRIX[operation];
  if (!rule) {
    return { allowed: false, reason: `Unknown operation: ${operation}` };
  }

  // Treasury (Tier 5) is restricted to READ (masked) and PAYMENT (dual approval)
  if (session.tier === PermissionTier.TREASURY) {
    if (operation === Operation.READ) {
      return { allowed: true, reason: 'Treasury: read access (masked)', masked: true };
    }
    if (operation === Operation.PAYMENT) {
      return {
        allowed: true,
        reason: 'Treasury: payment with dual approval required',
        requiresApproval: true,
        coApprovalTier: PermissionTier.CFO,
      };
    }
    return {
      allowed: false,
      reason: `Treasury tier is restricted to READ and PAYMENT operations`,
    };
  }

  // Minimum tier check
  if (session.tier < rule.minTier) {
    return {
      allowed: false,
      reason: `Operation ${operation} requires tier ${PermissionTier[rule.minTier]} (${rule.minTier}) or higher; session has tier ${PermissionTier[session.tier]} (${session.tier})`,
    };
  }

  // Masked data for Analyst tier reads
  const masked = rule.masked === true && session.tier === PermissionTier.ANALYST;

  // Draft-only constraint for Bookkeeper
  if (rule.draftOnly && session.tier === PermissionTier.BOOKKEEPER) {
    return {
      allowed: true,
      reason: `${PermissionTier[session.tier]}: ${operation} allowed (draft only)`,
      masked,
    };
  }

  // Approval-required operations at Controller tier
  if (rule.requiresApproval && session.tier === PermissionTier.CONTROLLER) {
    return {
      allowed: true,
      reason: `${PermissionTier[session.tier]}: ${operation} allowed with approval`,
      requiresApproval: true,
      masked,
    };
  }

  // Payroll aggregate constraint for CFO
  if (rule.aggregate && operation === Operation.PAYROLL_READ) {
    return {
      allowed: true,
      reason: `${PermissionTier[session.tier]}: payroll read (aggregate only)`,
      masked: false,
    };
  }

  // Co-approval for payments at CFO level
  if (rule.coApprovalTier && session.tier === PermissionTier.CFO) {
    return {
      allowed: true,
      reason: `${PermissionTier[session.tier]}: ${operation} allowed with Tier ${PermissionTier[rule.coApprovalTier]} co-approval`,
      requiresApproval: true,
      coApprovalTier: rule.coApprovalTier,
      masked,
    };
  }

  return {
    allowed: true,
    reason: `${PermissionTier[session.tier]}: ${operation} allowed`,
    masked,
  };
}

// ---------------------------------------------------------------------------
// Guard variant — throws on denied
// ---------------------------------------------------------------------------

export class PermissionDeniedError extends Error {
  readonly operation: Operation;
  readonly tier: PermissionTier;

  constructor(result: PermissionResult, operation: Operation, tier: PermissionTier) {
    super(`Permission denied: ${result.reason}`);
    this.name = 'PermissionDeniedError';
    this.operation = operation;
    this.tier = tier;
  }
}

/**
 * Guard that throws if the session lacks permission.
 */
export function requirePermission(
  session: Session,
  operation: Operation,
  entityType?: string,
): PermissionResult {
  const result = checkPermission(session, operation, entityType);
  if (!result.allowed) {
    throw new PermissionDeniedError(result, operation, session.tier);
  }
  return result;
}
