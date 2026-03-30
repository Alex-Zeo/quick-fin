import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional, QBOOptionalString,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';

/** Item type */
export const ItemType = z.enum([
  'Inventory', 'Service', 'NonInventory', 'Group', 'Category',
  'Bundle', 'FixedAsset',
]);

/** Item schema (products and services) */
export const ItemSchema = QBOBaseEntity.extend({
  Name: z.string(),
  Type: ItemType.optional(),
  Active: z.boolean().optional(),
  Description: QBOOptionalString.optional(),
  PurchaseDesc: QBOOptionalString.optional(),
  FullyQualifiedName: QBOOptionalString.optional(),
  Taxable: z.boolean().optional(),
  SalesTaxIncluded: z.boolean().optional(),
  PurchaseTaxIncluded: z.boolean().optional(),
  UnitPrice: QBOMoneyOptional.optional(),
  RatePercent: z.number().optional(),
  PurchaseCost: QBOMoneyOptional.optional(),
  QtyOnHand: z.number().optional(),
  ReorderPoint: z.number().optional(),
  InvStartDate: QBODateOptional,
  TrackQtyOnHand: z.boolean().optional(),
  Sku: QBOOptionalString.optional(),
  IncomeAccountRef: QBORefOptional,
  ExpenseAccountRef: QBORefOptional,
  AssetAccountRef: QBORefOptional,
  ParentRef: QBORefOptional,
  SubItem: z.boolean().optional(),
  Level: z.number().optional(),
  SalesTaxCodeRef: QBORefOptional,
  PurchaseTaxCodeRef: QBORefOptional,
  ClassRef: QBORefOptional,
  AbatementRate: z.number().optional(),
  ReverseChargeRate: z.number().optional(),
  ServiceType: z.string().optional(),
  ItemCategoryType: z.string().optional(),
  Source: QBOOptionalString.optional(),
}).passthrough();

export type Item = z.infer<typeof ItemSchema>;
