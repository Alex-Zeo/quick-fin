import { z } from 'zod';
import { QBOBaseEntity, QBOOptionalString } from '../common.js';

/** JournalCode schema (France locale only) */
export const JournalCodeSchema = QBOBaseEntity.extend({
  Name: z.string(),
  Type: z.enum([
    'Expenses', 'Sales', 'Bank', 'Nouveaux', 'Wages', 'Cash',
  ]).optional(),
  Description: QBOOptionalString.optional(),
  Active: z.boolean().optional(),
}).passthrough();

export type JournalCode = z.infer<typeof JournalCodeSchema>;
