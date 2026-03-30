import { z } from 'zod';
import { QBOBaseEntity, QBORef, QBOOptionalString } from '../common.js';
import { QBOMoneyOptional } from '../money.js';

/** TaxRateDetail within a TaxCode */
export const TaxRateDetail = z.object({
  TaxRateRef: QBORef.optional(),
  TaxTypeApplicable: z.enum(['TaxOnAmount', 'TaxOnAmountPlusTax', 'TaxOnTax']).optional(),
  TaxOrder: z.number().optional(),
}).passthrough();

/** TaxRateList */
export const TaxRateList = z.object({
  TaxRateDetail: z.array(TaxRateDetail).optional(),
}).passthrough().optional();

/** TaxCode schema */
export const TaxCodeSchema = QBOBaseEntity.extend({
  Name: z.string(),
  Description: QBOOptionalString.optional(),
  Active: z.boolean().optional(),
  Taxable: z.boolean().optional(),
  TaxGroup: z.boolean().optional(),
  Hidden: z.boolean().optional(),
  SalesTaxRateList: TaxRateList,
  PurchaseTaxRateList: TaxRateList,
}).passthrough();

export type TaxCode = z.infer<typeof TaxCodeSchema>;
