/**
 * MCP tools for QuickBooks Payments API.
 * All payment operations are disabled by default and require dual approval.
 */

import { z } from 'zod';
import type { ToolResult, ToolContext } from '../accounting/entity-tools.js';

/** Payment tool definitions */
export function generatePaymentTools() {
  return [
    {
      name: 'qbo_charge_create',
      description: 'Create a credit card charge. REQUIRES DUAL APPROVAL. Payments are disabled by default.',
      inputSchema: z.object({
        realmId: z.string(),
        amount: z.number().positive(),
        currency: z.string().default('USD'),
        token: z.string().optional().describe('Payment token from qbo_token_create'),
        cardId: z.string().optional().describe('Saved card ID'),
        customerId: z.string().optional(),
        capture: z.boolean().default(true).describe('Auto-capture (false for auth-only)'),
        description: z.string().optional(),
      }),
    },
    {
      name: 'qbo_charge_capture',
      description: 'Capture a previously authorized credit card charge. REQUIRES APPROVAL.',
      inputSchema: z.object({
        realmId: z.string(),
        chargeId: z.string(),
        amount: z.number().positive().optional().describe('Capture amount (defaults to auth amount)'),
      }),
    },
    {
      name: 'qbo_charge_refund',
      description: 'Refund a credit card charge. REQUIRES DUAL APPROVAL.',
      inputSchema: z.object({
        realmId: z.string(),
        chargeId: z.string(),
        amount: z.number().positive().optional().describe('Partial refund amount (defaults to full)'),
        description: z.string().optional(),
      }),
    },
    {
      name: 'qbo_charge_read',
      description: 'Read details of a credit card charge.',
      inputSchema: z.object({
        realmId: z.string(),
        chargeId: z.string(),
      }),
    },
    {
      name: 'qbo_echeck_create',
      description: 'Create an ACH/eCheck payment. REQUIRES DUAL APPROVAL. Payments are disabled by default.',
      inputSchema: z.object({
        realmId: z.string(),
        amount: z.number().positive(),
        token: z.string().optional(),
        bankAccountId: z.string().optional(),
        customerId: z.string().optional(),
        description: z.string().optional(),
        paymentMode: z.enum(['WEB', 'TEL', 'CCD', 'PPD']).default('WEB'),
      }),
    },
    {
      name: 'qbo_echeck_refund',
      description: 'Refund an eCheck payment. REQUIRES DUAL APPROVAL.',
      inputSchema: z.object({
        realmId: z.string(),
        echeckId: z.string(),
        amount: z.number().positive().optional(),
        description: z.string().optional(),
      }),
    },
    {
      name: 'qbo_token_create',
      description: 'Create a PCI-compliant payment token from card or bank data. Tokens are single-use.',
      inputSchema: z.object({
        realmId: z.string(),
        card: z.object({
          number: z.string(),
          expMonth: z.string(),
          expYear: z.string(),
          cvc: z.string(),
          name: z.string().optional(),
        }).optional(),
        bankAccount: z.object({
          routingNumber: z.string(),
          accountNumber: z.string(),
          name: z.string(),
          accountType: z.enum(['PERSONAL_CHECKING', 'PERSONAL_SAVINGS', 'BUSINESS_CHECKING', 'BUSINESS_SAVINGS']),
        }).optional(),
      }),
    },
    {
      name: 'qbo_card_list',
      description: 'List saved cards for a customer.',
      inputSchema: z.object({
        realmId: z.string(),
        customerId: z.string(),
      }),
    },
    {
      name: 'qbo_card_save',
      description: 'Save a card on file for a customer (from token). Requires approval.',
      inputSchema: z.object({
        realmId: z.string(),
        customerId: z.string(),
        token: z.string(),
      }),
    },
    {
      name: 'qbo_bank_account_manage',
      description: 'List or save bank accounts for a customer.',
      inputSchema: z.object({
        realmId: z.string(),
        customerId: z.string(),
        action: z.enum(['list', 'save', 'delete']),
        token: z.string().optional(),
        bankAccountId: z.string().optional(),
      }),
    },
  ];
}

type HttpClient = {
  get<T>(realmId: string, path: string, options?: Record<string, unknown>): Promise<T>;
  post<T>(realmId: string, path: string, body: unknown, options?: Record<string, unknown>): Promise<T>;
};

type GovernancePipeline = {
  evaluate(session: ToolContext, operation: string, entityType: string, payload: unknown): Promise<{
    proceed: boolean;
    queueForApproval?: boolean;
    approvalId?: string;
    denied?: boolean;
    reason?: string;
  }>;
};

