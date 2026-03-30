import { z } from 'zod';

/** QBO Reference type (e.g., CustomerRef, VendorRef) */
export const QBORef = z.object({
  value: z.union([z.string(), z.number()]).transform((v) => String(v)),
  name: z.string().optional(),
}).passthrough();

export const QBORefOptional = QBORef.optional().nullable();

/** QBO Date: normalize various formats to YYYY-MM-DD */
export const QBODate = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}/.test(v), {
  message: 'Expected date in YYYY-MM-DD format',
});

export const QBODateOptional = z.string().optional().nullable();

/** Coerce null/"" to undefined */
export const QBOOptionalString = z.union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v === '' || v == null ? undefined : v));

/** QBO MetaData (read-only) */
export const QBOMetaData = z.object({
  CreateTime: z.string().optional(),
  LastUpdatedTime: z.string().optional(),
}).passthrough().optional();

/** QBO Address */
export const QBOAddress = z.object({
  Id: z.string().optional(),
  Line1: z.string().optional(),
  Line2: z.string().optional(),
  Line3: z.string().optional(),
  City: z.string().optional(),
  CountrySubDivisionCode: z.string().optional(),
  PostalCode: z.string().optional(),
  Country: z.string().optional(),
  Lat: z.string().optional(),
  Long: z.string().optional(),
}).passthrough().optional();

/** QBO Email */
export const QBOEmail = z.object({
  Address: z.string().optional(),
}).passthrough().optional();

/** QBO Phone */
export const QBOPhone = z.object({
  FreeFormNumber: z.string().optional(),
}).passthrough().optional();

/** QBO Line Item (base) */
export const QBOLineItemBase = z.object({
  Id: z.string().optional(),
  LineNum: z.number().optional(),
  Description: z.string().optional(),
  Amount: z.union([z.string(), z.number()]).optional(),
  DetailType: z.string(),
}).passthrough();

/** Sparse update flag */
export const SparseUpdate = z.object({
  Id: z.string(),
  SyncToken: z.string(),
  sparse: z.literal(true).default(true),
}).passthrough();

/** Standard entity fields present on all QBO entities */
export const QBOBaseEntity = z.object({
  Id: z.string().optional(),
  SyncToken: z.string().optional(),
  MetaData: QBOMetaData,
  domain: z.string().optional(),
}).passthrough();

/** Custom field */
export const QBOCustomField = z.object({
  DefinitionId: z.string().optional(),
  Name: z.string().optional(),
  Type: z.string().optional(),
  StringValue: z.string().optional(),
}).passthrough();

/** Linked transaction reference */
export const QBOLinkedTxn = z.object({
  TxnId: z.string(),
  TxnType: z.string(),
  TxnLineId: z.string().optional(),
}).passthrough();

export type Ref = z.infer<typeof QBORef>;
