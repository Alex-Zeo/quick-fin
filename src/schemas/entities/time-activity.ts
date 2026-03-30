import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODate, QBODateOptional,
  QBOOptionalString,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';

/** TimeActivity schema */
export const TimeActivitySchema = QBOBaseEntity.extend({
  NameOf: z.enum(['Employee', 'Vendor', 'Other']).optional(),
  EmployeeRef: QBORefOptional,
  VendorRef: QBORefOptional,
  CustomerRef: QBORefOptional,
  ItemRef: QBORefOptional,
  ClassRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  PayrollItemRef: QBORefOptional,
  ProjectRef: QBORefOptional,
  TxnDate: QBODateOptional,
  Description: QBOOptionalString.optional(),
  Hours: z.number().optional(),
  Minutes: z.number().optional(),
  StartTime: z.string().optional(),
  EndTime: z.string().optional(),
  BreakHours: z.number().optional(),
  BreakMinutes: z.number().optional(),
  Taxable: z.boolean().optional(),
  BillableStatus: z.enum(['Billable', 'NotBillable', 'HasBeenBilled']).optional(),
  HourlyRate: QBOMoneyOptional.optional(),
  CostRate: QBOMoneyOptional.optional(),
  TimeZone: QBOOptionalString.optional(),
}).passthrough();

export type TimeActivity = z.infer<typeof TimeActivitySchema>;
