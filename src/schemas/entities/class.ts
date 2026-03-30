import { z } from 'zod';
import { QBOBaseEntity, QBORefOptional, QBOOptionalString } from '../common.js';

/** Class schema (transaction classification) */
export const ClassSchema = QBOBaseEntity.extend({
  Name: z.string(),
  FullyQualifiedName: QBOOptionalString.optional(),
  Active: z.boolean().optional(),
  SubClass: z.boolean().optional(),
  ParentRef: QBORefOptional,
}).passthrough();

export type Class = z.infer<typeof ClassSchema>;
