import { z } from 'zod';
import { QBOBaseEntity, QBORef, QBORefOptional, QBOOptionalString } from '../common.js';

/** EffectiveTaxRate */
export const EffectiveTaxRate = z.object({
  RateValue: z.number().optional(),
  EffectiveDate: z.string().optional(),
  EndDate: z.string().optional(),
}).passthrough();

/** TaxRate schema */
export const TaxRateSchema = QBOBaseEntity.extend({
  Name: z.string(),
  Description: QBOOptionalString.optional(),
  Active: z.boolean().optional(),
  RateValue: z.number().optional(),
  AgencyRef: QBORefOptional,
  TaxReturnLineRef: QBORefOptional,
  SpecialTaxType: z.string().optional(),
  DisplayType: z.string().optional(),
  EffectiveTaxRate: z.array(EffectiveTaxRate).optional(),
  OriginalTaxRate: z.string().optional(),
}).passthrough();

export type TaxRate = z.infer<typeof TaxRateSchema>;
