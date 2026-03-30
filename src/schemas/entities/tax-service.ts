import { z } from 'zod';

/** TaxRateDetails for TaxService creation */
export const TaxServiceTaxRateDetails = z.object({
  TaxRateName: z.string(),
  RateValue: z.union([z.string(), z.number()]).optional(),
  TaxAgencyId: z.string().optional(),
  TaxApplicableOn: z.enum(['Sales', 'Purchase']).optional(),
}).passthrough();

/** TaxService schema (create-only proxy to generate TaxCode + TaxRate) */
export const TaxServiceSchema = z.object({
  TaxCode: z.string(),
  TaxCodeId: z.string().optional(),
  TaxRateDetails: z.array(TaxServiceTaxRateDetails),
}).passthrough();

export type TaxService = z.infer<typeof TaxServiceSchema>;
