import { z } from 'zod';
import { QBOBaseEntity, QBOOptionalString } from '../common.js';

/** CompanyCurrency schema */
export const CompanyCurrencySchema = QBOBaseEntity.extend({
  Code: z.string(),
  Name: QBOOptionalString.optional(),
  Active: z.boolean().optional(),
}).passthrough();

export type CompanyCurrency = z.infer<typeof CompanyCurrencySchema>;
