import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBOOptionalString,
  QBOAddress, QBOEmail, QBOPhone,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';

/** Vendor schema */
export const VendorSchema = QBOBaseEntity.extend({
  DisplayName: QBOOptionalString.optional(),
  Title: QBOOptionalString.optional(),
  GivenName: QBOOptionalString.optional(),
  MiddleName: QBOOptionalString.optional(),
  FamilyName: QBOOptionalString.optional(),
  Suffix: QBOOptionalString.optional(),
  CompanyName: QBOOptionalString.optional(),
  PrintOnCheckName: QBOOptionalString.optional(),
  Active: z.boolean().optional(),
  Vendor1099: z.boolean().optional(),
  T4AEligible: z.boolean().optional(),
  T5018Eligible: z.boolean().optional(),
  HasTPAR: z.boolean().optional(),
  TaxIdentifier: QBOOptionalString.optional(),
  TaxReportingBasis: z.enum(['Cash', 'Accrual']).optional(),
  ParentRef: QBORefOptional,
  Level: z.number().optional(),
  BillAddr: QBOAddress,
  PrimaryEmailAddr: QBOEmail,
  PrimaryPhone: QBOPhone,
  AlternatePhone: QBOPhone,
  Mobile: QBOPhone,
  Fax: QBOPhone,
  WebAddr: z.object({ URI: z.string().optional() }).passthrough().optional(),
  OtherContactInfo: z.object({
    Type: z.string().optional(),
    Telephone: QBOPhone,
  }).passthrough().optional(),
  TermRef: QBORefOptional,
  CurrencyRef: QBORefOptional,
  APAccountRef: QBORefOptional,
  Balance: QBOMoneyOptional.optional(),
  BillRate: z.number().optional(),
  AcctNum: QBOOptionalString.optional(),
  Source: QBOOptionalString.optional(),
  GSTRegistrationType: QBOOptionalString.optional(),
  BusinessNumber: QBOOptionalString.optional(),
}).passthrough();

export type Vendor = z.infer<typeof VendorSchema>;
