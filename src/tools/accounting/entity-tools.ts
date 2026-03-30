/**
 * Generic CRUD tool factory for all 36 QBO accounting entities.
 * Creates MCP tools: create, read, update, delete, query, void, send, pdf
 */

import Decimal from 'decimal.js';
import { z } from 'zod';

// Types for the tool factory
export interface EntityToolConfig {
  entityName: string;
  displayName: string;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canVoid: boolean;
  canSend: boolean;
  canPdf: boolean;
  isNameList: boolean;
}

export interface ToolContext {
  realmId: string;
  sessionId: string;
  userId: string;
  tier: number;
  traceId: string;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// All entity configurations
export const ENTITY_CONFIGS: EntityToolConfig[] = [
  // Transaction entities
  { entityName: 'Invoice', displayName: 'Invoice', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: true, canSend: true, canPdf: true, isNameList: false },
  { entityName: 'Bill', displayName: 'Bill', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'BillPayment', displayName: 'Bill Payment', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: true, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'CreditMemo', displayName: 'Credit Memo', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: true, canPdf: true, isNameList: false },
  { entityName: 'Deposit', displayName: 'Deposit', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'Estimate', displayName: 'Estimate', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: true, canPdf: true, isNameList: false },
  { entityName: 'JournalEntry', displayName: 'Journal Entry', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'Payment', displayName: 'Payment', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: true, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'Purchase', displayName: 'Purchase', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'PurchaseOrder', displayName: 'Purchase Order', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: true, canPdf: false, isNameList: false },
  { entityName: 'RefundReceipt', displayName: 'Refund Receipt', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: false, canPdf: true, isNameList: false },
  { entityName: 'SalesReceipt', displayName: 'Sales Receipt', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: true, canSend: true, canPdf: true, isNameList: false },
  { entityName: 'TimeActivity', displayName: 'Time Activity', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'Transfer', displayName: 'Transfer', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'VendorCredit', displayName: 'Vendor Credit', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: false, canPdf: false, isNameList: false },

  // Name list entities
  { entityName: 'Account', displayName: 'Account', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'Budget', displayName: 'Budget', canCreate: false, canRead: true, canUpdate: false, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'Class', displayName: 'Class', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'CompanyCurrency', displayName: 'Company Currency', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'Customer', displayName: 'Customer', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'Department', displayName: 'Department', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'Employee', displayName: 'Employee', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'Item', displayName: 'Item', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'JournalCode', displayName: 'Journal Code', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'PaymentMethod', displayName: 'Payment Method', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'TaxAgency', displayName: 'Tax Agency', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'TaxCode', displayName: 'Tax Code', canCreate: false, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'TaxRate', displayName: 'Tax Rate', canCreate: false, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'TaxService', displayName: 'Tax Service', canCreate: true, canRead: false, canUpdate: false, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'Term', displayName: 'Term', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },
  { entityName: 'Vendor', displayName: 'Vendor', canCreate: true, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: true },

  // Supporting entities
  { entityName: 'Attachable', displayName: 'Attachable', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canVoid: false, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'CompanyInfo', displayName: 'Company Info', canCreate: false, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'Entitlements', displayName: 'Entitlements', canCreate: false, canRead: true, canUpdate: false, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'ExchangeRate', displayName: 'Exchange Rate', canCreate: false, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: false },
  { entityName: 'Preferences', displayName: 'Preferences', canCreate: false, canRead: true, canUpdate: true, canDelete: false, canVoid: false, canSend: false, canPdf: false, isNameList: false },
];

/** Tool definition shape for MCP registration */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler: string; // operation type
  entityName: string;
}

