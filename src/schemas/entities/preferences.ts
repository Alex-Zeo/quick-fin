import { z } from 'zod';
import { QBOBaseEntity, QBORef, QBORefOptional, QBOOptionalString } from '../common.js';

/** AccountingInfo preferences */
export const AccountingInfoPrefs = z.object({
  FirstMonthOfFiscalYear: z.string().optional(),
  UseAccountNumbers: z.boolean().optional(),
  TaxYearMonth: z.string().optional(),
  ClassTrackingPerTxn: z.boolean().optional(),
  ClassTrackingPerTxnLine: z.boolean().optional(),
  TrackDepartments: z.boolean().optional(),
  DepartmentTerminology: z.string().optional(),
  BookCloseDate: z.string().optional(),
  CustomerTerminology: z.string().optional(),
}).passthrough().optional();

/** ProductAndServices preferences */
export const ProductAndServicesPrefs = z.object({
  ForSales: z.boolean().optional(),
  ForPurchase: z.boolean().optional(),
  QuantityWithPriceAndRate: z.boolean().optional(),
  QuantityOnHand: z.boolean().optional(),
}).passthrough().optional();

/** SalesForm preferences */
export const SalesFormPrefs = z.object({
  CustomField: z.array(z.object({
    Name: z.string().optional(),
    Type: z.string().optional(),
    StringValue: z.string().optional(),
    BooleanValue: z.boolean().optional(),
  }).passthrough()).optional(),
  CustomTxnNumbers: z.boolean().optional(),
  AllowDeposit: z.boolean().optional(),
  AllowDiscount: z.boolean().optional(),
  DefaultDiscountAccount: z.string().optional(),
  AllowEstimates: z.boolean().optional(),
  ETransactionEnabledStatus: z.string().optional(),
  ETransactionPaymentEnabled: z.boolean().optional(),
  ETransactionAttachPDF: z.boolean().optional(),
  IPNSupportEnabled: z.boolean().optional(),
  AutoApplyCredit: z.boolean().optional(),
  DefaultTerms: QBORefOptional,
  DefaultCustomerMessage: QBOOptionalString.optional(),
  AllowServiceDate: z.boolean().optional(),
  AllowShipping: z.boolean().optional(),
  DefaultShippingAccount: z.string().optional(),
  UsingPriceLevels: z.boolean().optional(),
  UsingProgressInvoicing: z.boolean().optional(),
}).passthrough().optional();

/** VendorAndPurchases preferences */
export const VendorAndPurchasesPrefs = z.object({
  TrackingByCustomer: z.boolean().optional(),
  BillableExpenseTracking: z.boolean().optional(),
  DefaultTerms: QBORefOptional,
  DefaultMarkup: z.number().optional(),
  POCustomField: z.array(z.object({
    Name: z.string().optional(),
    Type: z.string().optional(),
    StringValue: z.string().optional(),
    BooleanValue: z.boolean().optional(),
  }).passthrough()).optional(),
}).passthrough().optional();

/** EmailMessages preferences */
export const EmailMessagesPrefs = z.object({
  InvoiceMessage: z.object({ Subject: z.string().optional(), Message: z.string().optional() }).passthrough().optional(),
  EstimateMessage: z.object({ Subject: z.string().optional(), Message: z.string().optional() }).passthrough().optional(),
  SalesReceiptMessage: z.object({ Subject: z.string().optional(), Message: z.string().optional() }).passthrough().optional(),
  StatementMessage: z.object({ Subject: z.string().optional(), Message: z.string().optional() }).passthrough().optional(),
}).passthrough().optional();

/** Tax preferences */
export const TaxPrefs = z.object({
  UsingSalesTax: z.boolean().optional(),
  TaxGroupCodeRef: QBORefOptional,
  PartnerTaxEnabled: z.boolean().optional(),
}).passthrough().optional();

/** Currency preferences */
export const CurrencyPrefs = z.object({
  MultiCurrencyEnabled: z.boolean().optional(),
  HomeCurrency: QBORefOptional,
}).passthrough().optional();

/** TimeTracking preferences */
export const TimeTrackingPrefs = z.object({
  UseServices: z.boolean().optional(),
  BillCustomers: z.boolean().optional(),
  ShowBillRateToAll: z.boolean().optional(),
  WorkWeekStartDate: z.string().optional(),
  MarkTimeEntriesBillable: z.boolean().optional(),
}).passthrough().optional();

/** Other preferences */
export const OtherPrefs = z.object({
  NameValue: z.array(z.object({
    Name: z.string().optional(),
    Value: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough().optional();

/** Preferences schema (company preferences) */
export const PreferencesSchema = QBOBaseEntity.extend({
  AccountingInfoPrefs: AccountingInfoPrefs,
  ProductAndServicesPrefs: ProductAndServicesPrefs,
  SalesFormPrefs: SalesFormPrefs,
  VendorAndPurchasesPrefs: VendorAndPurchasesPrefs,
  EmailMessagesPrefs: EmailMessagesPrefs,
  TaxPrefs: TaxPrefs,
  CurrencyPrefs: CurrencyPrefs,
  TimeTrackingPrefs: TimeTrackingPrefs,
  OtherPrefs: OtherPrefs,
  ReportPrefs: z.object({
    ReportBasis: z.enum(['Accrual', 'Cash']).optional(),
    CalcAgingReportFromTxnDate: z.boolean().optional(),
  }).passthrough().optional(),
}).passthrough();

export type Preferences = z.infer<typeof PreferencesSchema>;
