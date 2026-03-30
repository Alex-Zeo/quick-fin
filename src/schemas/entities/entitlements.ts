import { z } from 'zod';

/** Entitlement detail */
export const EntitlementItem = z.object({
  name: z.string().optional(),
  id: z.string().optional(),
  term: z.string().optional(),
}).passthrough();

/** Entitlements schema (subscription info, read-only) */
export const EntitlementsSchema = z.object({
  Id: z.string().optional(),
  Entitlement: z.array(EntitlementItem).optional(),
}).passthrough();

export type Entitlements = z.infer<typeof EntitlementsSchema>;
