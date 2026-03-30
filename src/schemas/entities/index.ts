import { z } from 'zod';

// --- Re-exports from all entity schemas ---

export { InvoiceSchema, type Invoice, InvoiceLine, InvoiceSalesItemLineDetail, TxnTaxDetail, DeliveryInfo } from './invoice.js';
export { CustomerSchema, type Customer } from './customer.js';
export { VendorSchema, type Vendor } from './vendor.js';
export { BillSchema, type Bill, BillLine, ItemBasedExpenseLineDetail, AccountBasedExpenseLineDetail } from './bill.js';
export { PaymentSchema, type Payment, PaymentLine } from './payment.js';
export { AccountSchema, type Account, AccountType, AccountClassification } from './account.js';
export { ItemSchema, type Item, ItemType } from './item.js';
export { JournalEntrySchema, type JournalEntry, JournalEntryLine, JournalEntryLineDetail } from './journal-entry.js';
export { EstimateSchema, type Estimate } from './estimate.js';
export { SalesReceiptSchema, type SalesReceipt } from './sales-receipt.js';
export { CreditMemoSchema, type CreditMemo } from './credit-memo.js';
export { BillPaymentSchema, type BillPayment, BillPaymentLine, CheckPayment, CreditCardPayment } from './bill-payment.js';
export { PurchaseSchema, type Purchase, PurchaseLine } from './purchase.js';
export { PurchaseOrderSchema, type PurchaseOrder, PurchaseOrderLine } from './purchase-order.js';
export { DepositSchema, type Deposit, DepositLine, DepositLineDetail, CashBackInfo } from './deposit.js';
export { TransferSchema, type Transfer } from './transfer.js';
export { RefundReceiptSchema, type RefundReceipt } from './refund-receipt.js';
export { VendorCreditSchema, type VendorCredit } from './vendor-credit.js';
export { TimeActivitySchema, type TimeActivity } from './time-activity.js';
export { EmployeeSchema, type Employee } from './employee.js';
export { ClassSchema, type Class } from './class.js';
export { DepartmentSchema, type Department } from './department.js';
export { TermSchema, type Term } from './term.js';
export { PaymentMethodSchema, type PaymentMethod } from './payment-method.js';
export { TaxAgencySchema, type TaxAgency } from './tax-agency.js';
export { TaxCodeSchema, type TaxCode, TaxRateDetail, TaxRateList } from './tax-code.js';
export { TaxRateSchema, type TaxRate, EffectiveTaxRate } from './tax-rate.js';
export { TaxServiceSchema, type TaxService } from './tax-service.js';
export { JournalCodeSchema, type JournalCode } from './journal-code.js';
export { BudgetSchema, type Budget, BudgetDetail } from './budget.js';
export { CompanyCurrencySchema, type CompanyCurrency } from './company-currency.js';
export { AttachableSchema, type Attachable, AttachableRef } from './attachable.js';
export { CompanyInfoSchema, type CompanyInfo, NameValue } from './company-info.js';
export { EntitlementsSchema, type Entitlements } from './entitlements.js';
export { ExchangeRateSchema, type ExchangeRate } from './exchange-rate.js';
export { PreferencesSchema, type Preferences } from './preferences.js';

// --- Import schemas for the map ---

