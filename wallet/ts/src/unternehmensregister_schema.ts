import { z } from "zod";

// --- Primitives & Normalization Helpers ---
export const CurrencySchema = z.enum(["EUR", "USD", "GBP"]).default("EUR");

export const MonetaryAmountSchema = z.object({
  currentPeriod: z.number().nullable().optional().describe("Amount in primary currency (e.g. EUR)"),
  previousPeriod: z.number().nullable().optional().describe("Previous year comparison value"),
  dueWithinOneYear: z.object({
    currentPeriod: z.number().nullable().optional(),
    previousPeriod: z.number().nullable().optional(),
  }).optional(),
  dueAfterOneYear: z.object({
    currentPeriod: z.number().nullable().optional(),
    previousPeriod: z.number().nullable().optional(),
  }).optional(),
  dueAfterFiveYears: z.object({
    currentPeriod: z.number().nullable().optional(),
    previousPeriod: z.number().nullable().optional(),
  }).optional(),
  toShareholders: z.object({
    currentPeriod: z.number().nullable().optional(),
    previousPeriod: z.number().nullable().optional(),
  }).optional(),
  lossBroughtForwardIncluded: z.number().nullable().optional(),
  description: z.string().optional(),
});

// --- Metadata & Entity Identification ---
export const RegisterInfoSchema = z.object({
  court: z.string().describe("e.g. Amtsgericht Charlottenburg (Berlin)"),
  type: z.enum(["HRB", "HRA", "GnR", "PR", "VR"]).describe("Commercial register section"),
  number: z.string().describe("e.g. 188071 B"),
});

export const CompanyMetadataSchema = z.object({
  name: z.string().describe("Official legal name as registered"),
  formerName: z.string().optional(),
  legalForm: z.string().describe("e.g. GmbH, AG, UG (haftungsbeschränkt), GmbH & Co. KG"),
  registeredSeat: z.string().describe("City / location of registered office"),
  register: RegisterInfoSchema.optional(),
  lei: z.string().length(20).optional().describe("Legal Entity Identifier, if present"),
});

// --- Publication Scope & Period ---
export const DocumentPeriodSchema = z.object({
  fiscalYearStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fiscalYearEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Balance sheet date (Stichtag)"),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Bekanntmachungsdatum"),
  adoptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Feststellungsdatum"),
  orderReference: z.string().optional().describe("Auftragsnummer / Beleg-ID"),
  isRumpfgeschaeftsjahr: z.boolean().optional(),
});

// --- Balance Sheet (Bilanz nach § 266 HGB) ---
export const BalanceSheetAssetsSchema = z.object({
  fixedAssets: z.object({
    intangibleAssets: MonetaryAmountSchema.optional(),
    tangibleAssets: MonetaryAmountSchema.optional(),
    financialAssets: MonetaryAmountSchema.optional(),
    total: MonetaryAmountSchema.optional(),
  }).optional(),

  currentAssets: z.object({
    inventories: MonetaryAmountSchema.optional(),
    receivables: MonetaryAmountSchema.optional(),
    securities: MonetaryAmountSchema.optional(),
    cashAndBank: MonetaryAmountSchema.optional(),
    total: MonetaryAmountSchema.optional(),
  }).optional(),

  prepaidExpenses: MonetaryAmountSchema.optional(),
  deferredTaxAssets: MonetaryAmountSchema.optional(),
  excessOfPlanAssets: MonetaryAmountSchema.optional(),
  deficitNotCoveredByEquity: MonetaryAmountSchema.optional(),

  totalAssets: MonetaryAmountSchema.describe("Bilanzsumme Aktiva"),
});

