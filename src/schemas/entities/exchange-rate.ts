import { z } from 'zod';
import { QBOBaseEntity, QBOOptionalString } from '../common.js';

/** ExchangeRate schema */
export const ExchangeRateSchema = QBOBaseEntity.extend({
  SourceCurrencyCode: z.string(),
  TargetCurrencyCode: z.string().optional(),
  Rate: z.number(),
  AsOfDate: z.string().optional(),
}).passthrough();

export type ExchangeRate = z.infer<typeof ExchangeRateSchema>;
