import { z } from 'zod';
import {
  QBOBaseEntity, QBOOptionalString, QBOAddress, QBOEmail, QBOPhone,
} from '../common.js';

/** NameValue pair */
export const NameValue = z.object({
  Name: z.string().optional(),
  Value: z.string().optional(),
}).passthrough();

/** CompanyInfo schema (company settings) */
export const CompanyInfoSchema = QBOBaseEntity.extend({
  CompanyName: z.string().optional(),
  LegalName: QBOOptionalString.optional(),
  CompanyAddr: QBOAddress,
  CustomerCommunicationAddr: QBOAddress,
  LegalAddr: QBOAddress,
  CompanyStartDate: z.string().optional(),
  FiscalYearStartMonth: z.string().optional(),
  Country: QBOOptionalString.optional(),
  PrimaryPhone: QBOPhone,
  CompanyEmailAddr: QBOEmail,
  WebAddr: z.object({ URI: z.string().optional() }).passthrough().optional(),
  SupportedLanguages: QBOOptionalString.optional(),
  NameValue: z.array(NameValue).optional(),
  EmployerId: QBOOptionalString.optional(),
}).passthrough();

export type CompanyInfo = z.infer<typeof CompanyInfoSchema>;