export const BalanceSheetEquityLiabilitiesSchema = z.object({
  equity: z.object({
    subscribedCapital: MonetaryAmountSchema.optional(),
    capitalReserves: MonetaryAmountSchema.optional(),
    revenueReserves: MonetaryAmountSchema.optional(),
    retainedProfitsBroughtForward: MonetaryAmountSchema.optional(),
    netIncomeOrLoss: MonetaryAmountSchema.optional(),
    balanceSheetProfitOrLoss: MonetaryAmountSchema.optional(),
    deficitNotCoveredByEquityOffset: MonetaryAmountSchema.optional(),
    total: MonetaryAmountSchema.optional(),
  }).optional(),

  provisions: z.object({
    pensionProvisions: MonetaryAmountSchema.optional(),
    taxProvisions: MonetaryAmountSchema.optional(),
    otherProvisions: MonetaryAmountSchema.optional(),
    total: MonetaryAmountSchema.optional(),
  }).optional(),

  liabilities: z.object({
    bankLiabilities: MonetaryAmountSchema.optional(),
    tradePayables: MonetaryAmountSchema.optional(),
    affiliatesPayables: MonetaryAmountSchema.optional(),
    otherLiabilities: MonetaryAmountSchema.optional(),
    dueWithinOneYear: MonetaryAmountSchema.optional(),
    dueAfterOneYear: MonetaryAmountSchema.optional(),
    dueAfterFiveYears: MonetaryAmountSchema.optional(),
    toShareholders: MonetaryAmountSchema.optional(),
    total: MonetaryAmountSchema.optional(),
  }).optional(),

  deferredIncome: MonetaryAmountSchema.optional(),
  deferredTaxLiabilities: MonetaryAmountSchema.optional(),

  totalEquityAndLiabilities: MonetaryAmountSchema.describe("Bilanzsumme Passiva"),
});

export const IncomeStatementSchema = z.object({
  format: z.enum(["totalCostAccounting", "costOfSalesAccounting"]).default("totalCostAccounting"),
  revenue: MonetaryAmountSchema.optional(),
  inventoryChanges: MonetaryAmountSchema.optional(),
  otherOperatingIncome: MonetaryAmountSchema.optional(),
  costOfMaterials: MonetaryAmountSchema.optional(),
  personnelExpenses: MonetaryAmountSchema.optional(),
  depreciation: MonetaryAmountSchema.optional(),
  otherOperatingExpenses: MonetaryAmountSchema.optional(),
  financialResult: MonetaryAmountSchema.optional(),
  taxesOnIncome: MonetaryAmountSchema.optional(),
  netIncomeOrLoss: MonetaryAmountSchema.optional(),
});

export const SignatorySchema = z.object({
  name: z.string(),
  role: z.string().describe("e.g. Geschäftsführer, Vorstand, Liquidator"),
  signingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  location: z.string().optional(),
  tenureNote: z.string().optional(),
});

export const NotesAndDisclosuresSchema = z.object({
  sizeClassification: z.string().optional(),
  accountingStandard: z.string().optional(),
  pnlMethod: z.string().optional(),
  averageEmployees: z.number().optional(),
  averageEmployeesPreviousPeriod: z.number().optional(),
  financialAssetsDescription: z.string().optional(),
  cryptoHoldingsPolicy: z.string().optional(),
  corporateRestructuring: z.string().optional(),
  liabilityRelationships: z.string().optional(),
  periodDetails: z.string().optional(),
  openingBalanceNote: z.string().optional(),
  operationalStatus: z.string().optional(),
  rawFilingAnomaly: z.string().optional(),
  legalFormTransitionNote: z.string().optional(),
  corporateNameChange: z.string().optional(),
  capitalStructureDetails: z.record(z.string(), z.any()).optional(),
  equityChanges: z.record(z.string(), z.any()).optional(),
  cryptoWriteDownsEur: z.record(z.string(), z.any()).optional(),
  balanceSheetOverindebtedness: z.record(z.string(), z.any()).optional(),
  commitments: z.array(z.record(z.string(), z.any())).optional(),
  participations: z.array(z.record(z.string(), z.any())).optional(),
  notesText: z.string().optional().describe("Extracted text or markdown of the 'Anhang'"),
  signatories: z.array(SignatorySchema).default([]),
});

export const UnternehmensregisterPayloadSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  sourceUrl: z.string().url().optional(),
  sourceHtmlSha256: z.string().regex(/^[a-f0-9]{64}$/).describe("BLAKE3 or SHA-256 hash of raw input HTML for content addressability").optional(),
  currency: CurrencySchema,
  metadata: CompanyMetadataSchema,
  period: DocumentPeriodSchema,
  balanceSheet: z.object({
    assets: BalanceSheetAssetsSchema,
    equityAndLiabilities: BalanceSheetEquityLiabilitiesSchema,
  }),
  incomeStatement: IncomeStatementSchema.optional(),
  notes: NotesAndDisclosuresSchema.optional(),
  rawUnparsedSections: z.record(z.string(), z.string()).optional(),
});

export type UnternehmensregisterPayload = z.infer<typeof UnternehmensregisterPayloadSchema>;
