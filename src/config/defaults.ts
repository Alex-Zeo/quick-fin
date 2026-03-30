import { ConfigSchema, type Config } from './schema.js';

export function loadConfig(overrides: Record<string, unknown> = {}): Config {
  const raw = {
    oauth: {
      clientId: process.env.QBO_CLIENT_ID ?? '',
      clientSecret: process.env.QBO_CLIENT_SECRET ?? '',
      redirectUri: process.env.QBO_REDIRECT_URI,
      environment: process.env.QBO_ENVIRONMENT,
    },
    rateLimits: {},
    thresholds: {},
    audit: {
      s3Bucket: process.env.AUDIT_S3_BUCKET,
      s3Region: process.env.AUDIT_S3_REGION,
    },
    webhook: {
      port: process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : undefined,
      verifierToken: process.env.WEBHOOK_VERIFIER_TOKEN,
      enabled: process.env.WEBHOOK_ENABLED === 'true',
    },
    security: {
      tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
      kmsProvider: process.env.KMS_PROVIDER,
      kmsKeyId: process.env.KMS_KEY_ID,
    },
    logLevel: process.env.LOG_LEVEL,
    ...overrides,
  };

  return ConfigSchema.parse(raw);
}
