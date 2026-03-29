

# CPA AUDIT OF "QUICK-FIN" MCP SERVER ARCHITECTURE

# ITERATION 1 — Foundational Internal Controls & Audit Trail

## Weakness 1: Audit Trail Immutability Not Guaranteed

The plan mentions "audit logging of all operations" but does not specify immutability controls. A TypeScript application writing to its own log files or database can be modified by the same process — or by anyone with server access. This violates the fundamental audit requirement that journal entries and transaction logs must be tamper-evident.

**Risk:** An AI assistant (or compromised process) could create a transaction, then alter or delete the log entry. External auditors would have no reliable evidence trail.

**Fix:** Implement a cryptographic append-only audit log. Each log entry must include: (a) SHA-256 hash of the previous entry (blockchain-style chaining), (b) timestamp from an external NTP source (not local clock), (c) the full request payload, response payload, and QBO transaction ID, (d) the identity of the requesting AI session. Write logs to a write-once store (e.g., AWS S3 with Object Lock, or a dedicated append-only database table with a database trigger preventing UPDATE/DELETE). Expose a `verify_audit_chain` MCP tool that any auditor can call to validate chain integrity.

## Weakness 2: No Authorization or Approval Controls on Financial Transactions

The architecture describes OAuth 2.0 for authenticating to QBO, but says nothing about who or what is authorized to perform specific operations. A single OAuth token grants the AI full CRUD on all 36 entities. There is no concept of approval workflows, dollar thresholds, or segregation between creating and approving transactions.

**Risk:** An AI session could create a $10M journal entry, a fraudulent vendor, and a payment — all in one batch — with no human review. This is a catastrophic internal control failure.

**Fix:** Implement a `ControlPolicy` configuration layer:
- Define dollar thresholds per entity type (e.g., invoices > $10,000 require human approval).
- Require dual-authorization for high-risk operations: JournalEntry creation, Vendor creation, Payment execution, Account creation/modification, and Void operations.
- Implement a `pending_approval` queue: when a threshold is exceeded, the operation is staged (not executed) and a notification is sent to a designated approver. The MCP server exposes `list_pending_approvals` and `approve_operation` tools that require a separate, human-held credential.

## Weakness 3: No Transaction Integrity Validation Before Submission

The plan treats the MCP server as a pass-through to QBO APIs. It does not validate financial data before submission. QBO itself has some validations, but they are insufficient for accounting integrity — for example, QBO does allow unbalanced journal entries in certain edge cases via the API, and does not enforce chart-of-accounts policies that a company may require.

**Risk:** AI-generated transactions could violate company accounting policies, post to inactive accounts, use wrong tax codes, or create entries that pass QBO validation but fail audit review.

**Fix:** Implement a `PreSubmissionValidator` middleware that runs before every write operation:
- JournalEntry: verify sum(debits) === sum(credits) to the penny, using integer arithmetic (cents) to avoid floating-point errors.
- All entities: validate against an `allowed_accounts` list (active accounts only), enforce required memo/description fields, verify tax code validity.
- Payments: validate that payment amount does not exceed invoice balance.
- Make validators configurable per company and extensible via a plugin interface.

## Weakness 4: No Idempotency Controls for Financial Operations

The plan mentions "retry with exponential backoff" but does not address idempotency. If a create-invoice call times out and is retried, the system could create duplicate invoices. QBO's API has limited built-in idempotency (only some endpoints support `requestid`).

**Risk:** Duplicate invoices, duplicate payments, duplicate journal entries — all of which corrupt financial statements and are difficult to detect after the fact.

**Fix:** Implement a client-side idempotency layer:
- Generate a deterministic idempotency key for every write operation (hash of entity type + key fields + timestamp window).
- Maintain an idempotency registry (persistent store) mapping keys to QBO response IDs.
- Before any write, check the registry. If the key exists and the QBO entity was created, return the existing entity instead of creating a new one.
- Use QBO's `requestid` parameter where supported. Where not supported, implement a post-write verification query.

## Weakness 5: Batch Operations Bypass Individual Controls

The architecture supports batch operations (30 ops per batch). If the control policy from Weakness 2 applies per-operation, a batch could be used to submit 30 transactions that individually fall below thresholds but collectively represent a material amount.

**Risk:** Approval thresholds can be circumvented by splitting a large transaction into many small ones within a batch. This is a classic structuring/smurfing risk.

**Fix:** Implement batch-level aggregate controls:
- Before submitting a batch, sum all monetary amounts by type (total payments, total journal entry debits, total new invoices).
- Apply aggregate thresholds in addition to per-item thresholds.
- Flag batches where multiple items share the same vendor/customer (potential splitting).
- Log batch operations as a single audit event with all 30 sub-operations linked, so auditors can review the batch as a unit.

## Weakness 6: Void Operations Lack Compensating Controls

The plan lists "Void" as a special operation but provides no additional controls. Voiding a transaction is one of the highest-risk operations in accounting — it removes revenue, reverses payments, and can be used to conceal fraud.

**Risk:** An AI could void legitimate transactions to manipulate financial statements (understating revenue, concealing payments to related parties).

**Fix:**
- Void operations must ALWAYS require human approval, regardless of dollar amount.
- The system must capture the reason for void (mandatory field, not free-text but from a controlled vocabulary: "Duplicate", "Customer dispute", "Entry error", "Other-explain").
- Voided transactions must generate a compensating audit entry that cannot be voided itself.
- Implement a `void_anomaly_detector`: flag if void rate exceeds historical baseline, if voids cluster near period-end, or if the same AI session creates and voids.

## Weakness 7: No Session Identity Binding

The architecture does not specify how different AI sessions or users are distinguished. If multiple AI assistants use the same MCP server, all operations appear identical in the audit trail.

**Risk:** Impossible to determine which AI assistant (or which human directing it) initiated a transaction. This destroys accountability and makes fraud investigation impossible.

**Fix:** Implement session-level identity binding:
- Each AI session must authenticate to the MCP server with a unique session token linked to a human user identity.
- Every audit log entry must include: session ID, human user ID, AI model identifier, and conversation context hash.
- The MCP server must support multiple concurrent sessions with different permission levels (e.g., AR clerk AI vs. Controller AI).

---

# ITERATION 2 — Journal Entry Integrity, Period Controls, Bank Reconciliation

Building on Iteration 1's fixes (immutable audit log, control policies, pre-submission validation, idempotency, batch controls, void controls, session identity), I now probe deeper.

## Weakness 8: Journal Entry Line-Level Integrity Beyond Debit/Credit Balance

Iteration 1 addressed debit=credit validation, but journal entry integrity requires more. The system does not validate: (a) that line items reference valid account types for the transaction (e.g., revenue accounts should not appear on the debit side of a sales transaction without explanation), (b) that inter-company elimination entries are properly paired, (c) that recurring journal entries match their template.

**Risk:** Balanced but nonsensical journal entries that pass the debit=credit test — e.g., debiting Revenue and crediting Revenue for the same amount (a wash that could conceal a reclassification), or debiting an asset and crediting a different asset (improper capitalization).

**Fix:** Implement a `JournalEntrySemanticValidator`:
- Define account-type pairing rules (e.g., a debit to Accounts Receivable must be paired with a credit to a Revenue or Deferred Revenue account).
- Flag unusual account pairings as anomalies requiring review.
- For recurring journal entries, maintain a template registry and validate that each instance matches the template within configurable tolerance.
- Reject entries that debit and credit the same account (unless explicitly flagged as reclassification with approval).

## Weakness 9: No Period-Close Enforcement

The architecture has no concept of accounting periods being open or closed. QBO itself has a "closing date" feature, but it can be overridden via API with the admin password. The MCP server, holding OAuth credentials, could post to closed periods.

**Risk:** Transactions posted to closed periods corrupt previously issued financial statements. If quarterly financials were filed or provided to stakeholders, retroactive changes create misstatement risk. This is a SOX-critical control for public companies.

**Fix:** Implement a `PeriodController` module:
- Maintain a server-side period status registry (Open, Soft Close, Hard Close) independent of QBO's closing date.
- Soft Close: AI can view but not write; human can override with approval.
- Hard Close: No writes permitted regardless of authorization. Period is frozen.
- Before every write operation, check the transaction date against the period registry. Reject transactions dated in closed periods.
- Log all period status changes with the identity of who changed them.
- Provide `close_period` and `reopen_period` MCP tools that require controller-level authorization and generate prominent audit events.

## Weakness 10: Voided Transaction Reversal Entries May Be Incomplete

Building on Iteration 1's void controls, the system does not ensure that voiding a transaction properly reverses all downstream effects. Voiding an invoice in QBO does not automatically void associated payments. Voiding a bill does not reverse the AP aging.

**Risk:** Partial voids create dangling entries: payments without invoices, credits without offsetting debits. AR/AP aging reports become unreliable, and bank reconciliation is compromised.