type AuditLog = {
  log(entry: Record<string, unknown>): string;
};

export interface PaymentHandlerDeps {
  httpClient: HttpClient;
  governance: GovernancePipeline;
  auditLog: AuditLog;
  paymentsEnabled: boolean;
}

function result(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

function randomUUID(): string {
  return crypto.randomUUID();
}

export class PaymentHandler {
  private readonly baseUrl: string;

  constructor(
    private deps: PaymentHandlerDeps,
    environment: 'sandbox' | 'production' = 'sandbox',
  ) {
    this.baseUrl = environment === 'production'
      ? 'https://api.intuit.com/quickbooks/v4/payments'
      : 'https://sandbox.api.intuit.com/quickbooks/v4/payments';
  }

  async handleChargeCreate(ctx: ToolContext, params: Record<string, unknown>): Promise<ToolResult> {
    if (!this.deps.paymentsEnabled) {
      return result('Payment operations are disabled. An officer must enable payments for this company.', true);
    }

    const policy = await this.deps.governance.evaluate(ctx, 'PAYMENT', 'Charge', params);
    if (policy.denied) return result(`Access denied: ${policy.reason}`, true);
    if (policy.queueForApproval) {
      return result(JSON.stringify({
        status: 'queued_for_approval',
        approvalId: policy.approvalId,
        message: 'Payment operations require dual human approval.',
      }, null, 2));
    }

    const data = await this.deps.httpClient.post(
      params.realmId as string,
      `${this.baseUrl}/charges`,
      {
        amount: params.amount,
        currency: params.currency ?? 'USD',
        token: params.token,
        capture: params.capture ?? true,
        description: params.description,
      },
      {
        group: 'payments',
        headers: {
          'Company-Id': params.realmId,
          'Request-Id': randomUUID(),
        },
      },
    );

    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: params.realmId as string,
      toolName: 'qbo_charge_create',
      entityType: 'Charge',
      operation: 'PAYMENT_CHARGE',
      responseStatus: 200,
    });

    return result(JSON.stringify(data, null, 2));
  }

  async handleChargeRefund(ctx: ToolContext, params: Record<string, unknown>): Promise<ToolResult> {
    if (!this.deps.paymentsEnabled) {
      return result('Payment operations are disabled.', true);
    }

    const policy = await this.deps.governance.evaluate(ctx, 'PAYMENT', 'Refund', params);
    if (policy.denied) return result(`Access denied: ${policy.reason}`, true);
    if (policy.queueForApproval) {
      return result(JSON.stringify({
        status: 'queued_for_approval',
        approvalId: policy.approvalId,
        message: 'Refund operations require dual human approval.',
      }, null, 2));
    }

    const data = await this.deps.httpClient.post(
      params.realmId as string,
      `${this.baseUrl}/charges/${params.chargeId}/refunds`,
      { amount: params.amount, description: params.description },
      {
        group: 'payments',
        headers: {
          'Company-Id': params.realmId,
          'Request-Id': randomUUID(),
        },
      },
    );

    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: params.realmId as string,
      toolName: 'qbo_charge_refund',
      entityType: 'Refund',
      operation: 'PAYMENT_REFUND',
      responseStatus: 200,
    });

    return result(JSON.stringify(data, null, 2));
  }

  async handleTokenCreate(ctx: ToolContext, params: Record<string, unknown>): Promise<ToolResult> {
    // Token creation is allowed without payment being enabled (PCI tokenization)
    // But we NEVER log the full card/bank data
    const sanitizedParams = { ...params };
    delete sanitizedParams.card;
    delete sanitizedParams.bankAccount;

    const data = await this.deps.httpClient.post(
      params.realmId as string,
      `${this.baseUrl}/tokens`,
      { card: params.card, bankAccount: params.bankAccount },
      {
        group: 'payments',
        headers: {
          'Company-Id': params.realmId,
          'Request-Id': randomUUID(),
        },
      },
    );

    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: params.realmId as string,
      toolName: 'qbo_token_create',
      entityType: 'Token',
      operation: 'TOKENIZE',
      responseStatus: 200,
    });

    return result(JSON.stringify(data, null, 2));
  }

  async handleCardList(ctx: ToolContext, params: Record<string, unknown>): Promise<ToolResult> {
    const data = await this.deps.httpClient.get(
      params.realmId as string,
      `${this.baseUrl}/customers/${params.customerId}/cards`,
      { group: 'payments', headers: { 'Company-Id': params.realmId } },
    );

    return result(JSON.stringify(data, null, 2));
  }
}