/** Generate all tool definitions for an entity */
export function generateEntityTools(config: EntityToolConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const name = config.entityName;
  const lower = name.charAt(0).toLowerCase() + name.slice(1);

  if (config.canRead) {
    tools.push({
      name: `qbo_read_${lower}`,
      description: `Read a ${config.displayName} by ID from QuickBooks Online`,
      inputSchema: z.object({
        realmId: z.string().describe('QuickBooks company ID'),
        id: z.string().describe(`${config.displayName} ID`),
      }),
      handler: 'read',
      entityName: name,
    });
  }

  if (config.canCreate) {
    tools.push({
      name: `qbo_create_${lower}`,
      description: `Create a new ${config.displayName} in QuickBooks Online. Subject to approval workflow based on amount thresholds.`,
      inputSchema: z.object({
        realmId: z.string().describe('QuickBooks company ID'),
        entity: z.record(z.unknown()).describe(`${config.displayName} data`),
      }),
      handler: 'create',
      entityName: name,
    });
  }

  if (config.canUpdate) {
    tools.push({
      name: `qbo_update_${lower}`,
      description: `Update an existing ${config.displayName} in QuickBooks Online (sparse update). Requires current SyncToken.`,
      inputSchema: z.object({
        realmId: z.string().describe('QuickBooks company ID'),
        id: z.string().describe(`${config.displayName} ID`),
        updates: z.record(z.unknown()).describe('Fields to update (sparse)'),
      }),
      handler: 'update',
      entityName: name,
    });
  }

  if (config.canDelete) {
    tools.push({
      name: `qbo_delete_${lower}`,
      description: `Delete a ${config.displayName} from QuickBooks Online. Requires approval for most operations.`,
      inputSchema: z.object({
        realmId: z.string().describe('QuickBooks company ID'),
        id: z.string().describe(`${config.displayName} ID`),
        syncToken: z.string().describe('Current SyncToken for optimistic concurrency'),
      }),
      handler: 'delete',
      entityName: name,
    });
  }

  if (config.canVoid) {
    tools.push({
      name: `qbo_void_${lower}`,
      description: `Void a ${config.displayName} in QuickBooks Online. Always requires human approval. Zeroes amounts but preserves record.`,
      inputSchema: z.object({
        realmId: z.string().describe('QuickBooks company ID'),
        id: z.string().describe(`${config.displayName} ID`),
        syncToken: z.string().describe('Current SyncToken'),
        reason: z.string().describe('Reason for voiding (required for audit trail)'),
      }),
      handler: 'void',
      entityName: name,
    });
  }

  if (config.canSend) {
    tools.push({
      name: `qbo_send_${lower}`,
      description: `Queue a ${config.displayName} for email delivery. Goes to review queue — does NOT send immediately.`,
      inputSchema: z.object({
        realmId: z.string().describe('QuickBooks company ID'),
        id: z.string().describe(`${config.displayName} ID`),
        sendTo: z.string().email().optional().describe('Override recipient email'),
      }),
      handler: 'send',
      entityName: name,
    });
  }

  if (config.canPdf) {
    tools.push({
      name: `qbo_pdf_${lower}`,
      description: `Download PDF of a ${config.displayName} from QuickBooks Online`,
      inputSchema: z.object({
        realmId: z.string().describe('QuickBooks company ID'),
        id: z.string().describe(`${config.displayName} ID`),
      }),
      handler: 'pdf',
      entityName: name,
    });
  }

  // All readable entities support query
  if (config.canRead) {
    tools.push({
      name: `qbo_query_${lower}`,
      description: `Query ${config.displayName} records from QuickBooks Online using SQL-like syntax`,
      inputSchema: z.object({
        realmId: z.string().describe('QuickBooks company ID'),
        where: z.string().optional().describe("WHERE clause (e.g., \"TxnDate > '2024-01-01'\")"),
        orderBy: z.string().optional().describe('ORDER BY clause (e.g., "TxnDate DESC")'),
        maxResults: z.number().optional().default(100).describe('Max results per page (max 1000)'),
        startPosition: z.number().optional().default(1).describe('Starting position for pagination'),
      }),
      handler: 'query',
      entityName: name,
    });
  }

  // Name list entities support deactivation instead of delete
  if (config.isNameList && config.canUpdate) {
    tools.push({
      name: `qbo_deactivate_${lower}`,
      description: `Deactivate a ${config.displayName} in QuickBooks Online (sets Active=false). Name list entities cannot be deleted.`,
      inputSchema: z.object({
        realmId: z.string().describe('QuickBooks company ID'),
        id: z.string().describe(`${config.displayName} ID`),
        syncToken: z.string().describe('Current SyncToken'),
      }),
      handler: 'deactivate',
      entityName: name,
    });
  }

  return tools;
}

/** Generate ALL entity tools */
export function generateAllEntityTools(): ToolDefinition[] {
  return ENTITY_CONFIGS.flatMap(generateEntityTools);
}

/** Get entity config by name */
export function getEntityConfig(entityName: string): EntityToolConfig | undefined {
  return ENTITY_CONFIGS.find((c) => c.entityName === entityName);
}