import { InvoiceSchema } from './invoice.js';
import { CustomerSchema } from './customer.js';
import { VendorSchema } from './vendor.js';
import { BillSchema } from './bill.js';
import { PaymentSchema } from './payment.js';
import { AccountSchema } from './account.js';
import { ItemSchema } from './item.js';
import { JournalEntrySchema } from './journal-entry.js';
import { EstimateSchema } from './estimate.js';
import { SalesReceiptSchema } from './sales-receipt.js';
import { CreditMemoSchema } from './credit-memo.js';
import { BillPaymentSchema } from './bill-payment.js';
import { PurchaseSchema } from './purchase.js';
import { PurchaseOrderSchema } from './purchase-order.js';
import { DepositSchema } from './deposit.js';
import { TransferSchema } from './transfer.js';
import { RefundReceiptSchema } from './refund-receipt.js';
import { VendorCreditSchema } from './vendor-credit.js';
import { TimeActivitySchema } from './time-activity.js';
import { EmployeeSchema } from './employee.js';
import { ClassSchema } from './class.js';
import { DepartmentSchema } from './department.js';
import { TermSchema } from './term.js';
import { PaymentMethodSchema } from './payment-method.js';
import { TaxAgencySchema } from './tax-agency.js';
import { TaxCodeSchema } from './tax-code.js';
import { TaxRateSchema } from './tax-rate.js';
import { TaxServiceSchema } from './tax-service.js';
import { JournalCodeSchema } from './journal-code.js';
import { BudgetSchema } from './budget.js';
import { CompanyCurrencySchema } from './company-currency.js';
import { AttachableSchema } from './attachable.js';
import { CompanyInfoSchema } from './company-info.js';
import { EntitlementsSchema } from './entitlements.js';
import { ExchangeRateSchema } from './exchange-rate.js';
import { PreferencesSchema } from './preferences.js';

// --- Entity name constants and classification ---

/** All entity names as a const tuple */
export const ALL_ENTITY_NAMES = [
  'Invoice', 'Customer', 'Vendor', 'Bill', 'Payment',
  'Account', 'Item', 'JournalEntry', 'Estimate', 'SalesReceipt',
  'CreditMemo', 'BillPayment', 'Purchase', 'PurchaseOrder', 'Deposit',
  'Transfer', 'RefundReceipt', 'VendorCredit', 'TimeActivity',
  'Employee', 'Class', 'Department', 'Term', 'PaymentMethod',
  'TaxAgency', 'TaxCode', 'TaxRate', 'TaxService', 'JournalCode',
  'Budget', 'CompanyCurrency', 'Attachable', 'CompanyInfo',
  'Entitlements', 'ExchangeRate', 'Preferences',
] as const;

/** Union type of all entity names */
export type EntityName = (typeof ALL_ENTITY_NAMES)[number];

/** Transaction entities (financial transactions) */
export const TRANSACTION_ENTITIES = [
  'Invoice', 'Bill', 'Payment', 'JournalEntry', 'Estimate',
  'SalesReceipt', 'CreditMemo', 'BillPayment', 'Purchase',
  'PurchaseOrder', 'Deposit', 'Transfer', 'RefundReceipt',
  'VendorCredit', 'TimeActivity',
] as const satisfies readonly EntityName[];

/** Name list entities (reference/master data) */
export const NAME_LIST_ENTITIES = [
  'Account', 'Customer', 'Vendor', 'Employee', 'Item',
  'Class', 'Department', 'Term', 'PaymentMethod',
  'TaxAgency', 'TaxCode', 'TaxRate', 'TaxService',
  'JournalCode', 'Budget', 'CompanyCurrency',
] as const satisfies readonly EntityName[];

/** Supporting entities */
export const SUPPORTING_ENTITIES = [
  'Attachable', 'CompanyInfo', 'Entitlements',
  'ExchangeRate', 'Preferences',
] as const satisfies readonly EntityName[];

/** Entities that support the void operation */
export const VOIDABLE_ENTITIES = [
  'Invoice', 'Payment', 'SalesReceipt', 'BillPayment',
] as const satisfies readonly EntityName[];

/** Entities that support send/email */
export const EMAILABLE_ENTITIES = [
  'Invoice', 'Estimate', 'CreditMemo', 'SalesReceipt', 'PurchaseOrder',
] as const satisfies readonly EntityName[];

/** Entities that support PDF download */
export const PDF_ENTITIES = [
  'Invoice', 'Estimate', 'CreditMemo', 'SalesReceipt', 'RefundReceipt',
] as const satisfies readonly EntityName[];

