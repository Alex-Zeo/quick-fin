import { z } from 'zod';

export const ControlThresholdsSchema = z.object({
  invoiceAutoMax: z.number().default(5000),
  invoiceSingleApprovalMax: z.number().default(50000),
  billAutoMax: z.number().default(2500),
  billSingleApprovalMax: z.number().default(25000),
  paymentSingleApprovalMax: z.number().default(10000),
  refundSingleApprovalMax: z.number().default(5000),
  journalEntryAutoMax: z.number().default(1000),
  journalEntrySingleApprovalMax: z.number().default(25000),
  expenseAutoMax: z.number().default(500),
  expenseSingleApprovalMax: z.number().default(5000),
  estimateAutoMax: z.number().default(10000),
  estimateSingleApprovalMax: z.number().default(100000),
  dailyPaymentValueMax: z.number().default(25000),
  dailyInvoiceValueMax: z.number().default(250000),
  dailyJournalEntryCountMax: z.number().default(50),
  dailyRecordsModifiedMax: z.number().default(200),
  dailyRecordsDeletedMax: z.number().default(10),
  paymentCountPerHour: z.number().default(10),
  paymentCountPerDay: z.number().default(40),
  vendorCoolingPeriodHours: z.number().default(72),
  bulkOperationReversalMinutes: z.number().default(15),
  batchMaxSize: z.number().default(25),
  batchDryRunThreshold: z.number().default(5),
});

export const RateLimitSchema = z.object({
  requestsPerMinute: z.number().default(500),
  aiRequestsPerMinute: z.number().default(300),
  maxConcurrent: z.number().default(10),
  batchPerMinute: z.number().default(40),
});

export const OAuthSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  redirectUri: z.string().default('http://localhost:3000/callback'),
  environment: z.enum(['sandbox', 'production']).default('sandbox'),
});

export const AuditSchema = z.object({
  storePath: z.string().default('./data/audit.db'),
  s3Bucket: z.string().optional(),
  s3Region: z.string().optional(),
  retentionDays: z.number().default(2555), // 7 years
});

export const WebhookSchema = z.object({
  port: z.number().default(3001),
  verifierToken: z.string().optional(),
  enabled: z.boolean().default(false),
});

export const SecuritySchema = z.object({
  tokenEncryptionKey: z.string().optional(),
  kmsProvider: z.enum(['local', 'aws', 'azure', 'vault']).default('local'),
  kmsKeyId: z.string().optional(),
});

export const ConfigSchema = z.object({
  oauth: OAuthSchema,
  rateLimits: RateLimitSchema.default({}),
  thresholds: ControlThresholdsSchema.default({}),
  audit: AuditSchema.default({}),
  webhook: WebhookSchema.default({}),
  security: SecuritySchema.default({}),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  minorVersion: z.number().default(75),
  maxTenantsLru: z.number().default(50),
  tenantInactivityMinutes: z.number().default(30),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ControlThresholds = z.infer<typeof ControlThresholdsSchema>;
export type RateLimitConfig = z.infer<typeof RateLimitSchema>;
