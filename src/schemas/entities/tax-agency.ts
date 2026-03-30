import { z } from 'zod';
import { QBOBaseEntity, QBOOptionalString } from '../common.js';

/** TaxAgency schema */
export const TaxAgencySchema = QBOBaseEntity.extend({
  DisplayName: z.string(),
  TaxTrackedOnSales: z.boolean().optional(),
  TaxTrackedOnPurchases: z.boolean().optional(),
  TaxRegistrationNumber: QBOOptionalString.optional(),
  LastFileDate: z.string().optional(),
}).passthrough();

export type TaxAgency = z.infer<typeof TaxAgencySchema>;
