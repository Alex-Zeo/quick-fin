import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODate, QBODateOptional,
  QBOOptionalString, QBOAddress, QBOEmail, QBOCustomField, QBOLinkedTxn,
  QBOLineItemBase,
} from '../common.js';
import { QBOMoney, QBOMoneyOptional } from '../money.js';

/** SalesItemLineDetail for invoice line items */
export const InvoiceSalesItemLineDetail = z.object({
  ItemRef: QBORef.optional(),
  ClassRef: QBORef.optional(),
  UnitPrice: QBOMoneyOptional.optional(),
  Qty: z.number().optional(),
  TaxCodeRef: QBORef.optional(),
  ServiceDate: QBODateOptional,
  DiscountRate: z.number().optional(),
  DiscountAmt: QBOMoneyOptional.optional(),
  ItemAccountRef: QBORef.optional(),
}).passthrough();

/** GroupLineDetail for grouped line items */
export const InvoiceGroupLineDetail = z.object({
  GroupItemRef: QBORef.optional(),
  Quantity: z.number().optional(),
  Line: z.array(QBOLineItemBase).optional(),
}).passthrough();

/** DiscountLineDetail */
export const InvoiceDiscountLineDetail = z.object({
  DiscountRef: QBORef.optional(),
  PercentBased: z.boolean().optional(),
  DiscountPercent: z.number().optional(),
  DiscountAccountRef: QBORef.optional(),
}).passthrough();

/** SubTotalLineDetail */
export const InvoiceSubTotalLineDetail = z.object({
  ItemRef: QBORef.optional(),
}).passthrough();

/** Invoice line item */
export const InvoiceLine = QBOLineItemBase.extend({
  SalesItemLineDetail: InvoiceSalesItemLineDetail.optional(),
  GroupLineDetail: InvoiceGroupLineDetail.optional(),
  DiscountLineDetail: InvoiceDiscountLineDetail.optional(),
  SubTotalLineDetail: InvoiceSubTotalLineDetail.optional(),
}).passthrough();

/** TxnTaxDetail */
export const TxnTaxDetail = z.object({
  TxnTaxCodeRef: QBORef.optional(),
  TotalTax: QBOMoneyOptional.optional(),
  TaxLine: z.array(z.object({
    Amount: QBOMoneyOptional.optional(),
    DetailType: z.string().optional(),
    TaxLineDetail: z.object({
      TaxRateRef: QBORef.optional(),
      PercentBased: z.boolean().optional(),
      TaxPercent: z.number().optional(),
      NetAmountTaxable: QBOMoneyOptional.optional(),
      TaxInclusiveAmount: QBOMoneyOptional.optional(),
      OverrideDeltaAmount: QBOMoneyOptional.optional(),
    }).passthrough().optional(),
  }).passthrough()).optional(),
}).passthrough().optional();

/** DeliveryInfo */
export const DeliveryInfo = z.object({
  DeliveryType: z.string().optional(),
  DeliveryTime: z.string().optional(),
}).passthrough().optional();

/** Invoice schema */
export const InvoiceSchema = QBOBaseEntity.extend({
  Line: z.array(InvoiceLine),
  CustomerRef: QBORef,
  CurrencyRef: QBORefOptional,
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  DueDate: QBODateOptional,
  ShipDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  CustomerMemo: z.object({ value: z.string().optional() }).passthrough().optional(),
  TxnTaxDetail: TxnTaxDetail,
  BillAddr: QBOAddress,
  ShipAddr: QBOAddress,
  BillEmail: QBOEmail,
  BillEmailCc: QBOEmail,
  BillEmailBcc: QBOEmail,
  SalesTermRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  ClassRef: QBORefOptional,
  ShipMethodRef: QBORefOptional,
  DepositToAccountRef: QBORefOptional,
  PaymentMethodRef: QBORefOptional,
  DeliveryInfo: DeliveryInfo,
  LinkedTxn: z.array(QBOLinkedTxn).optional(),
  CustomField: z.array(QBOCustomField).optional(),
  TotalAmt: QBOMoneyOptional.optional(),
  Balance: QBOMoneyOptional.optional(),
  Deposit: QBOMoneyOptional.optional(),
  HomeBalance: QBOMoneyOptional.optional(),
  HomeTotalAmt: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  GlobalTaxCalculation: z.enum(['TaxExcluded', 'TaxInclusive', 'NotApplicable']).optional(),
  ApplyTaxAfterDiscount: z.boolean().optional(),
  PrintStatus: z.enum(['NotSet', 'NeedToPrint', 'PrintComplete']).optional(),
  EmailStatus: z.enum(['NotSet', 'NeedToSend', 'EmailSent']).optional(),
  AllowIPNPayment: z.boolean().optional(),
  AllowOnlinePayment: z.boolean().optional(),
  AllowOnlineCreditCardPayment: z.boolean().optional(),
  AllowOnlineACHPayment: z.boolean().optional(),
  EInvoiceStatus: QBOOptionalString.optional(),
  RecurDataRef: QBORefOptional,
  TxnSource: QBOOptionalString.optional(),
  TrackingNum: QBOOptionalString.optional(),
}).passthrough();

export type Invoice = z.infer<typeof InvoiceSchema>;
