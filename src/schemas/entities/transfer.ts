import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional, QBOOptionalString,
} from '../common.js';
import { QBOMoney, QBOMoneyOptional } from '../money.js';

/** Transfer schema (between accounts) */
export const TransferSchema = QBOBaseEntity.extend({
  FromAccountRef: QBORef,
  ToAccountRef: QBORef,
  Amount: QBOMoney,
  CurrencyRef: QBORefOptional,
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  ExchangeRate: z.number().optional(),
  RecurDataRef: QBORefOptional,
}).passthrough();

export type Transfer = z.infer<typeof TransferSchema>;
