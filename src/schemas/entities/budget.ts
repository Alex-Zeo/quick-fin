import { z } from 'zod';
import { QBOBaseEntity, QBORef, QBORefOptional, QBOOptionalString } from '../common.js';
import { QBOMoneyOptional } from '../money.js';

/** BudgetDetail line */
export const BudgetDetail = z.object({
  BudgetDate: z.string().optional(),
  Amount: QBOMoneyOptional.optional(),
  AccountRef: QBORef.optional(),
  CustomerRef: QBORef.optional(),
  ClassRef: QBORef.optional(),
  DepartmentRef: QBORef.optional(),
}).passthrough();

/** Budget schema (read-only via API) */
export const BudgetSchema = QBOBaseEntity.extend({
  Name: z.string().optional(),
  Active: z.boolean().optional(),
  StartDate: z.string().optional(),
  EndDate: z.string().optional(),
  BudgetType: z.enum(['ProfitAndLoss', 'BalanceSheet']).optional(),
  BudgetEntryType: z.enum(['Monthly', 'Quarterly', 'Annually']).optional(),
  BudgetDetail: z.array(BudgetDetail).optional(),
}).passthrough();

export type Budget = z.infer<typeof BudgetSchema>;