/** Entities that support delete (transactions + Attachable) */
export const DELETABLE_ENTITIES = [
  'Invoice', 'Bill', 'Payment', 'JournalEntry', 'Estimate',
  'SalesReceipt', 'CreditMemo', 'BillPayment', 'Purchase',
  'PurchaseOrder', 'Deposit', 'Transfer', 'RefundReceipt',
  'VendorCredit', 'TimeActivity', 'Attachable',
] as const satisfies readonly EntityName[];

/** Map of entity name to its Zod schema */
export const EntitySchemaMap: Record<EntityName, z.ZodTypeAny> = {
  Invoice: InvoiceSchema,
  Customer: CustomerSchema,
  Vendor: VendorSchema,
  Bill: BillSchema,
  Payment: PaymentSchema,
  Account: AccountSchema,
  Item: ItemSchema,
  JournalEntry: JournalEntrySchema,
  Estimate: EstimateSchema,
  SalesReceipt: SalesReceiptSchema,
  CreditMemo: CreditMemoSchema,
  BillPayment: BillPaymentSchema,
  Purchase: PurchaseSchema,
  PurchaseOrder: PurchaseOrderSchema,
  Deposit: DepositSchema,
  Transfer: TransferSchema,
  RefundReceipt: RefundReceiptSchema,
  VendorCredit: VendorCreditSchema,
  TimeActivity: TimeActivitySchema,
  Employee: EmployeeSchema,
  Class: ClassSchema,
  Department: DepartmentSchema,
  Term: TermSchema,
  PaymentMethod: PaymentMethodSchema,
  TaxAgency: TaxAgencySchema,
  TaxCode: TaxCodeSchema,
  TaxRate: TaxRateSchema,
  TaxService: TaxServiceSchema,
  JournalCode: JournalCodeSchema,
  Budget: BudgetSchema,
  CompanyCurrency: CompanyCurrencySchema,
  Attachable: AttachableSchema,
  CompanyInfo: CompanyInfoSchema,
  Entitlements: EntitlementsSchema,
  ExchangeRate: ExchangeRateSchema,
  Preferences: PreferencesSchema,
};

/** Type guard: is this string a valid EntityName? */
export function isEntityName(name: string): name is EntityName {
  return ALL_ENTITY_NAMES.includes(name as EntityName);
}

/** Get the Zod schema for a given entity name */
export function getEntitySchema(name: EntityName): z.ZodTypeAny {
  return EntitySchemaMap[name];
}

/** Type-level helpers for classification checks */
export type TransactionEntityName = (typeof TRANSACTION_ENTITIES)[number];
export type NameListEntityName = (typeof NAME_LIST_ENTITIES)[number];
export type SupportingEntityName = (typeof SUPPORTING_ENTITIES)[number];
export type VoidableEntityName = (typeof VOIDABLE_ENTITIES)[number];
export type EmailableEntityName = (typeof EMAILABLE_ENTITIES)[number];
export type PdfEntityName = (typeof PDF_ENTITIES)[number];
export type DeletableEntityName = (typeof DELETABLE_ENTITIES)[number];

/** Runtime check: is this entity a transaction? */
export function isTransactionEntity(name: string): name is TransactionEntityName {
  return (TRANSACTION_ENTITIES as readonly string[]).includes(name);
}

/** Runtime check: is this entity a name list entity? */
export function isNameListEntity(name: string): name is NameListEntityName {
  return (NAME_LIST_ENTITIES as readonly string[]).includes(name);
}

/** Runtime check: is this entity voidable? */
export function isVoidable(name: string): name is VoidableEntityName {
  return (VOIDABLE_ENTITIES as readonly string[]).includes(name);
}

/** Runtime check: is this entity emailable? */
export function isEmailable(name: string): name is EmailableEntityName {
  return (EMAILABLE_ENTITIES as readonly string[]).includes(name);
}

/** Runtime check: does this entity support PDF? */
export function hasPdf(name: string): name is PdfEntityName {
  return (PDF_ENTITIES as readonly string[]).includes(name);
}

/** Runtime check: is this entity deletable? */
export function isDeletable(name: string): name is DeletableEntityName {
  return (DELETABLE_ENTITIES as readonly string[]).includes(name);
}
