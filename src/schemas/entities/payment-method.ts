import { z } from 'zod';
import { QBOBaseEntity } from '../common.js';

/** PaymentMethod schema */
export const PaymentMethodSchema = QBOBaseEntity.extend({
  Name: z.string(),
  Active: z.boolean().optional(),
  Type: z.enum(['CREDIT_CARD', 'NON_CREDIT_CARD']).optional(),
}).passthrough();

export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
