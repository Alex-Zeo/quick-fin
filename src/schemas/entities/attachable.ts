import { z } from 'zod';
import { QBOBaseEntity, QBORef, QBOOptionalString } from '../common.js';

/** AttachableRef - links an attachment to an entity */
export const AttachableRef = z.object({
  EntityRef: QBORef.optional(),
  IncludeOnSend: z.boolean().optional(),
  LineInfo: z.string().optional(),
  NoRefOnly: z.boolean().optional(),
  Inactive: z.boolean().optional(),
}).passthrough();

/** Attachable schema (file attachments) */
export const AttachableSchema = QBOBaseEntity.extend({
  FileName: QBOOptionalString.optional(),
  FileAccessUri: QBOOptionalString.optional(),
  TempDownloadUri: QBOOptionalString.optional(),
  Size: z.number().optional(),
  ContentType: QBOOptionalString.optional(),
  Category: z.enum(['Image', 'Signature', 'Contact Photo', 'Receipt', 'Document', 'Other']).optional(),
  Lat: z.string().optional(),
  Long: z.string().optional(),
  PlaceName: QBOOptionalString.optional(),
  Note: QBOOptionalString.optional(),
  Tag: QBOOptionalString.optional(),
  ThumbnailFileAccessUri: QBOOptionalString.optional(),
  ThumbnailTempDownloadUri: QBOOptionalString.optional(),
  AttachableRef: z.array(AttachableRef).optional(),
}).passthrough();

export type Attachable = z.infer<typeof AttachableSchema>;
