import { z } from 'zod';
import { QBOBaseEntity, QBOOptionalString } from '../common.js';

/** Term schema (payment terms like Net 30) */
export const TermSchema = QBOBaseEntity.extend({
  Name: z.string(),
  Active: z.boolean().optional(),
  Type: z.enum(['STANDARD', 'DATE_DRIVEN']).optional(),
  DueDays: z.number().optional(),
  DiscountPercent: z.number().optional(),
  DiscountDays: z.number().optional(),
  DayOfMonthDue: z.number().optional(),
  DueNextMonthDays: z.number().optional(),
  DiscountDayOfMonth: z.number().optional(),
}).passthrough();

export type Term = z.infer<typeof TermSchema>;
