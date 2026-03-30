/**
 * Unified handler for all entity CRUD operations.
 * Routes through governance pipeline before making API calls.
 */

import { type ToolContext, type ToolResult, getEntityConfig } from './entity-tools.js';

export type HttpClient = {
  get<T>(realmId: string, path: string, options?: Record<string, unknown>): Promise<T>;
  post<T>(realmId: string, path: string, body: unknown, options?: Record<string, unknown>): Promise<T>;
};

export type GovernancePipeline = {
  evaluate(session: ToolContext, operation: string, entityType: string, payload: unknown): Promise<{
    proceed: boolean;
    queueForApproval?: boolean;
    approvalId?: string;
    denied?: boolean;
    reason?: string;
  }>;
};

export type AuditLog = {
  log(entry: Record<string, unknown>): string;
};

export type IdempotencyCheck = {
  check(fingerprint: string): { exists: boolean; result?: unknown };
  record(fingerprint: string, result: unknown): void;
};

export type PIIMasker = {
  maskEntity(entityType: string, entity: unknown, tier: number): unknown;
};

export interface EntityHandlerDeps {
  httpClient: HttpClient;
  governance: GovernancePipeline;
  auditLog: AuditLog;
  idempotency: IdempotencyCheck;
  piiMasker: PIIMasker;
}

function toJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function result(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

export class EntityHandler {
  constructor(private deps: EntityHandlerDeps) {}

  async handleRead(
    ctx: ToolContext,
    entityName: string,
    params: { realmId: string; id: string },
  ): Promise<ToolResult> {
    // Governance check
    const policy = await this.deps.governance.evaluate(ctx, 'READ', entityName, params);
    if (policy.denied) return result(`Access denied: ${policy.reason}`, true);

    // API call
    const data = await this.deps.httpClient.get(
      params.realmId,
      `/v3/company/${params.realmId}/${entityName.toLowerCase()}/${params.id}`,
      { group: 'accounting-crud' },
    );

    // Audit
    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: params.realmId,
      toolName: `qbo_read_${entityName.toLowerCase()}`,
      entityType: entityName,
      entityId: params.id,
      operation: 'READ',
      responseStatus: 200,
    });

    // PII masking
    const masked = this.deps.piiMasker.maskEntity(entityName, data, ctx.tier);
    return result(toJson(masked));
  }

  async handleCreate(
    ctx: ToolContext,
    entityName: string,
    params: { realmId: string; entity: Record<string, unknown> },
  ): Promise<ToolResult> {
    // Compute idempotency fingerprint
    const sortedKeys = Object.keys(params.entity).sort();
    const fp = sortedKeys.map((k) => `${k}:${JSON.stringify(params.entity[k])}`).join('|');
    const fingerprint = `CREATE:${entityName}:${fp}`;

    // Idempotency check
    const existing = this.deps.idempotency.check(fingerprint);
    if (existing.exists) {
      return result(toJson({ cached: true, entity: existing.result }));
    }

    // Governance check (includes RBAC, SoD, period, materiality)
    const policy = await this.deps.governance.evaluate(ctx, 'CREATE', entityName, params.entity);
    if (policy.denied) return result(`Access denied: ${policy.reason}`, true);
    if (policy.queueForApproval) {
      return result(toJson({
        status: 'queued_for_approval',
        approvalId: policy.approvalId,
        message: `This ${entityName} creation requires approval. Use qbo_list_pending_approvals to check status.`,
      }));
    }

    // API call
    const data = await this.deps.httpClient.post(
      params.realmId,
      `/v3/company/${params.realmId}/${entityName.toLowerCase()}`,
      params.entity,
      { group: 'accounting-crud' },
    );

    const entityData = data as Record<string, unknown>;
    const created = (entityData[entityName] ?? entityData) as Record<string, unknown>;

    // Record idempotency
    this.deps.idempotency.record(fingerprint, created);

    // Audit
    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: params.realmId,
      toolName: `qbo_create_${entityName.toLowerCase()}`,
      entityType: entityName,
      entityId: created.Id as string,
      operation: 'CREATE',
      responseStatus: 200,
      syncTokenAfter: created.SyncToken as string,
    });

    const masked = this.deps.piiMasker.maskEntity(entityName, created, ctx.tier);
    return result(toJson(masked));
  }

  async handleUpdate(
    ctx: ToolContext,
    entityName: string,
    params: { realmId: string; id: string; updates: Record<string, unknown> },
  ): Promise<ToolResult> {
    // Governance check
    const policy = await this.deps.governance.evaluate(ctx, 'UPDATE', entityName, params.updates);
    if (policy.denied) return result(`Access denied: ${policy.reason}`, true);
    if (policy.queueForApproval) {
      return result(toJson({
        status: 'queued_for_approval',
        approvalId: policy.approvalId,
        message: `This ${entityName} update requires approval.`,
      }));
    }

    // Read current entity for SyncToken
    const current = await this.deps.httpClient.get<Record<string, unknown>>(
      params.realmId,
      `/v3/company/${params.realmId}/${entityName.toLowerCase()}/${params.id}`,
      { group: 'accounting-crud' },
    );
    const currentEntity = (current[entityName] ?? current) as Record<string, unknown>;
    const syncTokenBefore = currentEntity.SyncToken as string;

    // Sparse update
    const updatePayload = {
      ...params.updates,
      Id: params.id,
      SyncToken: syncTokenBefore,
      sparse: true,
    };

    const data = await this.deps.httpClient.post(
      params.realmId,
      `/v3/company/${params.realmId}/${entityName.toLowerCase()}`,
      updatePayload,
      { group: 'accounting-crud' },
    );

    const entityData = data as Record<string, unknown>;
    const updated = (entityData[entityName] ?? entityData) as Record<string, unknown>;

    // Audit
    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: params.realmId,
      toolName: `qbo_update_${entityName.toLowerCase()}`,
      entityType: entityName,
      entityId: params.id,
      operation: 'UPDATE',
      responseStatus: 200,
      syncTokenBefore,
      syncTokenAfter: updated.SyncToken as string,
    });

    const masked = this.deps.piiMasker.maskEntity(entityName, updated, ctx.tier);
    return result(toJson(masked));
  }

  async handleDelete(
    ctx: ToolContext,
    entityName: string,
    params: { realmId: string; id: string; syncToken: string },
  ): Promise<ToolResult> {
    const config = getEntityConfig(entityName);
    if (!config?.canDelete) {
      return result(`${entityName} does not support delete. Use deactivate instead.`, true);
    }

    const policy = await this.deps.governance.evaluate(ctx, 'DELETE', entityName, params);
    if (policy.denied) return result(`Access denied: ${policy.reason}`, true);
    if (policy.queueForApproval) {
      return result(toJson({
        status: 'queued_for_approval',
        approvalId: policy.approvalId,
        message: `This ${entityName} deletion requires approval.`,
      }));
    }

    await this.deps.httpClient.post(
      params.realmId,
      `/v3/company/${params.realmId}/${entityName.toLowerCase()}?operation=delete`,
      { Id: params.id, SyncToken: params.syncToken },
      { group: 'accounting-crud' },
    );

    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: params.realmId,
      toolName: `qbo_delete_${entityName.toLowerCase()}`,
      entityType: entityName,
      entityId: params.id,
      operation: 'DELETE',
      responseStatus: 200,
      syncTokenBefore: params.syncToken,
    });

    return result(toJson({ deleted: true, entityType: entityName, id: params.id }));
  }

  async handleVoid(
    ctx: ToolContext,
    entityName: string,
    params: { realmId: string; id: string; syncToken: string; reason: string },
  ): Promise<ToolResult> {
    const config = getEntityConfig(entityName);
    if (!config?.canVoid) {
      return result(`${entityName} does not support void.`, true);
    }

    // Voids ALWAYS require approval
    const policy = await this.deps.governance.evaluate(ctx, 'VOID', entityName, {
      ...params,
      requiresApproval: true,
    });
    if (policy.denied) return result(`Access denied: ${policy.reason}`, true);
    if (policy.queueForApproval) {
      return result(toJson({
        status: 'queued_for_approval',
        approvalId: policy.approvalId,
        message: `Void operations always require human approval. Reason recorded: ${params.reason}`,
      }));
    }

    const data = await this.deps.httpClient.post(
      params.realmId,
      `/v3/company/${params.realmId}/${entityName.toLowerCase()}?operation=void`,
      { Id: params.id, SyncToken: params.syncToken },
      { group: 'accounting-crud' },
    );

    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: params.realmId,
      toolName: `qbo_void_${entityName.toLowerCase()}`,
      entityType: entityName,
      entityId: params.id,
      operation: 'VOID',
      responseStatus: 200,
      syncTokenBefore: params.syncToken,
    });

    return result(toJson({ voided: true, entityType: entityName, id: params.id, reason: params.reason }));
  }

  async handleSend(
    ctx: ToolContext,
    entityName: string,
    params: { realmId: string; id: string; sendTo?: string },
  ): Promise<ToolResult> {
    // Email sends are ALWAYS queued, never direct
    const policy = await this.deps.governance.evaluate(ctx, 'SEND_EMAIL', entityName, params);
    if (policy.denied) return result(`Access denied: ${policy.reason}`, true);

    // Queue for human review instead of sending directly
    return result(toJson({
      status: 'queued_for_review',
      message: `${entityName} ${params.id} has been queued for email review. Email sending requires human approval.`,
      entityType: entityName,
      entityId: params.id,
      sendTo: params.sendTo ?? 'default recipient',
    }));
  }

  async handlePdf(
    ctx: ToolContext,
    entityName: string,
    params: { realmId: string; id: string },
  ): Promise<ToolResult> {
    const policy = await this.deps.governance.evaluate(ctx, 'READ', entityName, params);
    if (policy.denied) return result(`Access denied: ${policy.reason}`, true);

    // PDF download returns base64
    const data = await this.deps.httpClient.get<Buffer>(
      params.realmId,
      `/v3/company/${params.realmId}/${entityName.toLowerCase()}/${params.id}/pdf`,
      { group: 'accounting-crud', headers: { Accept: 'application/pdf' } },
    );

    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: params.realmId,
      toolName: `qbo_pdf_${entityName.toLowerCase()}`,
      entityType: entityName,
      entityId: params.id,
      operation: 'PDF_DOWNLOAD',
      responseStatus: 200,
    });

    return result(toJson({
      entityType: entityName,
      id: params.id,
      format: 'pdf',
      message: `PDF downloaded for ${entityName} ${params.id}. Contains ${(data as unknown as Buffer).length ?? 0} bytes.`,
    }));
  }

  async handleQuery(
    ctx: ToolContext,
    entityName: string,
    params: { realmId: string; where?: string; orderBy?: string; maxResults?: number; startPosition?: number },
  ): Promise<ToolResult> {
    const policy = await this.deps.governance.evaluate(ctx, 'READ', entityName, params);
    if (policy.denied) return result(`Access denied: ${policy.reason}`, true);

    const maxResults = Math.min(params.maxResults ?? 100, 1000);
    const startPos = params.startPosition ?? 1;

    let query = `SELECT * FROM ${entityName}`;
    if (params.where) query += ` WHERE ${params.where}`;
    if (params.orderBy) query += ` ORDERBY ${params.orderBy}`;
    query += ` STARTPOSITION ${startPos} MAXRESULTS ${maxResults}`;

    const data = await this.deps.httpClient.get<Record<string, unknown>>(
      params.realmId,
      `/v3/company/${params.realmId}/query?query=${encodeURIComponent(query)}`,
      { group: 'accounting-crud' },
    );

    const qr = data.QueryResponse as Record<string, unknown> | undefined;
    const entities = (qr?.[entityName] ?? []) as unknown[];
    const totalCount = qr?.totalCount as number | undefined;

    // Mask all entities
    const masked = entities.map((e) => this.deps.piiMasker.maskEntity(entityName, e, ctx.tier));

    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: params.realmId,
      toolName: `qbo_query_${entityName.toLowerCase()}`,
      entityType: entityName,
      operation: 'QUERY',
      responseStatus: 200,
    });

    return result(toJson({
      entityType: entityName,
      results: masked,
      count: entities.length,
      totalCount,
      startPosition: startPos,
      maxResults,
      hasMore: totalCount != null ? startPos + maxResults - 1 < totalCount : entities.length === maxResults,
    }));
  }

  async handleDeactivate(
    ctx: ToolContext,
    entityName: string,
    params: { realmId: string; id: string; syncToken: string },
  ): Promise<ToolResult> {
    const policy = await this.deps.governance.evaluate(ctx, 'UPDATE', entityName, params);
    if (policy.denied) return result(`Access denied: ${policy.reason}`, true);

    const data = await this.deps.httpClient.post(
      params.realmId,
      `/v3/company/${params.realmId}/${entityName.toLowerCase()}`,
      { Id: params.id, SyncToken: params.syncToken, Active: false, sparse: true },
      { group: 'accounting-crud' },
    );

    this.deps.auditLog.log({
      traceId: ctx.traceId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      realmId: params.realmId,
      toolName: `qbo_deactivate_${entityName.toLowerCase()}`,
      entityType: entityName,
      entityId: params.id,
      operation: 'DEACTIVATE',
      responseStatus: 200,
      syncTokenBefore: params.syncToken,
    });

    return result(toJson({ deactivated: true, entityType: entityName, id: params.id }));
  }
}
