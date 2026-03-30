import { z } from 'zod';
import {
  QBOBaseEntity, QBOOptionalString, QBOAddress, QBOEmail, QBOPhone,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';

/** Employee schema */
export const EmployeeSchema = QBOBaseEntity.extend({
  DisplayName: QBOOptionalString.optional(),
  Title: QBOOptionalString.optional(),
  GivenName: QBOOptionalString.optional(),
  MiddleName: QBOOptionalString.optional(),
  FamilyName: QBOOptionalString.optional(),
  Suffix: QBOOptionalString.optional(),
  PrintOnCheckName: QBOOptionalString.optional(),
  Active: z.boolean().optional(),
  PrimaryAddr: QBOAddress,
  PrimaryEmailAddr: QBOEmail,
  PrimaryPhone: QBOPhone,
  Mobile: QBOPhone,
  SSN: QBOOptionalString.optional(),
  Gender: z.enum(['Male', 'Female']).optional(),
  BirthDate: z.string().optional(),
  HiredDate: z.string().optional(),
  ReleasedDate: z.string().optional(),
  EmployeeNumber: QBOOptionalString.optional(),
  BillableTime: z.boolean().optional(),
  BillRate: z.number().optional(),
  CostRate: QBOMoneyOptional.optional(),
  V4IDPseudonym: QBOOptionalString.optional(),
}).passthrough();

export type Employee = z.infer<typeof EmployeeSchema>;
