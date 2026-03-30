import { z } from 'zod';
import { QBOBaseEntity, QBORefOptional, QBOOptionalString } from '../common.js';

/** Department schema (location/division) */
export const DepartmentSchema = QBOBaseEntity.extend({
  Name: z.string(),
  FullyQualifiedName: QBOOptionalString.optional(),
  Active: z.boolean().optional(),
  SubDepartment: z.boolean().optional(),
  ParentRef: QBORefOptional,
}).passthrough();

export type Department = z.infer<typeof DepartmentSchema>;
