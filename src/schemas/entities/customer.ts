import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBOOptionalString,
  QBOAddress, QBOEmail, QBOPhone,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';

/** Customer schema */
export const CustomerSchema = QBOBaseEntity.extend({
  DisplayName: QBOOptionalString.optional(),
  Title: QBOOptionalString.optional(),
  GivenName: QBOOptionalString.optional(),
  MiddleName: QBOOptionalString.optional(),
  FamilyName: QBOOptionalString.optional(),
  Suffix: QBOOptionalString.optional(),
  CompanyName: QBOOptionalString.optional(),
  FullyQualifiedName: QBOOptionalString.optional(),
  PrintOnCheckName: QBOOptionalString.optional(),
  Active: z.boolean().optional(),
  Taxable: z.boolean().optional(),
  Job: z.boolean().optional(),
  BillWithParent: z.boolean().optional(),
  IsProject: z.boolean().optional(),
  ParentRef: QBORefOptional,
  Level: z.number().optional(),
  BillAddr: QBOAddress,
  ShipAddr: QBOAddress,
  PrimaryEmailAddr: QBOEmail,
  PrimaryPhone: QBOPhone,
  AlternatePhone: QBOPhone,
  Mobile: QBOPhone,
  Fax: QBOPhone,
  WebAddr: z.object({ URI: z.string().optional() }).passthrough().optional(),
  Notes: QBOOptionalString.optional(),
  PaymentMethodRef: QBORefOptional,
  SalesTermRef: QBORefOptional,
  DefaultTaxCodeRef: QBORefOptional,
  CurrencyRef: QBORefOptional,
  PreferredDeliveryMethod: z.enum(['Print', 'Email', 'None']).optional(),
  Balance: QBOMoneyOptional.optional(),
  BalanceWithJobs: QBOMoneyOptional.optional(),
  OpenBalanceDate: z.string().optional(),
  TaxExemptionReasonId: z.string().optional(),
  ResaleNum: QBOOptionalString.optional(),
  ARAccountRef: QBORefOptional,
  Source: QBOOptionalString.optional(),
  PrimaryTaxIdentifier: QBOOptionalString.optional(),
  GSTRegistrationType: QBOOptionalString.optional(),
  BusinessNumber: QBOOptionalString.optional(),
}).passthrough();

export type Customer = z.infer<typeof CustomerSchema>;