**Fix:** Implement a `VoidCascadeEngine`:
- When a void is requested, query all related entities (an invoice's payments, a bill's bill-payments, a payment's linked invoices).
- Present the full cascade to the approver: "Voiding Invoice #1234 will also require addressing Payment #5678 ($500 applied). Recommend: void Payment #5678 first, then void Invoice #1234."
- Enforce void ordering: payments must be voided before their source documents.
- After void execution, run a consistency check: verify that the voided entity's balance is zero and no orphaned references remain.

## Weakness 11: Bank Reconciliation Data Integrity Not Addressed

The architecture provides access to QBO's banking entities (Deposit, Transfer, Purchase) but has no mechanism to protect bank reconciliation integrity. AI could modify transactions that have already been reconciled in QBO, breaking the reconciliation.

**Risk:** Modifying reconciled transactions causes the bank reconciliation to fall out of balance, potentially requiring re-reconciliation of the entire period. This is operationally devastating and creates audit risk.

**Fix:** Implement a `ReconciliationGuard`:
- Before modifying or voiding any bank-side transaction (Deposit, Transfer, Purchase, Payment with deposit-to-account), query QBO to check if the transaction has been reconciled.
- If reconciled: block the modification entirely. Require the user to first un-reconcile in QBO (manual step), then re-attempt.
- Maintain a local mirror of reconciliation status for frequently accessed accounts to reduce API calls.
- Provide a `reconciliation_status_check` tool that reports the reconciliation state of any transaction.

## Weakness 12: Floating-Point Currency Arithmetic

The plan does not specify how monetary amounts are represented in the TypeScript layer. JavaScript's native number type uses IEEE 754 floating-point, which cannot represent $0.01 exactly. Calculations like summing line items or validating debit/credit balance could produce rounding errors.

**Risk:** One-cent rounding discrepancies that accumulate over thousands of transactions, causing trial balance imbalances, failed reconciliations, and audit adjustments.

**Fix:** All monetary arithmetic within the MCP server must use integer cents (multiply by 100) or a decimal library (e.g., `decimal.js` or `big.js`). Specifically:
- Define a `Money` type that stores amounts as integer cents with a currency code.
- All validation (debit=credit, payment≤invoice balance, batch totals) must use the `Money` type.
- Convert to/from QBO's decimal string format at the API boundary only.
- Include a `money_precision_test` in the test suite that verifies classic floating-point failure cases (e.g., 0.1 + 0.2).

## Weakness 13: No Segregation Between Transaction Entry and Bank Statement Access

The same MCP server session that creates transactions (invoices, payments) also has full read access to bank account balances and transactions via the Accounting API. There is no segregation between the "books" side and the "bank" side.

**Risk:** An AI creating fraudulent transactions could also query bank balances to ensure the fraud stays within bounds that wouldn't trigger alerts. This is a classic internal control weakness: the same entity should not control both sides of a reconciliation.

**Fix:** Implement entity-level permission scoping in the `ControlPolicy`:
- Define permission groups: "Transactional" (Invoice, Bill, Payment, JournalEntry), "Banking" (Deposit, Transfer, BankAccount queries), "Reporting" (read-only report generation).
- AI sessions should be granted the minimum permission group needed. A session creating invoices should not need bank balance access.
- If both are needed, require separate sessions with separate approval chains.
- Log cross-group access patterns as potential anomalies.

## Weakness 14: Adjusting Journal Entries Not Differentiated from Regular Entries

The system treats all JournalEntry operations identically. Adjusting journal entries (AJEs) — those made during audit or period-close to correct balances — have special significance and require heightened controls.

**Risk:** An AI could create what is effectively an adjusting entry (posting to period-end dates, touching significant accounts) without it being identified as such, bypassing the heightened scrutiny that AJEs require.

**Fix:** Implement an `AJE_Detector`:
- Flag journal entries as potential AJEs if: (a) transaction date is within N days of period-end, (b) they affect accounts commonly adjusted (revenue, inventory, accruals, reserves), (c) they are created after the period's soft-close date, (d) the memo contains keywords like "adjust", "correct", "reclass".
- Flagged AJEs route to a separate approval queue with controller-level authorization.
- Provide a dedicated `create_adjusting_entry` tool that explicitly marks entries as AJEs in both QBO (via custom field or memo convention) and the audit log.

---

# ITERATION 3 — Revenue Recognition, Tax Compliance, Multi-Currency, Materiality

## Weakness 15: No ASC 606 Revenue Recognition Safeguards

The system can create invoices and receive payments with no awareness of ASC 606's five-step model. AI-generated invoices could recognize revenue at the wrong time — for example, invoicing for services not yet delivered, or failing to allocate transaction prices across multiple performance obligations in a bundled contract.

**Risk:** Premature or improper revenue recognition violates GAAP and, for public companies, SEC reporting requirements. This is one of the most common sources of financial restatements.

**Fix:** Implement a `RevenueRecognitionGuard`:
- For invoice creation, require a `revenue_recognition_date` field that may differ from the invoice date. If not provided, default to invoice date but flag for review.
- Maintain a configurable `deferred_revenue_rules` registry: for certain item/service codes, revenue must be deferred and recognized over time.
- When an invoice includes items subject to deferral, automatically create the deferred revenue journal entry (Credit: Deferred Revenue; Debit: AR) instead of immediate revenue recognition.
- Provide a `revenue_schedule` tool that generates a revenue recognition schedule for multi-period contracts.
- Flag invoices where the ship date or service date differs from the invoice date by more than a configurable threshold.

## Weakness 16: Sales Tax Calculation and Compliance Gaps

The architecture mentions QBO's Automated Sales Tax feature but provides no controls around it. AI-created invoices could use wrong tax codes, exempt taxable items, or apply tax in wrong jurisdictions. QBO's sales tax engine depends on correct address and item categorization.

**Risk:** Under-collection of sales tax creates liability for the company. Over-collection creates customer disputes. Both create nexus and filing compliance issues that can result in penalties.

**Fix:** Implement a `TaxComplianceValidator`:
- Before creating any taxable transaction, validate that: (a) the customer has a valid shipping address (required for jurisdiction determination), (b) each line item has an assigned tax category, (c) tax-exempt customers have a valid exemption certificate number on file.
- Query QBO's tax code list and validate that applied tax codes are active and appropriate for the jurisdiction.
- Flag transactions where tax amount seems anomalous: zero tax on a taxable item, tax rate significantly different from expected jurisdiction rate.
- Maintain a `tax_exemption_expiry` tracker that alerts when customer exemption certificates are nearing expiration.

## Weakness 17: 1099 Reporting Data Integrity

Vendor payments feed into 1099 reporting. The system can create vendors and payments with no validation of 1099-eligible status, TIN (Tax Identification Number) correctness, or payment type categorization.

**Risk:** Missing or incorrect 1099s create IRS penalties ($310 per form for 2024, with no cap for intentional disregard). Incorrect vendor setup compounds throughout the year and is expensive to correct at year-end.

**Fix:** Implement a `Vendor1099Validator`:
- When creating a vendor, require: (a) 1099-eligible flag, (b) if eligible, TIN and TIN type (SSN vs EIN), (c) W-9 receipt confirmation (boolean + date).
- Validate TIN format (EIN: XX-XXXXXXX; SSN: XXX-XX-XXXX). Optionally integrate IRS TIN matching.
- When creating a payment to a 1099-eligible vendor, verify the payment type maps to the correct 1099-NEC/1099-MISC box.
- Provide a `vendor_1099_readiness_report` tool that lists all vendors missing required 1099 data, with year-to-date payment totals.
- Flag payments to 1099-eligible vendors made via non-trackable methods.

## Weakness 18: Multi-Currency Transaction Risks

QBO supports multi-currency, and the API allows creating transactions in foreign currencies. The MCP server has no controls around exchange rate usage, gain/loss recognition, or currency consistency.

**Risk:** Incorrect exchange rates cause misstated financials. Unrealized gain/loss entries may not be generated. An AI could create a transaction in the wrong currency, and QBO allows this via API even if the home currency company has multicurrency disabled (it would silently convert or error inconsistently).

**Fix:** Implement a `CurrencyGuard`:
- Detect whether the QBO company has multi-currency enabled. If not, reject any transaction specifying a non-home currency.
- If multi-currency is enabled: validate that the exchange rate on each transaction is within a configurable tolerance of a market rate (query an FX rate source or use QBO's rate).
- Flag transactions where the exchange rate deviates more than 2% from the market rate.
- At period-end, provide a `unrealized_gain_loss_report` tool that identifies open foreign-currency receivables/payables needing revaluation.
- Enforce currency consistency: a customer assigned a currency should only have transactions in that currency.

## Weakness 19: Accrual vs. Cash Basis Inconsistency

QBO companies operate on either accrual or cash basis. The API allows creating transactions that are appropriate for one basis but not the other. The MCP server has no awareness of which basis the company uses.

**Risk:** AI-generated entries may be inconsistent with the company's accounting basis. For example, creating a revenue accrual for a cash-basis company, or failing to create accruals for an accrual-basis company.

**Fix:** On initialization, the MCP server must query QBO's company preferences to determine the accounting basis (accrual vs. cash). Store this in a `CompanyConfig`:
- Cash basis: warn when creating journal entries that look like accruals (debit/credit to accrual-type accounts like "Accrued Liabilities" or "Deferred Revenue").
- Accrual basis: warn when revenue is recognized at payment receipt rather than at invoicing.
- Provide a `basis_consistency_check` tool that reviews recent transactions for entries inconsistent with the declared basis.

## Weakness 20: No Materiality Thresholds for Automated Operations

The system applies the same controls to a $5 office supply purchase and a $5M vendor payment. Without materiality thresholds, either too many trivial transactions get flagged (operational friction) or too few material ones get reviewed (audit risk).

**Risk:** Without materiality-based controls, the system either becomes unusable (every transaction flagged) or dangerous (nothing flagged). Auditors expect materiality-based controls.

**Fix:** Implement a `MaterialityEngine`:
- Allow configuration of materiality thresholds at multiple levels: overall financial statement materiality, performance materiality (typically 50-75% of overall), and trivially small threshold (typically 5% of overall).
- Transactions below trivially-small threshold: log only, no approval required.
- Transactions between trivially-small and performance materiality: standard controls apply.
- Transactions above performance materiality: enhanced controls (dual approval, mandatory memo, real-time notification to controller).
- Materiality thresholds should be set as absolute dollar amounts AND as a percentage of relevant financial statement line item (e.g., 5% of total revenue for revenue transactions).
- Provide a `set_materiality_thresholds` tool (controller-only) and a `materiality_analysis` tool that shows the distribution of transaction sizes relative to thresholds.

## Weakness 21: Multi-Entity Consolidation Risks

If the MCP server is connected to multiple QBO companies (common for related entities), there are no controls around inter-company transactions, elimination entries, or ensuring consistent accounting policies across entities.

**Risk:** Inter-company transactions not properly eliminated inflate consolidated revenue. Inconsistent accounting policies between entities make consolidation unreliable.

**Fix:** Implement a `MultiEntityController`:
- When connected to multiple QBO companies, maintain a registry of inter-company relationships.
- Flag transactions between related entities: require that both sides of an inter-company transaction are created (AP in one entity, AR in the other) with matching amounts and dates.
- Provide an `intercompany_reconciliation` tool that compares inter-company balances across entities and flags mismatches.
- Enforce consistent chart of accounts mapping across entities.

---

# ITERATION 4 — SOX Controls, Audit Evidence, Management Override

## Weakness 22: No Change Management Controls on MCP Server Configuration

The control policies, materiality thresholds, approval workflows, and validation rules defined in iterations 1-3 are all configuration. There is no mention of change management controls over this configuration. A malicious actor (or misconfigured AI) could lower thresholds, disable validators, or modify policies.

**Risk:** SOX Section 404 requires that IT general controls (ITGCs) include change management. Changes to the MCP server's control configuration are equivalent to changes to a financial application's security settings. Uncontrolled changes undermine every other control.

**Fix:** Implement a `ConfigChangeControl` system:
- All control configuration (thresholds, policies, approval rules, validation toggles) must be stored in a versioned, immutable configuration store (not a plain config file).
- Every configuration change must: (a) require controller-level or higher authorization, (b) be logged immutably in the audit chain with before/after values, (c) include a change justification.
- Implement a `config_change_history` tool that shows all configuration changes with who, when, why.
- Support a "four-eyes" principle: configuration changes proposed by one admin must be approved by a different admin.
- Provide a `config_drift_detector` that compares running configuration against a baseline and alerts on discrepancies.

## Weakness 23: Insufficient Audit Evidence for AI-Initiated Transactions

An external auditor examining financial statements needs to verify that transactions are properly authorized, recorded, and supported. For AI-initiated transactions, the audit trail from Iteration 1 logs the API call, but it does not preserve the reasoning context: why did the AI create this transaction? What source document supported it? What was the human instruction?

**Risk:** Auditors following ISA 500 / AU-C 500 standards require sufficient appropriate audit evidence. "The AI did it" is not sufficient. Without the decision chain, auditors may issue qualified opinions or require extensive compensating procedures.

**Fix:** Implement an `AuditEvidencePackager`:
- For every write transaction, capture and store an "evidence package" containing: (a) the original human instruction or trigger (conversation excerpt, webhook payload, scheduled task ID), (b) the AI's reasoning chain (why this entity, why this amount, why this account), (c) any source documents referenced (uploaded invoices, emails, contracts), (d) the pre-submission validation results, (e) the approval chain (who approved, when, under what policy).
- Store evidence packages linked to QBO transaction IDs in the immutable audit store.
- Provide an `audit_evidence_package` tool that, given a QBO transaction ID, retrieves the complete evidence package.
- Support bulk export of evidence packages for external auditor review (PDF format with digital signatures).

## Weakness 24: No IT General Controls (ITGC) Framework for the MCP Server Itself

The MCP server is a financial application. SOX requires ITGCs over financial applications: access management (who can use it), change management (covered in #22), operations (monitoring, incident response), and program development (testing controls).

**Risk:** An MCP server lacking ITGCs would be flagged as a deficiency in any SOX audit. All controls built into the server are unreliable if the server itself is not properly controlled.

**Fix:** Implement an ITGC framework within the MCP server:
- **Access Management:** Implement role-based access control (RBAC) with defined roles (Viewer, Clerk, Accountant, Controller, Admin). Map MCP tools to minimum required roles. Enforce least privilege.
- **Operations:** Implement health monitoring, alerting on control failures, automated escalation. Provide a `system_health_dashboard` tool.
- **Program Development:** Maintain a test suite that validates all control configurations. Run tests before any deployment. Provide a `control_test_suite` tool that runs all validation checks against current configuration.
- **Logical Access Reviews:** Provide a `user_access_review` tool that lists all users, their roles, last activity, and flags dormant accounts.

## Weakness 25: Management Override of Controls

Every control implemented in iterations 1-4 can potentially be overridden by an administrator. In auditing, "management override" is always a risk — it's the one risk that no system of internal controls can fully eliminate. The MCP server has no special handling for override scenarios.

**Risk:** ISA 240 / AU-C 240 require auditors to specifically address management override risk. If the MCP server's admin can disable controls, create transactions, and modify the audit log — even with chain hashing — the controls are only as strong as the admin's integrity.

**Fix:** Implement `ManagementOverrideDetection`:
- Distinguish between "exception" (one-time override of a specific control with justification) and "disable" (turning off a control entirely).
- ALL overrides must be logged in a separate, dedicated override log that is replicated to an external system outside the admin's control (e.g., external SIEM, email to audit committee).
- Implement a `management_override_report` tool that lists all overrides in a period, categorized by type, with justifications.
- Critical override actions (disabling approval requirements, modifying materiality thresholds, reopening closed periods) must trigger immediate notification to multiple parties (not just logging).
- Provide an "override budget": a configurable limit on the number of overrides per period. Exceeding the budget triggers escalation.

## Weakness 26: No Segregation of Duties Matrix

Iteration 1 introduced the concept of different permission levels, but there is no formal segregation of duties (SoD) matrix. SoD requires that conflicting duties be assigned to different individuals — creating a vendor and approving payment to that vendor should not be the same person/AI session.

**Risk:** Without an SoD matrix, conflicting duties may be assigned to the same AI session. This is the most fundamental internal control and its absence would be a material weakness in any SOX audit.

**Fix:** Implement a `SegregationOfDutiesEngine`:
- Define an SoD conflict matrix:
  - Vendor creation ↔ Payment approval: CONFLICT
  - Invoice creation ↔ Payment receipt: CONFLICT
  - Journal entry creation ↔ Journal entry approval: CONFLICT
  - Bank reconciliation ↔ Transaction entry: CONFLICT
  - User access management ↔ Transaction processing: CONFLICT
- Before executing any operation, check whether the current session has performed a conflicting operation on the same entity within a configurable window.
- If conflict detected: block the operation and require a different session/user.
- Provide a `sod_conflict_report` tool that lists all detected conflicts in a period.

## Weakness 27: AI Model Version and Prompt Integrity Not Tracked

The MCP server is invoked by an AI model. The model version, system prompt, and tool definitions all affect what transactions the AI generates. If the model is updated or the prompt changes, the behavior changes — but there is no tracking of this.

**Risk:** A change in AI model behavior is equivalent to a change in a financial application's logic. Without version tracking, it is impossible to attribute changes in transaction patterns to specific model or prompt updates. Auditors cannot assess the reliability of AI-generated transactions without knowing what AI generated them.

**Fix:** Implement `AIModelVersionTracking`:
- Every audit log entry must include: AI model identifier, model version/hash, system prompt hash, and MCP tool definition version.
- When any of these change, log a "configuration change" event in the immutable audit chain.
- Provide a `model_change_timeline` tool that shows when model/prompt changes occurred and correlates them with transaction volume/pattern changes.
- Maintain a registry of approved model versions. Reject connections from unapproved model versions (defense-in-depth).

## Weakness 28: No Formal Audit Period Support

External auditors work in defined audit periods. They need the ability to "freeze" a period for review, extract all transactions and evidence for that period, and confirm that nothing changed during their review.

**Risk:** If the AI continues processing transactions while auditors are reviewing a period, the dataset under audit is a moving target. This wastes audit time and raises reliability concerns.

**Fix:** Implement `AuditPeriodSupport`:
- Provide a `begin_audit_period` tool that freezes a date range: no modifications or new transactions within the range.
- Provide a `generate_audit_extract` tool that exports all transactions, evidence packages, and audit logs for a period in a standardized format (e.g., XBRL, CSV with hash verification).
- Provide an `end_audit_period` tool that releases the freeze.
- During an active audit period, any attempt to modify data in the frozen range must be logged as a potential audit interference event.

---

# ITERATION 5 — Sync Failures, Reconciliation, Duplicates, Orphans

## Weakness 29: CDC (Change Data Capture) Gap Detection

The architecture uses QBO's CDC endpoint (30-day lookback) to sync changes. But there is no mechanism to detect gaps in CDC polling. If the MCP server goes down for 31 days, or if a CDC response is truncated, changes are silently lost.

**Risk:** Missed CDC events mean the local state diverges from QBO. Downstream reports, reconciliations, and analytics based on stale data produce incorrect results. Financial decisions based on stale data are a material risk.

**Fix:** Implement a `CDCGapDetector`:
- Record the timestamp of every successful CDC poll and the entities returned.
- On each poll, verify that the new `since` parameter overlaps with the previous poll's coverage by at least a configurable buffer (e.g., 1 hour).
- If a gap is detected (time between polls exceeds the overlap window), trigger a full reconciliation for the affected entity types.
- If the gap exceeds 30 days (CDC lookback limit), alert the operator that a full re-sync is required.
- Maintain a `cdc_health_status` indicator showing last successful poll, gap history, and current lag.

## Weakness 30: Webhook Event Delivery Reliability

The optional webhook receiver can miss events due to: server downtime, network failures, QBO retry exhaustion, HMAC validation failures, or processing errors. The architecture does not address webhook delivery guarantees.

**Risk:** Missed webhooks mean the system doesn't know about transactions created directly in QBO (by humans or other integrations). This breaks the assumption that the MCP server has a complete view of financial activity.

**Fix:** Implement a `WebhookReliabilityLayer`:
- Maintain a webhook event log with deduplication (QBO sends the same event multiple times).
- Implement a "heartbeat" check: periodically query QBO's CDC endpoint to detect entities changed since the last webhook. Any entity found via CDC but not via webhook indicates a missed webhook.
- Implement dead-letter queue for webhooks that fail processing (don't silently drop).
- Provide a `webhook_health_report` tool showing: events received, events processed, events failed, estimated miss rate.
- On HMAC validation failure: log the event (don't discard), alert the operator, and quarantine for manual review.

## Weakness 31: Partial Batch Failure Handling

QBO's batch API can return mixed results: some operations succeed, some fail. The current architecture does not describe how partial failures are handled. A batch of 30 operations where 15 succeed and 15 fail leaves the system in an inconsistent state.

**Risk:** Partial batch success creates half-completed transaction sets. For example, a batch creating an invoice and its payment: if the invoice succeeds but the payment fails, the invoice exists without its payment, AR is overstated, and the system may not know this.

**Fix:** Implement a `BatchTransactionManager`:
- Classify batch operations as "independent" (can succeed/fail individually) or "dependent" (must all succeed or all fail).
- For dependent batches: if any operation fails, automatically void/delete the operations that succeeded (compensating transactions).
- For all batches: the audit log must record the complete batch result — which operations succeeded, which failed, and what compensating actions were taken.
- Provide a `batch_result_reconciliation` tool that identifies any batches with partial failures that were not fully compensated.
- Implement a retry queue for failed batch items with configurable retry limits.

## Weakness 32: Duplicate Transaction Detection

Beyond the idempotency controls from Iteration 1 (which prevent duplicates from retries), the system has no capability to detect duplicates that arise from: (a) the same invoice entered by both the AI and a human in QBO, (b) the same vendor bill entered twice from different source documents, (c) the same payment recorded via bank feed and manual entry.

**Risk:** Duplicate transactions double-count revenue, expenses, or payments. This is one of the most common causes of financial misstatement in automated systems.

**Fix:** Implement a `DuplicateDetectionEngine`:
- Before creating any transaction, query QBO for potential duplicates using fuzzy matching on: (a) same customer/vendor + similar amount (within $0.01) + date within configurable window (default 7 days), (b) same reference/document number, (c) same check number for payments.
- Score potential duplicates using weighted similarity. Above a threshold, block creation and present the potential duplicate for review.
- Provide a `duplicate_scan` tool that retrospectively scans a period for potential duplicates and generates a report.
- Track "confirmed non-duplicates" so the same pair is not flagged repeatedly.

## Weakness 33: Orphaned Record Detection

The system can create related records (Invoice → Payment → Deposit) but has no mechanism to detect orphans: payments not linked to invoices, deposits not linked to payments, bill payments without bills, credits without applications.

**Risk:** Orphaned records indicate data integrity failures. They cause AR/AP aging inaccuracies, bank reconciliation failures, and audit exceptions. QBO's API allows creating records without proper linkage.

**Fix:** Implement an `OrphanDetectionEngine`:
- Define expected linkage patterns:
  - Payment → must link to Invoice(s)
  - BillPayment → must link to Bill(s)
  - Deposit → should link to Payment(s) or have source identification
  - Credit Memo → should be applied to Invoice(s) within configurable window
  - Vendor Credit → should be applied to Bill(s) within configurable window
- Run orphan detection on a configurable schedule (daily) and after each batch operation.
- Provide an `orphan_report` tool listing all unlinked records with aging (how long they've been orphaned).
- Flag orphans older than a configurable threshold (e.g., 30 days) as requiring resolution.

## Weakness 34: Cross-System Reconciliation

The MCP server interacts with QBO, but many companies also have external systems (ERP, bank feeds, payment processors, POS systems) that independently write to QBO. The architecture has no facility for reconciling the MCP server's view of data against QBO's actual state.

**Risk:** The MCP server's local cache/state diverges from QBO's truth. Decisions made based on stale or incomplete data produce incorrect results.

**Fix:** Implement a `ReconciliationEngine`:
- Provide a `full_reconciliation` tool that, for a given date range: (a) queries QBO for all transactions, (b) compares against the MCP server's audit log of operations, (c) identifies transactions in QBO not in the MCP log (created externally), (d) identifies transactions in the MCP log not in QBO (failed submissions), (e) identifies mismatches (amount, date, account differences).
- Run reconciliation on a configurable schedule (at minimum daily, preferably after each batch of operations).
- Generate a reconciliation report with: matched items, QBO-only items, MCP-only items, and discrepancies.
- Provide a `reconciliation_history` tool showing reconciliation trends over time.

## Weakness 35: No Transaction Reversal Audit Trail

When a failed operation requires a compensating transaction (from batch failure handling or error correction), the link between the original transaction and its reversal is not tracked. In QBO, there is no native "reversal" linkage for journal entries.

**Risk:** Reversals without clear linkage to originals create confusion during audit review, may be double-reversed, or may be missed entirely.

**Fix:** Implement a `ReversalTracker`:
- When creating a compensating/reversal transaction, include a reference to the original transaction ID in both: (a) the QBO memo/private note field, (b) the MCP audit log.
- Maintain a reversal registry mapping original → reversal → re-entry (if applicable).
- Prevent double-reversal: before creating a reversal, check if one already exists.
- Provide a `reversal_chain` tool that shows the full lifecycle of a transaction: original → reversal → correction.

---

# ITERATION 6 — PCI-DSS, Sensitive Data, Data Classification, Retention

## Weakness 36: PCI-DSS Scope Contamination from Payments API

The architecture provides MCP tools for the Payments API including tokenization, saved cards, and bank accounts. Any system that processes, stores, or transmits cardholder data (CHD) is in scope for PCI-DSS. The MCP server, by handling card tokens and potentially full card numbers, becomes a PCI-scoped system.

**Risk:** PCI-DSS non-compliance can result in fines of $5,000-$100,000 per month, increased transaction fees, or loss of card processing ability. If the MCP server logs full card numbers in the audit trail, it's a PCI violation. If it stores tokens without proper controls, the token vault is in scope.

**Fix:** Implement a `PCIComplianceLayer`:
- NEVER log, store, or transmit full card numbers (PAN) anywhere in the MCP server — not in audit logs, not in error messages, not in debug output.
- Mask card numbers to show only last 4 digits in all outputs: `****-****-****-1234`.
- For tokenization operations: the MCP server should direct the client to use QBO's client-side tokenization (PCI SAQ A eligible) rather than passing card data through the server (which would require SAQ D).
- Implement a `sensitive_data_scanner` that reviews all outgoing log entries and API responses for patterns matching card numbers (Luhn check), and redacts them before storage.
- Clearly document that the MCP server's architecture is designed for PCI SAQ A-EP or SAQ A scope, and what would move it to SAQ D.

## Weakness 37: SSN Exposure in Employee/Payroll Entities

The Payroll API (Premium) accesses Employee entities that contain Social Security Numbers. The MCP server could expose SSNs in: audit logs, API responses returned to the AI, error messages, or cached data.

**Risk:** SSN exposure violates state data breach notification laws (all 50 states), IRS Publication 1075 requirements, and creates identity theft liability. A single SSN breach can cost $150-$350 per record.

**Fix:** Implement `PII_Protection`:
- Define a PII classification for each entity field. SSN, TIN, bank account numbers, and date of birth are classified as "Restricted."
- ALL Restricted fields must be masked in: (a) MCP tool responses (show last 4 only), (b) audit log entries, (c) error messages, (d) any cached/stored data.
- Full values are accessible only through a dedicated `retrieve_sensitive_field` tool that requires elevated authorization, logs the access, and enforces rate limiting (e.g., max 10 SSN lookups per hour).
- Implement data-at-rest encryption for any stored sensitive data using AES-256 with key management separate from the application.

## Weakness 38: No Data Classification Framework

The system treats all QBO data identically. In reality, financial data has widely varying sensitivity: a customer's name is different from their bank account number, which is different from internal salary data. Without classification, the same controls apply to everything.

**Risk:** Over-protecting low-sensitivity data causes operational friction. Under-protecting high-sensitivity data causes compliance violations. Without classification, both happen simultaneously.

**Fix:** Implement a `DataClassificationEngine` with four tiers:
- **Public:** Company name, public financial summaries.
- **Internal:** Transaction details, account balances, invoice amounts, customer/vendor names.
- **Confidential:** Bank account details, compensation data, tax IDs, customer payment history.
- **Restricted:** SSN, full card numbers, bank routing+account pairs, passwords.
- Map every QBO entity field to a classification tier.
- Each tier has defined controls: logging verbosity, caching policy, transmission encryption requirements, access authorization level, retention period.
- Provide a `data_classification_report` tool showing what data the MCP server accesses and its classification.

## Weakness 39: Financial Record Retention Non-Compliance

The architecture mentions audit logging but does not address retention policies. Financial records have legal retention requirements: IRS requires 7 years for most tax records, SOX requires 7 years for audit workpapers, state requirements vary.

**Risk:** Deleting financial records or audit logs prematurely violates legal retention requirements. Retaining records indefinitely increases storage costs and breach exposure surface.

**Fix:** Implement a `RetentionPolicyEngine`:
- Define retention periods by record type:
  - Tax-related records (1099 data, sales tax): 7 years.
  - Financial transactions (invoices, payments, journal entries): 7 years.
  - Audit logs: 7 years from the end of the fiscal year.
  - PII/SSN data: minimum required, purge when no longer needed.
  - Temporary/working data: 90 days.
- Implement automated retention management: records reaching their retention expiry are flagged for review, then archived or purged.
- Retention must also apply to audit evidence packages from Iteration 4.
- Implement legal hold capability: when notified of litigation or investigation, suspend all purges for affected data.
- Provide a `retention_status_report` tool showing records by age, classification, and retention policy.

## Weakness 40: Sensitive Data in Webhook Payloads

Webhooks from QBO deliver event notifications to the MCP server's HTTP endpoint. These payloads travel over the network and are received by the webhook handler. If webhook payloads contain sensitive entity details (not just IDs), they could be intercepted or logged inappropriately.

**Risk:** Webhook payloads intercepted in transit or logged in plaintext expose financial data. Even HTTPS doesn't protect against logging at the application layer.

**Fix:** Implement `WebhookSecurityControls`:
- Verify HMAC-SHA256 signature on every webhook before processing (already planned, but must be strictly enforced — reject without signature).
- Webhook payloads should be treated as `Internal` classification minimum. Parse immediately, extract only necessary IDs, and discard the raw payload.
- Do not log raw webhook payloads. Log only: event type, entity IDs, timestamp, signature verification status.
- The webhook endpoint must be HTTPS-only with TLS 1.2+ and certificate validation.
- Implement webhook replay protection: reject webhooks with timestamps older than a configurable window (e.g., 5 minutes).

## Weakness 41: No Data Masking in Development/Testing Environments

If the MCP server is deployed in dev/test environments using production QBO data (common with QBO sandbox limitations), sensitive data leaks into less-controlled environments.

**Risk:** Development environments typically have weaker access controls. Production financial data in dev environments violates PCI-DSS Requirement 6.4.3, SOX ITGC requirements, and data privacy regulations.

**Fix:** Implement `EnvironmentDataControls`:
- Detect environment (production vs. sandbox) from QBO OAuth credentials.
- In production mode: enforce all security controls at full strength.
- In sandbox/dev mode: relax operational controls (thresholds, approvals) but maintain or strengthen data protection controls.
- Never copy production tokens or financial data to development environments.
- Provide a `sanitize_for_testing` tool that generates realistic but fake financial data for testing purposes.
- Log environment designation in every audit entry so production and test activities are never confused.

---

# ITERATION 7 — Fraud Detection, Benford's Law, Continuous Monitoring

## Weakness 42: No Unusual Journal Entry Detection

Journal entries are the primary vehicle for financial statement fraud (per ACFE). The system creates journal entries without any anomaly scoring. Classic fraud patterns include: entries to unusual accounts, entries made outside business hours, entries with round dollar amounts, entries just below approval thresholds, entries to rarely used accounts, and entries with vague descriptions.

**Risk:** AI-initiated journal entries (or AI-assisted human-directed entries) that match fraud patterns go undetected until external audit, which may be months or years later.

**Fix:** Implement a `JournalEntryAnomalyScorer`:
- Score every journal entry on multiple dimensions:
  - **Amount anomaly:** Z-score of amount vs. historical distribution for that account pair.
  - **Timing anomaly:** entries outside business hours, weekend/holiday entries, cluster of entries just before period-end.
  - **Round number flag:** entries that are exactly round amounts ($1,000, $10,000, $50,000) — flag, not block.
  - **Threshold proximity:** entries at 90-99% of approval thresholds (structuring indicator).
  - **Account anomaly:** entries to accounts not used in the prior 90 days, or to accounts that don't normally pair.
  - **Description anomaly:** missing description, single-word description, or description matching known red-flag patterns ("adjustment", "correction", "misc").
- Compute a composite anomaly score. Entries above a threshold route to a fraud review queue.
- Provide a `journal_entry_anomaly_report` tool that lists high-scoring entries for a period.

## Weakness 43: No Benford's Law Analysis Capability

Benford's Law (the first-digit law) states that in naturally occurring financial data, the digit 1 appears as the leading digit about 30% of the time, digit 2 about 17.6%, etc. Deviations from Benford's distribution indicate potential manipulation, fabrication, or systematic errors.

**Risk:** Without Benford's analysis, a systematic pattern of fabricated transactions (which tend to have non-Benford distributions) would not be detected by the system.

**Fix:** Implement a `BenfordsLawAnalyzer`:
- For a configurable set of transaction populations (all journal entries, all invoices, all payments, all expenses by vendor), compute the first-digit and first-two-digit distribution.
- Compare against the expected Benford distribution using chi-squared test.
- Flag populations where the chi-squared p-value falls below 0.05 (significant deviation).
- Support drill-down: which specific digit is over/under-represented, and which transactions contribute most to the deviation.
- Provide a `benfords_analysis` tool that generates the analysis for a given entity type, date range, and account/vendor filter.
- Run automatically at period-end as part of close procedures.

## Weakness 44: No Continuous Monitoring Framework

The controls from prior iterations are all point-in-time: they activate when a transaction is created or at period-end. There is no continuous monitoring that watches for patterns across transactions over time.

**Risk:** Fraud and errors often manifest as patterns that are only visible in aggregate: slowly increasing expenses, gradually shifting revenue recognition timing, creeping vendor payment amounts. Point-in-time controls miss these trends.

**Fix:** Implement a `ContinuousMonitoringEngine`:
- Define monitoring rules that run on a schedule (hourly, daily, weekly):
  - **Trend analysis:** compare current period metrics (total revenue, expense ratios, average transaction size) against prior periods. Flag significant deviations.
  - **Velocity monitoring:** detect sudden increases in transaction volume by entity type, customer, or vendor.
  - **Split-transaction detection:** identify patterns of multiple small transactions to the same vendor/customer that sum to a large amount.
  - **Weekend/holiday activity:** flag financial transaction creation outside business days.
  - **New entity surge:** alert if an unusual number of new vendors or customers are created in a short period.
- Store monitoring results in a time-series database for trend visualization.
- Provide `monitoring_dashboard` and `monitoring_alerts` tools for real-time visibility.
- Each monitoring rule should have configurable sensitivity and suppression (to reduce false positives).

## Weakness 45: No Related-Party Transaction Detection

The system has no capability to identify transactions between related parties (e.g., company officers, their family members, entities they control). Related-party transactions require enhanced disclosure under GAAP (ASC 850) and heightened scrutiny.

**Risk:** An AI creating or processing transactions has no context about related-party relationships. Transactions with related parties that are not identified and disclosed violate GAAP and, for public companies, SEC disclosure requirements.

**Fix:** Implement a `RelatedPartyDetector`:
- Maintain a registry of related parties: company officers, board members, their known affiliates (entities, family members). This must be populated manually by the controller but can be AI-assisted.
- Before creating or processing any transaction, check the customer/vendor against the related-party registry.
- Match on: exact name, fuzzy name match, address similarity, TIN/EIN match, phone/email match.
- Flagged related-party transactions require enhanced approval and mandatory disclosure tagging.
- Provide a `related_party_transactions_report` tool for period-end disclosure preparation.

## Weakness 46: No Retrospective Anomaly Detection on Existing Data

All detection mechanisms focus on new transactions. When the MCP server first connects to a QBO company with years of existing data, it has no capability to scan historical transactions for anomalies.

**Risk:** Pre-existing fraud or errors in the QBO data go undetected. The MCP server builds controls around new transactions while the books already contain issues.

**Fix:** Implement a `HistoricalScanEngine`:
- On initial connection to a QBO company, offer a comprehensive historical scan.
- Run all anomaly detectors (journal entry anomalies, Benford's analysis, duplicate detection, orphan detection, related-party screening) against historical data.
- Generate a `historical_scan_report` with findings prioritized by risk and materiality.
- This scan should be optional (it will consume significant API quota) but strongly recommended.
- Store scan results for baseline comparison with future monitoring.

## Weakness 47: No Approval Threshold Circumvention Detection

Iteration 1 introduced approval thresholds. But the system doesn't detect patterns of transactions deliberately structured to stay just below thresholds. A series of $9,999 transactions when the threshold is $10,000 is a classic structuring pattern.

**Risk:** Approval thresholds become ineffective if structuring goes undetected. This is a known fraud technique and auditors specifically look for it.

**Fix:** Implement `ThresholdCircumventionDetector`:
- For each approval threshold, define a "proximity band" (e.g., 85-99% of the threshold).
- Track the frequency of transactions within the proximity band, by user/session and by vendor/customer.
- Statistical baseline: calculate the expected frequency of near-threshold transactions from the overall distribution. If observed frequency significantly exceeds expected, flag as structuring.
- Include this as a rule in the ContinuousMonitoringEngine.
- Generate alerts that include: the threshold in question, the number of near-threshold transactions, the statistical significance, and the responsible session/user.

---

# ITERATION 8 — Period-End Controls, Fiscal Year, Multi-Period Accuracy

## Weakness 48: No Preliminary vs. Final Close Distinction

Iteration 2 introduced period-close controls with Soft Close and Hard Close. But the real-world close process has more stages: preliminary close (initial numbers), review period, adjusting entries, final close, and potentially reopening for audit adjustments. The two-stage model is insufficient.

**Risk:** Without a proper close workflow, preliminary numbers may be treated as final, adjusting entries may be lost, or the period may be prematurely hard-closed before all necessary adjustments.

**Fix:** Enhance the `PeriodController` to support a five-stage close workflow:
1. **Open:** Normal operations, all transactions permitted.
2. **Preliminary Close:** Standard transactions blocked, only designated close activities permitted (accruals, deferrals, reconciling items). Run pre-close checklist.
3. **Under Review:** Read-only for AI. Only controller-approved AJEs permitted. Financial statements generated for review.
4. **Final Close:** All transactions blocked. Financial statements are final. Period is locked.
5. **Audit Adjustment:** Special state entered only during external audit. Only auditor-approved entries permitted, with mandatory tracking. Returns to Final Close when complete.
- Each stage transition must be authorized by a controller-level role and logged.
- Provide a `period_close_checklist` tool that lists all required close activities and their completion status.

## Weakness 49: No Pre-Close Validation Checklist

Before closing a period, a series of checks must pass: bank reconciliations completed, AP/AR subledgers reconciled to GL, depreciation entries posted, accruals recorded, inter-company balances reconciled. The system has no such checklist.

**Risk:** Periods close with missing or incomplete entries, resulting in misstated financial statements that require restatement.

**Fix:** Implement a `PreCloseValidator`:
- Define a configurable checklist of close activities:
  - Bank reconciliation completed for all accounts (query QBO reconciliation status).
  - AR aging reviewed: no items older than configurable threshold without explanation.
  - AP aging reviewed: all received goods/services have corresponding bills.
  - Payroll posted and reconciled.
  - Depreciation/amortization entries posted (check for recurring entries).
  - Revenue deferrals/accruals posted (cross-reference with revenue recognition schedules).
  - Inter-company balances reconciled (if multi-entity).
  - Trial balance reviewed: no unexpected balances, no negative balances in liability/revenue accounts.
- Block transition from Open to Preliminary Close until the checklist is substantially complete.
- Provide a `close_readiness_report` tool that shows checklist status.

## Weakness 50: Fiscal Year Configuration Mismatch Risk

The MCP server must respect the company's fiscal year, which may not be calendar-year. If the server assumes January-December, but the company has a July-June fiscal year, all period-based controls (close dates, retention, Benford's analysis, reporting) produce incorrect results.

**Risk:** Period controls applied to wrong date ranges, reports generated for wrong periods, year-end procedures triggered at wrong times.

**Fix:** On initialization, query QBO's CompanyInfo endpoint for fiscal year start month. Store in `CompanyConfig` and derive all period boundaries from it. Specifically:
- Period close dates must align with fiscal months, not calendar months.
- Year-end controls trigger at fiscal year-end.
- Retention policy periods calculated from fiscal year-end dates.
- All reporting tools must default to fiscal year periods.
- Provide a `fiscal_calendar` tool that shows all period dates, close statuses, and current period.
- Validate fiscal year configuration on each server restart (it can be changed in QBO).

## Weakness 51: Adjusting Entry Timing and Documentation Controls

Building on Iteration 2's AJE detection (#14), there are no controls around the timing and documentation of adjusting entries during the close process. AJEs created before the preliminary close have different significance than those created after.

**Risk:** Late AJEs (created after preliminary financials are issued) can change previously communicated results. Without timing controls, it's impossible to distinguish between normal close entries and after-the-fact adjustments.

**Fix:** Implement `AJETimingControls`:
- Track when AJEs are created relative to the period close workflow stages.
- AJEs created during Open period: classified as "normal" adjustments.
- AJEs created during Preliminary Close: classified as "close" adjustments.
- AJEs created after Under Review begins: classified as "late" adjustments — require enhanced justification, controller approval, and notification to anyone who received preliminary financials.
- AJEs created during Audit Adjustment: classified as "audit" adjustments — require auditor reference number.
- Provide a `aje_timing_report` tool that categorizes all AJEs by stage for each closed period.

## Weakness 52: Multi-Period Report Consistency

The MCP server can generate 30 report types. Comparative reports (e.g., P&L current year vs. prior year) depend on prior period data being stable. If prior period adjustments occur, comparative reports must reflect them consistently.

**Risk:** Comparative reports showing different prior-period numbers than previously issued reports without explanation. This creates confusion and erodes trust in financial data.

**Fix:** Implement `ReportConsistencyTracker`:
- When a report is generated, store a hash of the report data along with the report parameters and timestamp.
- When the same report is generated again with the same parameters, compare hashes. If different, flag that the underlying data has changed and identify which line items changed.
- For comparative reports: track the "as-originally-reported" and "as-restated" values for any period that has been reopened.
- Provide a `report_change_log` tool that shows when and why a report's output changed.
- Include a "Report Basis" indicator on all generated reports: "As Reported", "As Adjusted", or "Preliminary."

## Weakness 53: Year-End Closing Entry Controls

Year-end closing entries (zeroing out income/expense accounts to retained earnings) are a critical and irreversible process. QBO handles some of this automatically, but the API allows manual intervention. The MCP server could inadvertently create entries that conflict with QBO's automatic close.

**Risk:** Duplicate closing entries (AI + QBO auto) or missing closing entries cause retained earnings to be incorrect, corrupting the balance sheet.

**Fix:** Implement `YearEndCloseGuard`:
- Detect when a journal entry targets Retained Earnings or income summary accounts.
- Block AI-initiated closing entries unless the company has explicitly opted out of QBO's automatic year-end close.
- Before allowing any entry to Retained Earnings, verify: (a) it's fiscal year-end, (b) the prior year is in Final Close or Audit Adjustment stage, (c) the entry is authorized by a controller.
- Provide a `year_end_close_status` tool showing: fiscal year-end date, auto-close status, retained earnings balance, and any manual entries to retained earnings.

---

# ITERATION 9 — Disaster Recovery, Business Continuity, Token Management, SLAs

## Weakness 54: No Disaster Recovery Plan for MCP Server State

The MCP server maintains critical state: audit logs, configuration, idempotency registry, period status, approval queues, monitoring data. If the server's storage fails, all of this state is lost.

**Risk:** Loss of audit logs violates retention requirements. Loss of configuration disables all controls. Loss of idempotency registry enables duplicate creation. This is a complete control failure.

**Fix:** Implement a `DisasterRecoveryPlan`:
- All critical state must be stored in a managed database with automated backups (e.g., managed PostgreSQL with point-in-time recovery).
- Audit logs must be replicated to a separate storage system (different provider/region) with at least daily replication.
- Configuration must be stored in version control (Git) in addition to the runtime store, enabling reconstruction from code.
- Define Recovery Point Objective (RPO): maximum 1 hour for audit data, 15 minutes for transactional state.
- Define Recovery Time Objective (RTO): maximum 4 hours for full server recovery.
- Provide a `backup_status` tool showing last backup time, replication lag, and recovery test results.
- Test recovery procedures quarterly and log test results.

## Weakness 55: Business Continuity During MCP Server Outage

If the MCP server goes down, AI assistants lose all access to QBO. Depending on how deeply integrated the AI is in accounting workflows, this could halt invoice processing, payment runs, and period-close activities.

**Risk:** An MCP server outage during a critical period (month-end close, tax filing deadline, payroll run) could cause missed deadlines, late payments, and financial penalties.

**Fix:** Implement `BusinessContinuityControls`:
- Define a degraded-mode operation plan: if the MCP server is unavailable, provide documented manual procedures for critical workflows (direct QBO web interface access).
- Implement a `health_check` endpoint that monitoring systems can poll. Alert on degradation before full failure.
- For critical scheduled operations (payroll, tax payments), implement a notification system that alerts if the operation hasn't been completed by a deadline.
- Maintain a "critical operations calendar" that increases monitoring sensitivity around known deadlines.
- Implement graceful degradation: if the control policy database is unavailable, default to "block all writes" rather than "allow all writes" (fail-closed, not fail-open).

## Weakness 56: OAuth Token Expiry During Critical Operations

QBO OAuth tokens expire (access token: 1 hour; refresh token: 100 days). The architecture mentions "automatic refresh" but does not address: (a) what happens if a refresh fails during a multi-step operation, (b) what happens if the refresh token expires (requires re-authorization — a human-interactive process), (c) what happens during the re-authorization window.

**Risk:** Token expiry during a batch payment run could leave payments partially processed. Refresh token expiry during tax filing season requires human intervention that may not be available immediately. Operations during the gap are lost.

**Fix:** Implement `TokenLifecycleManager`:
- Track token expiry proactively. Alert 30 days before refresh token expiry. Alert again at 14 days, 7 days, and 1 day.
- Before any multi-step operation (batch, payment run, close procedures), verify token freshness and pre-emptively refresh if the access token will expire within the operation's estimated duration.
- If token refresh fails: (a) do not retry more than 3 times, (b) pause all operations, (c) send urgent notification to the designated administrator, (d) log the failure and all paused operations.
- Implement "operation checkpointing": for multi-step operations, save progress at each step so that after re-authorization, the operation can resume rather than restart.
- Provide a `token_status` tool showing: access token expiry, refresh token expiry, last successful refresh, and health status.

## Weakness 57: No SLA Definition for Financial Operations

The architecture has no defined service level agreements for financial operations. Financial operations have inherent time sensitivity: invoices must be sent promptly, payments must clear before due dates, payroll must process on schedule, tax filings have hard deadlines.

**Risk:** Without SLAs, there is no objective measure of whether the MCP server is performing adequately for financial operations. Degradation goes unnoticed until a deadline is missed.

**Fix:** Implement `FinancialSLAFramework`:
- Define SLAs per operation type:
  - Invoice creation: < 5 seconds p99 latency.
  - Payment processing: < 10 seconds p99 latency, with confirmation.
  - Report generation: < 30 seconds for standard reports, < 2 minutes for large custom reports.
  - Batch operations: < 60 seconds for 30-item batch.
  - Webhook processing: < 5 seconds from receipt to completion.
  - Approval queue processing: notifications sent within 1 minute of threshold trigger.
- Monitor actual performance against SLAs. Alert when approaching SLA thresholds.
- Provide an `sla_compliance_report` tool showing SLA adherence over time.
- Include rate limit headroom monitoring: alert when approaching QBO's 500 req/min limit.

## Weakness 58: No Graceful Handling of QBO Service Outages

QBO itself experiences outages. The architecture's retry logic handles transient errors, but not extended outages. During a QBO outage, the MCP server has no strategy beyond retrying.

**Risk:** During QBO outages, queued operations accumulate. When QBO comes back, a burst of operations may exceed rate limits, trigger duplicate detection, or process in wrong order.

**Fix:** Implement `QBOOutageHandler`:
- Detect QBO outages by monitoring error rates (> configurable threshold of 5xx errors in a window).
- When outage is detected: (a) stop new operation submissions, (b) queue pending operations with order preservation, (c) notify operators, (d) switch to "outage mode" in the health dashboard.
- When QBO recovers: (a) verify connectivity with a read-only health check, (b) process queued operations in order at a throttled rate (50% of rate limit), (c) verify each operation's idempotency before submission, (d) run a reconciliation check after the queue is drained.
- Provide a `qbo_service_status` tool showing current QBO health, historical uptime, and any active outage windows.

## Weakness 59: No Encryption Key Management Strategy

Multiple controls require encryption: token storage, PII protection, audit log integrity, data at rest. The architecture mentions "encrypted token storage" but does not address key management: where are encryption keys stored, how are they rotated, what happens if a key is compromised?

**Risk:** Encryption without proper key management provides false security. Keys stored alongside encrypted data, hard-coded keys, or keys without rotation are common vulnerabilities that, when exploited, expose all protected data.

**Fix:** Implement `KeyManagementFramework`:
- Use an external key management service (AWS KMS, Azure Key Vault, or HashiCorp Vault) for all encryption keys. Never store keys in the application code, config files, or environment variables.
- Define key types: (a) token encryption key, (b) PII encryption key, (c) audit log signing key, (d) webhook HMAC validation key.
- Implement key rotation: annual rotation for data encryption keys, with re-encryption of stored data. Immediate rotation on suspected compromise.
- Implement key access logging: every use of an encryption key is logged.
- Provide a `key_rotation_status` tool showing last rotation date, next scheduled rotation, and key health.

---

# ITERATION 10 — FINAL SYNTHESIS

I have now reviewed all findings from iterations 1 through 9. Below is the consolidated, risk-ranked audit report.

---

# CPA AUDIT — FINAL FINDINGS

## CRITICAL RISK

**[F-01] No Authorization or Approval Controls on Financial Transactions (Iteration 1, #2)**
- Weakness: A single OAuth token grants unrestricted CRUD on all 36 QBO entities. No dollar thresholds, no approval workflows, no segregation between creating and approving transactions.
- Risk: An AI session could create fraudulent vendors, invoices, and payments with zero human oversight. Catastrophic internal control failure — this alone is a material weakness.
- Fix: Implement a `ControlPolicy` engine with configurable dollar thresholds per entity type. High-risk operations (JournalEntry, Vendor creation, Payment execution, Account modification, Void) require dual authorization. Stage operations exceeding thresholds in a `pending_approval` queue with notifications. Expose `list_pending_approvals` and `approve_operation` tools requiring separate human-held credentials.
- Implementation: TypeScript middleware intercepting all write operations. Policy stored in encrypted database with change control (see F-11). Queue backed by persistent storage with TTL and escalation timers.

**[F-02] No Segregation of Duties Matrix (Iteration 4, #26)**
- Weakness: No formal SoD controls. The same AI session can create a vendor and approve payment to that vendor, or create a journal entry and approve it.
- Risk: Absence of SoD is the most fundamental internal control failure. Would be classified as a material weakness in any SOX audit. Enables fraud without collusion.
- Fix: Implement a `SegregationOfDutiesEngine` with a conflict matrix: Vendor creation ↔ Payment approval, Invoice creation ↔ Payment receipt, JE creation ↔ JE approval, Bank reconciliation ↔ Transaction entry, User access ↔ Transaction processing. Block conflicting operations by the same session/user on the same entity within a configurable window.
- Implementation: Conflict matrix as a configurable data structure. Session activity log checked before each operation. Conflicts generate a hard block with an explanation directing the user to use a different authorized session.

**[F-03] No Period-Close Enforcement (Iteration 2, #9; enhanced Iteration 8, #48)**
- Weakness: No server-side concept of periods being open or closed. QBO's closing date can be overridden via API. No distinction between preliminary and final close.
- Risk: Transactions posted to closed periods corrupt previously issued financial statements. For public companies, this creates restatement risk and SOX violation.
- Fix: Five-stage `PeriodController`: Open → Preliminary Close → Under Review → Final Close → Audit Adjustment. Each stage defines permitted operations. Block all writes to closed periods regardless of authorization. Period transitions require controller-level authorization with immutable logging.
- Implementation: Period status table in the persistent store with stage, authorized-by, timestamp. Pre-write middleware checks transaction date against period registry. Fiscal calendar derived from QBO CompanyInfo (see F-32).

**[F-04] Management Override of Controls (Iteration 4, #25)**
- Weakness: All controls can be overridden by administrators. No detection, no external notification, no limits on override frequency.
- Risk: Management override is the one risk that internal controls cannot eliminate (ISA 240). Without detection and external notification, overrides are invisible.
- Fix: Separate "exception" (one-time with justification) from "disable" (turning off control). All overrides logged in a dedicated override log replicated to an external system (SIEM, email to audit committee). Critical overrides trigger immediate multi-party notification. Implement an "override budget" with escalation when exceeded.
- Implementation: Override interceptor wrapping all control checks. External notification via email/webhook to designated parties. Override log in separate storage with independent access controls.

**[F-05] PCI-DSS Scope Contamination from Payments API (Iteration 6, #36)**
- Weakness: The MCP server handles card tokens and potentially full card numbers through the Payments API. Any system transmitting/storing cardholder data is PCI-scoped.
- Risk: PCI-DSS non-compliance: fines of $5K-$100K/month, loss of card processing. Full PANs in audit logs would be a critical PCI violation.
- Fix: NEVER log, store, or transmit full PANs. Mask to last 4 digits in all outputs. Direct clients to QBO's client-side tokenization (SAQ A eligible). Implement `sensitive_data_scanner` that applies Luhn-check regex to all log entries and responses, redacting matches before storage.
- Implementation: Regex-based PAN scanner as middleware on all output paths (API responses, log entries, error messages). Card masking utility applied at the API boundary. Architectural documentation declaring SAQ scope.

**[F-06] SSN/PII Exposure in Employee/Payroll Entities (Iteration 6, #37)**
- Weakness: Payroll API accesses SSNs. No masking in API responses, audit logs, error messages, or cache.
- Risk: SSN breach triggers all 50-state notification laws, IRS Publication 1075 violations, identity theft liability ($150-$350/record).
- Fix: Classify all entity fields by sensitivity. Mask all Restricted fields (SSN, TIN, bank account numbers) to last 4 digits everywhere. Full values only via dedicated `retrieve_sensitive_field` tool with elevated auth, access logging, and rate limiting (max 10/hour). Data-at-rest encryption with AES-256 and external key management.
- Implementation: Field-level classification map for all QBO entities. Output sanitizer middleware. Dedicated high-privilege tool with separate authorization. KMS integration for encryption keys.

**[F-07] Audit Trail Immutability Not Guaranteed (Iteration 1, #1)**
- Weakness: "Audit logging" without immutability controls. The same process that creates transactions can alter logs.
- Risk: Tampered audit logs render all other controls unverifiable. External auditors cannot rely on the evidence.
- Fix: Cryptographic append-only audit log: SHA-256 hash chain linking each entry to its predecessor. External NTP timestamps. Write to immutable store (S3 Object Lock or append-only database with triggers preventing UPDATE/DELETE). `verify_audit_chain` tool for chain integrity validation.
- Implementation: AuditEntry type with: entryId, previousHash, entryHash, ntpTimestamp, sessionId, userId, operation, requestPayload, responsePayload, qboTransactionId. S3 Object Lock in COMPLIANCE mode (not Governance) for true immutability. Chain verification job running on schedule.

---

## HIGH RISK

**[F-08] No Transaction Integrity Validation Before Submission (Iteration 1, #3)**
- Weakness: MCP server acts as pass-through. No validation of debit/credit balance, account validity, tax codes, or company policies before QBO submission.
- Risk: AI-generated entries violating company policies or accounting standards pass through to QBO, requiring manual cleanup.
- Fix: `PreSubmissionValidator` middleware: JE balance check (integer cents arithmetic), active account validation, required field enforcement, tax code validity, payment ≤ invoice balance. Configurable per-company via plugin interface.
- Implementation: Validator chain pattern. Each validator is a pure function: (operation, context) → ValidationResult. Validators composable and extensible. All use Money type (see F-09).

**[F-09] Floating-Point Currency Arithmetic (Iteration 2, #12)**
- Weakness: JavaScript IEEE 754 floating-point cannot represent $0.01 exactly. All monetary calculations in the TypeScript layer are vulnerable to rounding errors.
- Risk: Penny rounding errors accumulate over thousands of transactions, causing trial balance discrepancies and audit adjustments.
- Fix: Define a `Money` type using integer cents with currency code. All internal arithmetic in cents. Alternatively, use `decimal.js` or `big.js`. Convert to/from QBO's decimal string format only at the API boundary. Mandatory test cases for classic floating-point failures.
- Implementation: `class Money { private cents: bigint; currency: string; }` with arithmetic methods that maintain precision. Conversion layer at QBO API adapter boundary.

**[F-10] No Idempotency Controls for Financial Operations (Iteration 1, #4)**
- Weakness: Retry logic without idempotency. Timeouts and retries can create duplicate transactions. QBO's `requestid` support is partial.
- Risk: Duplicate invoices, payments, and journal entries corrupt financial statements. Difficult to detect retroactively.
- Fix: Client-side idempotency layer: deterministic key (hash of entity type + key fields + time window). Persistent idempotency registry mapping keys to QBO IDs. Check before every write. Use QBO's `requestid` where supported. Post-write verification query where not.
- Implementation: IdempotencyKey = SHA-256(entityType + canonicalFields + timeWindowBucket). Registry in persistent store with TTL matching the retry window. Atomic check-and-set operation.

**[F-11] No Change Management Controls on Configuration (Iteration 4, #22)**
- Weakness: Control policies, thresholds, validators, and rules stored in modifiable configuration. No versioning, no approval, no audit trail for changes.
- Risk: SOX ITGC violation. Changing a threshold from $10K to $10M effectively disables the control. Without change management, controls can be silently weakened.
- Fix: Versioned, immutable configuration store. Every change requires controller authorization, is logged with before/after values and justification. Four-eyes principle for changes. `config_change_history` tool. `config_drift_detector` comparing runtime vs. baseline.
- Implementation: Configuration table with version column, changed_by, approved_by, justification, previous_hash. Application reads latest approved version. Configuration changes through a dedicated API with two-party approval.

**[F-12] Batch Operations Bypass Individual Controls (Iteration 1, #5)**
- Weakness: Batch of 30 operations could total a material amount while each individual operation stays below thresholds.
- Risk: Classic structuring/smurfing — approval controls circumvented by splitting.
- Fix: Batch-level aggregate controls: sum all monetary amounts by type before submission. Apply aggregate thresholds in addition to per-item. Flag batches with multiple items to the same vendor/customer. Log batch as single audit event with linked sub-operations.
- Implementation: BatchAnalyzer runs before batch submission. Aggregates amounts by entity type, counterparty, and account. Applies both individual and aggregate threshold checks.

**[F-13] Void Operations Lack Compensating Controls (Iteration 1, #6; enhanced Iteration 2, #10)**
- Weakness: Voids allowed without mandatory approval, reason codes, or cascade impact analysis. Voiding an invoice doesn't automatically address linked payments.
- Risk: Voids conceal fraud (revenue suppression, payment concealment). Partial voids create orphaned records and break reconciliation.
- Fix: ALL voids require human approval regardless of amount. Mandatory reason from controlled vocabulary. Compensating audit entry auto-generated. `VoidCascadeEngine` identifies and presents all downstream impacts. Void ordering enforced (payments before source documents). Post-void consistency check.
- Implementation: VoidHandler class encapsulating: cascade analysis (query linked entities), approval routing, reason capture, ordered execution, and post-void verification. Void rate anomaly detector comparing against rolling baseline.

**[F-14] Insufficient Audit Evidence for AI-Initiated Transactions (Iteration 4, #23)**
- Weakness: Audit log captures API calls but not the decision chain: human instruction, AI reasoning, source documents, validation results, approval chain.
- Risk: External auditors cannot verify AI-initiated transactions. May issue qualified opinions or require extensive compensating procedures.
- Fix: `AuditEvidencePackager` capturing for every write: original human instruction/trigger, AI reasoning chain, source document references, pre-submission validation results, approval chain. Stored linked to QBO transaction IDs. Bulk export capability (PDF with digital signatures).
- Implementation: EvidencePackage type extending audit log entry. MCP protocol metadata extraction for conversation context. Package stored in immutable store alongside audit chain. PDF export with SHA-256 manifest.

**[F-15] No Encryption Key Management Strategy (Iteration 9, #59)**
- Weakness: Multiple features require encryption, but no key management strategy. Keys stored alongside encrypted data or hard-coded undermine all encryption.
- Risk: Compromised keys expose all protected data: tokens, PII, audit logs. False sense of security.
- Fix: External KMS (AWS KMS, Azure Key Vault, HashiCorp Vault). Key types: token encryption, PII encryption, audit signing, webhook HMAC. Annual rotation with re-encryption. Immediate rotation on compromise. Key access logging.
- Implementation: KMS adapter interface supporting multiple providers. KeyReference type storing key ID and version, never raw key material. Envelope encryption pattern: data encrypted with data key, data key encrypted with master key in KMS.

**[F-16] No IT General Controls Framework (Iteration 4, #24)**
- Weakness: The MCP server is a financial application without ITGCs: no RBAC, no operations monitoring, no program development controls.
- Risk: All controls unreliable if the server itself is not controlled. SOX audit deficiency.
- Fix: RBAC with roles (Viewer, Clerk, Accountant, Controller, Admin). Map tools to minimum roles. Health monitoring with alerting. Control test suite run before deployment. `user_access_review` tool for periodic access reviews.
- Implementation: Role enum and ToolPermissionMap. Authentication middleware checking role before tool execution. Health check endpoints. Automated test suite as CI/CD gate.

**[F-17] No Disaster Recovery for MCP Server State (Iteration 9, #54)**
- Weakness: Critical state (audit logs, config, idempotency registry, period status, approval queues) has no backup/recovery plan.
- Risk: Loss of audit logs violates 7-year retention. Loss of idempotency registry enables duplicates. Loss of config disables controls. Total control failure.
- Fix: Managed database with automated backups (RPO: 1 hour for audit, 15 minutes for transactional). Audit log replication to separate provider/region. Configuration in version control. RTO: 4 hours. Quarterly recovery testing.
- Implementation: PostgreSQL with point-in-time recovery. S3 cross-region replication for audit logs. Git repository for configuration baseline. Recovery runbook with tested procedures.

---

## MEDIUM RISK

**[F-18] No ASC 606 Revenue Recognition Safeguards (Iteration 3, #15)**
- Weakness: Invoices created with no awareness of multi-element arrangements, performance obligations, or deferred revenue requirements.
- Risk: Improper revenue recognition — the most common cause of financial restatements.
- Fix: `RevenueRecognitionGuard`: require `revenue_recognition_date`, configurable `deferred_revenue_rules` registry, auto-generation of deferred revenue entries for qualifying items, `revenue_schedule` tool for multi-period contracts.
- Implementation: RevenueRule configuration mapping item/service codes to recognition patterns (point-in-time, over-time, milestone). Interceptor on Invoice creation checking line items against rules.

**[F-19] Sales Tax Compliance Gaps (Iteration 3, #16)**
- Weakness: AI-created invoices could use wrong tax codes, exempt taxable items, or lack proper jurisdiction determination.
- Risk: Under/over-collection of sales tax creates liabilities, penalties, and customer disputes.
- Fix: `TaxComplianceValidator`: validate shipping address, line item tax categories, exemption certificate validity. Flag anomalous tax amounts. Track exemption expiry.
- Implementation: Pre-submission validator checking tax code presence and validity. Exemption certificate tracking table with expiry alerts.

**[F-20] 1099 Reporting Data Integrity (Iteration 3, #17)**
- Weakness: Vendors and payments created without validating 1099-eligible status, TIN correctness, or payment categorization.
- Risk: Missing/incorrect 1099s: $310 per form IRS penalty, no cap for intentional disregard.
- Fix: `Vendor1099Validator`: require 1099 flag, TIN (format-validated), W-9 confirmation for eligible vendors. Map payment types to 1099 boxes. `vendor_1099_readiness_report` tool.
- Implementation: Enhanced vendor creation validator. TIN format regex. Year-end readiness report querying vendors with payments > $600 lacking required data.

**[F-21] Multi-Currency Transaction Risks (Iteration 3, #18)**
- Weakness: No controls around exchange rate validity, currency consistency, or unrealized gain/loss recognition.
- Risk: Incorrect exchange rates misstate financials. Missing gain/loss entries corrupt balance sheet.
- Fix: `CurrencyGuard`: detect multi-currency status, validate exchange rates within tolerance of market rate, enforce currency consistency per customer/vendor, `unrealized_gain_loss_report` at period-end.
- Implementation: FX rate adapter (configurable source). Rate tolerance check. Customer/vendor currency consistency enforcement.

**[F-22] Accrual vs. Cash Basis Inconsistency (Iteration 3, #19)**
- Weakness: No awareness of company's accounting basis. AI may create entries inconsistent with the declared basis.
- Risk: Entries violating the company's accounting basis corrupt financial statements and confuse auditors.
- Fix: Query CompanyInfo on initialization for accounting basis. Warn on cash-basis accrual entries or accrual-basis cash entries. `basis_consistency_check` tool.
- Implementation: CompanyConfig.accountingBasis set during initialization. Heuristic rules flagging entries to accrual-specific accounts under cash basis and vice versa.

**[F-23] No Materiality Thresholds for Automated Operations (Iteration 3, #20)**
- Weakness: Same controls for $5 and $5M transactions. System either over-flags (unusable) or under-flags (dangerous).
- Risk: Without materiality-based controls, operational efficiency and audit effectiveness are both compromised.
- Fix: `MaterialityEngine`: configurable thresholds (overall, performance, trivially-small). Below trivially-small: log only. Between thresholds: standard controls. Above performance materiality: enhanced controls. Thresholds as absolute dollars AND percentage of relevant line item.
- Implementation: Materiality configuration per entity type. Three-tier classification applied in the control policy evaluation. `set_materiality_thresholds` tool (controller-only).

**[F-24] Bank Reconciliation Data Integrity (Iteration 2, #11)**
- Weakness: No protection against modifying or voiding reconciled transactions.
- Risk: Modifying reconciled transactions breaks bank reconciliation, requiring re-reconciliation of the entire period.
- Fix: `ReconciliationGuard`: before modifying any bank-side transaction, check QBO reconciliation status. Block modifications to reconciled transactions. `reconciliation_status_check` tool.
- Implementation: Pre-modification query to QBO for reconciliation status. Local cache of reconciliation status for frequently accessed accounts to reduce API calls.

**[F-25] Duplicate Transaction Detection (Iteration 5, #32)**
- Weakness: Beyond retry idempotency, no detection of duplicates from parallel entry (AI + human, AI + bank feed).
- Risk: Duplicate transactions double-count revenue, expenses, or payments.
- Fix: `DuplicateDetectionEngine`: fuzzy matching on customer/vendor + amount + date window + reference number. Score potential duplicates. Block above threshold. `duplicate_scan` for retrospective analysis. Track confirmed non-duplicates.
- Implementation: Pre-creation query to QBO with fuzzy matching criteria. Similarity scoring algorithm. Duplicate registry tracking reviewed pairs.

**[F-26] Orphaned Record Detection (Iteration 5, #33)**
- Weakness: No detection of payments without invoices, deposits without payments, credits without applications.
- Risk: Orphaned records corrupt AR/AP aging, break reconciliation, and create audit exceptions.
- Fix: `OrphanDetectionEngine`: define expected linkage patterns. Run daily and after batch operations. `orphan_report` tool. Flag orphans older than configurable threshold.
- Implementation: Linkage rules configuration. Scheduled scanner querying QBO for unlinked entities. Aging calculation for orphaned records.

**[F-27] CDC Gap Detection (Iteration 5, #29)**
- Weakness: No mechanism to detect gaps in CDC polling. Server downtime > 30 days loses changes permanently.
- Risk: Stale local state produces incorrect reports and analytics. Financial decisions based on wrong data.
- Fix: `CDCGapDetector`: record every poll timestamp and overlap verification. Gap detection triggers full reconciliation. > 30-day gap triggers full re-sync alert. `cdc_health_status` indicator.
- Implementation: CDC polling metadata table. Gap detection on each poll. Health status endpoint.

**[F-28] Partial Batch Failure Handling (Iteration 5, #31)**
- Weakness: Mixed batch results (some succeed, some fail) leave system in inconsistent state. No compensating transaction logic.
- Risk: Half-completed transaction sets (invoice without payment, bill without bill-payment) create data integrity issues.
- Fix: `BatchTransactionManager`: classify operations as independent or dependent. For dependent: compensate on partial failure. Comprehensive batch result logging. `batch_result_reconciliation` tool. Retry queue for failed items.
- Implementation: Batch dependency graph. Compensating transaction generator for each entity type. Batch audit log linking all sub-operations.

**[F-29] Journal Entry Semantic Validation (Iteration 2, #8)**
- Weakness: Balanced but nonsensical journal entries pass debit=credit check. No validation of account-type pairing logic.
- Risk: Revenue-to-revenue washes, improper capitalizations, reclassifications without disclosure pass undetected.
- Fix: `JournalEntrySemanticValidator`: account-type pairing rules, unusual pairing anomaly flags, recurring entry template matching, same-account debit/credit detection.
- Implementation: Pairing rules configuration based on QBO account types. Anomaly scoring integrated with the anomaly detection framework (F-30).

**[F-30] No Unusual Journal Entry Detection (Iteration 7, #42)**
- Weakness: No anomaly scoring for journal entries. Classic fraud patterns (round amounts, after-hours, threshold proximity, rare accounts) go undetected.
- Risk: AI-initiated or AI-assisted fraudulent entries remain undetected until external audit.
- Fix: `JournalEntryAnomalyScorer`: multi-dimensional scoring (amount z-score, timing, round numbers, threshold proximity, account rarity, description quality). Composite score routing high-risk entries to review queue.
- Implementation: Statistical baseline built from historical data. Scorer applied to all JE operations. Review queue with configurable threshold.

**[F-31] No Session Identity Binding (Iteration 1, #7)**
- Weakness: Multiple AI sessions indistinguishable in audit trail. No accountability link from transaction to human user.
- Risk: Cannot determine which AI or human initiated a transaction. Fraud investigation impossible.
- Fix: Session-level identity binding: unique session token linked to human user. Audit entries include session ID, user ID, AI model ID, conversation hash. Multiple concurrent sessions with different permission levels.
- Implementation: Session authentication middleware. Session metadata type included in every audit entry. RBAC scoped per session.

**[F-32] Fiscal Year Configuration Mismatch (Iteration 8, #50)**
- Weakness: Server may assume calendar year when company uses non-standard fiscal year.
- Risk: Period controls, retention calculations, reporting, and year-end procedures triggered at wrong times.
- Fix: Query QBO CompanyInfo for fiscal year start month on initialization. Derive all period boundaries from it. Validate on each restart. `fiscal_calendar` tool.
- Implementation: CompanyConfig.fiscalYearStart populated from QBO API. PeriodCalculator utility deriving period dates, quarter boundaries, and year-end from fiscal year start.

**[F-33] Adjusting Entry Timing Controls (Iteration 2, #14; enhanced Iteration 8, #51)**
- Weakness: AJEs not differentiated from regular entries. No timing classification relative to close workflow.
- Risk: Late AJEs change previously communicated results without proper tracking or authorization.
- Fix: `AJE_Detector` flagging entries with period-end timing, adjustment-type accounts, or close-related keywords. `AJETimingControls` classifying entries by close stage (normal, close, late, audit). Enhanced authorization for late AJEs.
- Implementation: AJE heuristic detector as pre-submission validator. Close-stage classification based on period controller state. Controller-approval routing for late AJEs.

**[F-34] Cross-System Reconciliation (Iteration 5, #34)**
- Weakness: No facility to reconcile MCP server's view against QBO's actual state, especially when other systems also write to QBO.
- Risk: Divergence between MCP state and QBO truth leads to incorrect decisions.
- Fix: `ReconciliationEngine`: full query of QBO vs. MCP audit log for a date range. Identify QBO-only, MCP-only, and mismatched items. Configurable schedule. `reconciliation_history` for trends.
- Implementation: Scheduled reconciliation job. Comparison engine matching on QBO transaction IDs. Discrepancy report generation.

---

## LOW RISK

**[F-35] No Financial Record Retention Policy (Iteration 6, #39)**
- Weakness: No automated retention management. Records may be deleted prematurely or retained indefinitely.
- Risk: Premature deletion violates 7-year IRS/SOX requirements. Indefinite retention increases breach surface and storage costs.
- Fix: `RetentionPolicyEngine`: defined periods by record type (7 years for tax/financial, 90 days for temp data). Automated expiry flagging. Legal hold capability. `retention_status_report` tool.
- Implementation: Retention metadata on all stored records. Scheduled expiry scanner. Legal hold flag overriding normal retention.

**[F-36] No Data Classification Framework (Iteration 6, #38)**
- Weakness: All data treated identically regardless of sensitivity.
- Risk: Over-protecting low-sensitivity data causes friction. Under-protecting high-sensitivity data causes compliance violations.
- Fix: Four-tier classification (Public, Internal, Confidential, Restricted). Map every QBO field. Define per-tier controls for logging, caching, encryption, access, retention.
- Implementation: DataClassification enum. EntityFieldClassification map. Tier-aware middleware for all output paths.

**[F-37] Webhook Reliability (Iteration 5, #30)**
- Weakness: Missed webhooks from server downtime, network failures, or processing errors go undetected.
- Risk: System unaware of transactions created directly in QBO, breaking completeness assumption.
- Fix: `WebhookReliabilityLayer`: event deduplication, heartbeat cross-check with CDC, dead-letter queue, `webhook_health_report`. HMAC failures quarantined (not discarded).
- Implementation: Webhook event log with dedup on event ID. Periodic CDC cross-check. Dead-letter queue with retry and manual review.

**[F-38] Multi-Entity Consolidation Risks (Iteration 3, #21)**
- Weakness: No controls for inter-company transactions, elimination entries, or policy consistency across entities.
- Risk: Inter-company transactions inflate consolidated revenue. Inconsistent policies make consolidation unreliable.
- Fix: `MultiEntityController`: inter-company relationship registry, paired transaction enforcement, `intercompany_reconciliation` tool, consistent chart of accounts mapping.
- Implementation: Entity relationship configuration. Transaction interceptor checking counterparty against related-entity registry. Reconciliation query comparing reciprocal balances.

**[F-39] AI Model Version Tracking (Iteration 4, #27)**
- Weakness: AI model version, system prompt, and tool definitions not tracked. Behavior changes are invisible.
- Risk: Cannot correlate transaction pattern changes with model updates. Auditors cannot assess AI reliability without version history.
- Fix: Every audit entry includes model ID, version, prompt hash, tool definition version. Model change events logged. `model_change_timeline` tool. Approved model version registry.
- Implementation: MCP protocol metadata extraction. Version metadata type in audit entries. Configuration for approved model list.

**[F-40] No Benford's Law Analysis (Iteration 7, #43)**
- Weakness: No capability to detect non-Benford distributions indicating fabrication or manipulation.
- Risk: Systematic fabrication of transactions goes undetected.
- Fix: `BenfordsLawAnalyzer`: first-digit and first-two-digit distribution analysis. Chi-squared test against expected distribution. Drill-down to contributing transactions. `benfords_analysis` tool. Auto-run at period-end.
- Implementation: Statistical analysis module. Configurable population selection. Chi-squared test with p-value threshold. Report generator with distribution charts.

**[F-41] No Continuous Monitoring Framework (Iteration 7, #44)**
- Weakness: Controls are point-in-time only. No trend detection across transactions over time.
- Risk: Gradual fraud or errors (creeping amounts, shifting timing) invisible to point-in-time controls.
- Fix: `ContinuousMonitoringEngine`: scheduled rules for trend analysis, velocity monitoring, split-transaction detection, off-hours activity, new entity surges. Time-series storage. `monitoring_dashboard` and `monitoring_alerts` tools.
- Implementation: Rule engine with configurable schedules. Time-series database (or table) for metrics. Alert routing to operator channels.

**[F-42] Related-Party Transaction Detection (Iteration 7, #45)**
- Weakness: No capability to identify transactions with related parties (officers, board members, affiliates).
- Risk: Undisclosed related-party transactions violate GAAP ASC 850 and SEC requirements.
- Fix: `RelatedPartyDetector`: manually maintained registry with AI-assisted matching. Fuzzy matching on name, address, TIN, contact info. Enhanced approval and disclosure tagging. `related_party_transactions_report` tool.
- Implementation: Related-party registry table. Fuzzy matching engine. Pre-transaction check against registry.

**[F-43] Approval Threshold Circumvention Detection (Iteration 7, #47)**
- Weakness: No detection of transactions deliberately structured to stay just below thresholds.
- Risk: Thresholds become ineffective. Classic fraud technique auditors specifically look for.
- Fix: `ThresholdCircumventionDetector`: proximity band analysis (85-99% of threshold). Statistical comparison of observed vs. expected near-threshold frequency. Integrated with continuous monitoring.
- Implementation: Part of ContinuousMonitoringEngine rule set. Per-threshold proximity analysis. Statistical significance testing.

**[F-44] Year-End Closing Entry Controls (Iteration 8, #53)**
- Weakness: AI could create entries conflicting with QBO's automatic year-end close, duplicating closing entries.
- Risk: Duplicate closing entries corrupt retained earnings and balance sheet.
- Fix: `YearEndCloseGuard`: detect entries targeting retained earnings or income summary. Block unless company opts out of auto-close. Require controller authorization with fiscal year-end verification.
- Implementation: Account type check on JE line items. CompanyConfig.autoYearEndClose flag. Controller-only authorization for retained earnings entries.

**[F-45] Pre-Close Validation Checklist (Iteration 8, #49)**
- Weakness: No automated checklist of required close activities before period transition.
- Risk: Periods close with missing entries, requiring restatement.
- Fix: `PreCloseValidator`: configurable checklist (bank recon, AR/AP reconciliation, payroll, depreciation, accruals, inter-company). Block stage transition until substantially complete. `close_readiness_report` tool.
- Implementation: Checklist configuration per company. Status tracking table. Automated checks where possible (QBO queries for reconciliation status, recurring entry posting verification).

**[F-46] Multi-Period Report Consistency (Iteration 8, #52)**
- Weakness: Comparative reports may show different numbers for the same prior period without explanation.
- Risk: Erodes trust in financial data. Confuses stakeholders.
- Fix: `ReportConsistencyTracker`: hash report data on generation. Compare hashes on re-generation. Flag changes with line-item detail. "Report Basis" indicator. `report_change_log` tool.
- Implementation: Report hash table. Comparison engine for changed reports. Metadata tagging (As Reported, As Adjusted, Preliminary).

**[F-47] Historical Anomaly Detection on Existing Data (Iteration 7, #46)**
- Weakness: All detection targets new transactions. Pre-existing anomalies in QBO data go undetected.
- Risk: Existing fraud or errors remain in the books. New controls built on a flawed foundation.
- Fix: `HistoricalScanEngine`: comprehensive scan on initial connection. Run all detectors against historical data. `historical_scan_report` with prioritized findings. Store baseline for future comparison.
- Implementation: Optional full-scan mode consuming API quota. Batch processing of historical transactions through all anomaly detectors.

**[F-48] No Formal Audit Period Support (Iteration 4, #28)**
- Weakness: No ability to freeze a date range during external audit review.
- Risk: Moving target during audit wastes time and raises reliability concerns.
- Fix: `AuditPeriodSupport`: `begin_audit_period` (freeze range), `generate_audit_extract` (standardized export), `end_audit_period` (release). Modification attempts during freeze logged as potential audit interference.
- Implementation: AuditPeriod table with date range and status. Pre-write middleware checking against active audit periods. Export generator producing CSV/XBRL with hash verification.

**[F-49] OAuth Token Expiry During Critical Operations (Iteration 9, #56)**
- Weakness: Token expiry during multi-step operations creates partial completion. Refresh token expiry requires human intervention that may not be available.
- Risk: Partially processed payment runs, interrupted close procedures during critical deadlines.
- Fix: `TokenLifecycleManager`: proactive expiry alerts (30/14/7/1 day). Pre-operation freshness check. Pre-emptive refresh before long operations. Operation checkpointing for resume after re-auth. `token_status` tool.
- Implementation: Token metadata with expiry timestamps. Background refresh scheduler. Checkpoint table for multi-step operations. Alert routing to multiple administrators.

**[F-50] No Segregation Between Transaction Entry and Bank Statement Access (Iteration 2, #13)**
- Weakness: Same session can create transactions and query bank balances, controlling both sides of a reconciliation.
- Risk: AI creating fraudulent transactions can also verify they won't trigger bank balance alerts.
- Fix: Entity-level permission scoping in ControlPolicy: "Transactional", "Banking", "Reporting" groups. Minimum permission assignment. Cross-group access logged as anomaly.
- Implementation: Permission group configuration. Session-level group assignment. Cross-group access detector in the continuous monitoring framework.

**[F-51] Transaction Reversal Audit Trail (Iteration 5, #35)**
- Weakness: No linkage between original transactions and their reversals. Double-reversals possible.
- Risk: Unlinked reversals confuse audit review. Double-reversals go undetected.
- Fix: `ReversalTracker`: reference original in QBO memo and MCP audit log. Reversal registry (original → reversal → correction). Double-reversal prevention. `reversal_chain` tool.
- Implementation: Reversal metadata in audit entries. Registry table with foreign keys. Pre-reversal check for existing reversals.

**[F-52] Business Continuity During MCP Server Outage (Iteration 9, #55)**
- Weakness: No degraded-mode plan. Server outage halts all AI-driven accounting workflows.
- Risk: Missed deadlines during critical periods (close, tax filing, payroll).
- Fix: Documented manual procedures for critical workflows. Health check endpoint. Critical operations calendar with deadline monitoring. Fail-closed default (block all writes if control database unavailable).
- Implementation: Health check endpoint. Operator alerting. Critical deadline configuration with monitoring. Fail-closed middleware default.

**[F-53] QBO Service Outage Handling (Iteration 9, #58)**
- Weakness: Retry logic without outage detection. No queuing, ordering, or burst-after-recovery management.
- Risk: Accumulated operations during outage cause rate limit violations and ordering issues on recovery.
- Fix: `QBOOutageHandler`: error rate-based outage detection, operation queuing with order preservation, throttled recovery processing at 50% rate limit, post-recovery reconciliation.
- Implementation: Circuit breaker pattern. Persistent queue. Throttled drain on recovery. Health check before resuming.

**[F-54] Financial SLA Framework (Iteration 9, #57)**
- Weakness: No defined service levels for financial operations.
- Risk: Degradation unnoticed until deadlines missed.
- Fix: `FinancialSLAFramework`: defined latency targets per operation type. Performance monitoring. Rate limit headroom alerts. `sla_compliance_report` tool.
- Implementation: SLA configuration. Prometheus-style metrics. Alert thresholds at 80% of SLA.

**[F-55] Sensitive Data in Webhook Payloads (Iteration 6, #40)**
- Weakness: Webhook payloads potentially containing financial data logged or processed insecurely.
- Risk: Data exposure from intercepted or logged webhook payloads.
- Fix: HMAC verification enforced. Classify webhook content as Internal minimum. Log only event type and entity IDs (not raw payload). HTTPS/TLS 1.2+ only. Replay protection (5-minute window).
- Implementation: Webhook handler middleware: verify HMAC → parse → extract IDs → discard raw payload → log metadata only.

**[F-56] Development/Testing Environment Data Controls (Iteration 6, #41)**
- Weakness: Production financial data may leak into less-controlled dev/test environments.
- Risk: PCI-DSS 6.4.3 violation, SOX ITGC violation, data privacy risk.
- Fix: Environment detection from OAuth credentials. Production: full controls. Sandbox: relaxed operational controls, maintained/strengthened data protection. `sanitize_for_testing` tool for fake data generation.
- Implementation: Environment enum in CompanyConfig. Environment-aware control policy loading.

---

## ARCHITECTURE REQUIREMENTS (Consolidated)

All requirements below flow from the 56 findings above. Each is implementable in a TypeScript MCP server.

1. **Immutable Audit Log** — SHA-256 hash-chained, append-only, stored in write-once storage (S3 Object Lock COMPLIANCE mode or equivalent), with external NTP timestamps and `verify_audit_chain` tool. (F-07)

2. **Role-Based Access Control (RBAC)** — Roles: Viewer, Clerk, Accountant, Controller, Admin. Every MCP tool mapped to minimum required role. Least privilege enforced. Periodic access reviews via `user_access_review` tool. (F-16)

3. **Segregation of Duties Engine** — Conflict matrix enforced at runtime. Same session/user cannot perform conflicting operations on the same entity within a configurable window. (F-02)

4. **Approval Workflow Engine** — Configurable dollar thresholds per entity type. Dual authorization for high-risk operations. `pending_approval` queue with notifications, escalation timers, and TTL. (F-01)

5. **Period Controller** — Five-stage close workflow (Open → Preliminary Close → Under Review → Final Close → Audit Adjustment). All writes validated against period status. Controller authorization for stage transitions. (F-03)

6. **Pre-Submission Validation Framework** — Pluggable validator chain applied to every write: JE balance (integer arithmetic), active account, required fields, tax codes, payment bounds, semantic account-pairing, AJE detection, currency validation, basis consistency. (F-08, F-09, F-19, F-21, F-22, F-29, F-33)

7. **Money Type** — All monetary arithmetic via integer cents (bigint) or decimal library. Conversion at API boundary only. Mandatory precision test suite. (F-09)

8. **Idempotency Layer** — Deterministic keys, persistent registry, atomic check-and-set. QBO `requestid` where supported. Post-write verification otherwise. (F-10)

9. **Batch Control Engine** — Aggregate thresholds in addition to per-item. Dependent/independent classification. Compensating transactions on partial failure. Batch-level audit logging. (F-12, F-28)

10. **Void Control Engine** — Mandatory human approval, controlled-vocabulary reason, cascade impact analysis, ordered execution, post-void consistency check, void rate anomaly detection. (F-13)

11. **Duplicate Detection Engine** — Fuzzy matching (counterparty + amount + date + reference). Scoring with configurable threshold. Retrospective scanning capability. Confirmed-non-duplicate tracking. (F-25)

12. **Orphan Detection Engine** — Expected linkage patterns defined and enforced. Scheduled scanning. Orphan aging with threshold alerts. (F-26)

13. **Reconciliation Engine** — QBO-to-MCP full reconciliation. Identifies discrepancies, QBO-only items, MCP-only items. Scheduled execution. History tracking. (F-34)

14. **Audit Evidence Packager** — Full evidence chain per transaction: human instruction, AI reasoning, source documents, validation results, approval chain. Linked to QBO transaction IDs. Bulk export with digital signatures. (F-14)

15. **Management Override Detection** — Separate override log replicated externally. Immediate notification on critical overrides. Override budget with escalation. (F-04)

16. **Configuration Change Control** — Versioned, immutable config store. Four-eyes approval. Before/after logging with justification. Drift detection. (F-11)

17. **PCI Compliance Layer** — PAN never logged/stored/transmitted. Last-4 masking. Client-side tokenization directive. Luhn-check scanner on all outputs. SAQ scope documentation. (F-05)

18. **PII Protection Layer** — Field-level classification. Restricted field masking everywhere. Elevated-auth `retrieve_sensitive_field` tool with rate limiting. AES-256 at-rest encryption. (F-06)

19. **Data Classification Framework** — Four tiers (Public, Internal, Confidential, Restricted). Per-field mapping for all QBO entities. Tier-specific controls for logging, caching, encryption, access, retention. (F-36)

20. **Retention Policy Engine** — Defined periods by record type (7 years for financial/tax). Automated expiry flagging. Legal hold capability. (F-35)

21. **Revenue Recognition Guard** — ASC 606 awareness. Deferred revenue rules. Auto-deferral entries. Revenue schedule tool. (F-18)

22. **Tax Compliance Validators** — Sales tax (address, category, exemption certificate), 1099 (TIN, eligibility, readiness report). (F-19, F-20)

23. **Multi-Currency Guard** — Multi-currency detection, rate tolerance validation, consistency enforcement, unrealized gain/loss reporting. (F-21)

24. **Materiality Engine** — Three-tier thresholds (trivially-small, performance, overall). Dollar and percentage. Per-entity-type configuration. (F-23)

25. **Reconciliation Guard** — Block modification of reconciled bank-side transactions. Reconciliation status query tool. (F-24)

26. **Journal Entry Anomaly Scorer** — Multi-dimensional scoring: amount z-score, timing, round numbers, threshold proximity, account rarity, description quality. Review queue routing. (F-30)

27. **Benford's Law Analyzer** — First-digit/two-digit distribution analysis. Chi-squared testing. Drill-down. Period-end auto-run. (F-40)

28. **Continuous Monitoring Engine** — Scheduled rules: trends, velocity, split-transactions, off-hours, new entity surges, threshold circumvention. Time-series storage. Dashboard and alerts. (F-41, F-43)

29. **Related-Party Detector** — Registry with fuzzy matching. Enhanced approval for flagged transactions. Disclosure reporting. (F-42)

30. **Historical Scan Engine** — Initial comprehensive scan of existing QBO data through all detectors. Baseline establishment. (F-47)

31. **Session Identity Binding** — Unique session tokens linked to human users. Session metadata in all audit entries. Per-session RBAC scoping. (F-31)

32. **AI Model Version Tracking** — Model ID, version, prompt hash, tool version in audit entries. Model change event logging. Approved version registry. (F-39)

33. **Fiscal Calendar** — Derived from QBO CompanyInfo. All period logic respects fiscal year. Validated on restart. (F-32)

34. **Pre-Close Validation Checklist** — Configurable close activities. Automated status checking where possible. Stage-transition gate. (F-45)

35. **Year-End Close Guard** — Detect entries to retained earnings/income summary. Block unless company opts out of QBO auto-close. Controller authorization. (F-44)

36. **Report Consistency Tracker** — Hash-based change detection. Line-item change identification. Report Basis metadata. Change log. (F-46)

37. **Audit Period Support** — Freeze date ranges during external audit. Standardized export. Modification-during-freeze detection. (F-48)

38. **Token Lifecycle Manager** — Proactive expiry alerts (30/14/7/1 day). Pre-operation freshness check. Operation checkpointing for resume. (F-49)

39. **Encryption Key Management** — External KMS. Separate keys by purpose. Annual rotation. Immediate rotation on compromise. Key access logging. Envelope encryption. (F-15)

40. **Disaster Recovery** — Managed DB with backups (RPO: 1h audit / 15min transactional). Cross-region audit log replication. Config in version control. RTO: 4 hours. Quarterly testing. (F-17)

41. **Business Continuity** — Health monitoring. Fail-closed default. Manual procedure documentation. Critical deadline calendar. (F-52)

42. **QBO Outage Handler** — Circuit breaker pattern. Ordered queue. Throttled recovery. Post-recovery reconciliation. (F-53)

43. **Financial SLA Framework** — Per-operation latency targets. Performance monitoring. Rate limit headroom alerts. (F-54)

44. **Webhook Security** — HMAC enforcement. Metadata-only logging. TLS 1.2+. Replay protection. Dead-letter queue. CDC heartbeat cross-check. (F-37, F-55)

45. **Environment Controls** — Environment detection. Production vs. sandbox policy loading. No production data in dev. Test data generation. (F-56)

46. **Reversal Tracker** — Original-to-reversal linkage. Registry preventing double-reversals. `reversal_chain` tool. (F-51)

47. **Bank/Transaction Segregation** — Permission groups (Transactional, Banking, Reporting). Cross-group access flagging. (F-50)

48. **Multi-Entity Controller** — Inter-company registry. Paired transaction enforcement. Cross-entity reconciliation. Consistent policy enforcement. (F-38)

---

**Summary:** This audit identified 56 distinct findings across 9 iterations, of which 7 are Critical, 10 are High, 17 are Medium, and 22 are Low risk. The 48 consolidated architecture requirements above represent the minimum controls necessary for a financial system providing programmatic AI access to QuickBooks Online from a CPA's perspective. The Critical and High findings should be addressed before any production deployment; Medium findings before use by any company subject to external audit; Low findings on a prioritized roadmap within the first year of operation.
