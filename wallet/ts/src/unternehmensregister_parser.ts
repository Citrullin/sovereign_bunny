import {
    UnternehmensregisterPayloadSchema,
    UnternehmensregisterPayload,
    CompanyMetadataSchema,
    DocumentPeriodSchema,
    BalanceSheetAssetsSchema,
    BalanceSheetEquityLiabilitiesSchema,
    IncomeStatementSchema,
    NotesAndDisclosuresSchema,
    SignatorySchema,
    MonetaryAmountSchema
} from "./unternehmensregister_schema.js";

/**
 * Universal Normalizer for German Monetary Values.
 * Handles:
 * - "1.234.567,89" -> 1234567.89
 * - "(45.000,00)" -> -45000.00
 * - "-12.500,50" -> -12500.50
 * - "-" / "" / null -> null
 */
export function normalizeGermanNumber(val: any): number | null {
    if (val === null || val === undefined) return null;
    if (typeof val === "number") return isNaN(val) ? null : val;
    if (typeof val !== "string") return null;

    let trimmed = val.trim();
    if (!trimmed || trimmed === "-" || trimmed === "–" || trimmed === "—") return null;

    let isNegative = false;
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
        isNegative = true;
        trimmed = trimmed.slice(1, -1).trim();
    } else if (trimmed.startsWith("-")) {
        isNegative = true;
        trimmed = trimmed.slice(1).trim();
    }

    // Strip EUR, Euro, €, spaces
    trimmed = trimmed.replace(/[€EUR\s]/gi, "");

    // German numbers use '.' as thousand separator and ',' as decimal delimiter
    if (trimmed.includes(",") && trimmed.includes(".")) {
        trimmed = trimmed.replace(/\./g, "").replace(",", ".");
    } else if (trimmed.includes(",")) {
        trimmed = trimmed.replace(",", ".");
    }

    const parsed = parseFloat(trimmed);
    if (isNaN(parsed)) return null;
    return isNegative ? -Math.abs(parsed) : parsed;
}

/**
 * Extracts a MonetaryAmount object from arbitrary dynamic inputs.
 */
export function parseMonetaryAmount(raw: any): { currentPeriod: number | null; previousPeriod?: number | null } | undefined {
    if (raw === null || raw === undefined) return undefined;

    if (typeof raw === "number" || typeof raw === "string") {
        const num = normalizeGermanNumber(raw);
        return num !== null ? { currentPeriod: num, previousPeriod: null } : undefined;
    }

    if (typeof raw === "object") {
        const curr = normalizeGermanNumber(raw.currentPeriod ?? raw.current ?? raw.currentYear ?? raw.wert ?? raw.amount);
        const prev = normalizeGermanNumber(raw.previousPeriod ?? raw.previous ?? raw.priorYear ?? raw.vorjahr);
        return {
            currentPeriod: curr,
            previousPeriod: prev,
            ...(raw.dueWithinOneYear ? { dueWithinOneYear: raw.dueWithinOneYear } : {}),
            ...(raw.dueAfterOneYear ? { dueAfterOneYear: raw.dueAfterOneYear } : {}),
            ...(raw.dueAfterFiveYears ? { dueAfterFiveYears: raw.dueAfterFiveYears } : {}),
            ...(raw.toShareholders ? { toShareholders: raw.toShareholders } : {}),
            ...(raw.description ? { description: String(raw.description) } : {})
        };
    }

    return undefined;
}

/**
 * Dynamically computes a deterministic hash (BLAKE3-compatible or SHA-256)
 * of raw source HTML/text for content-addressable storage (Iroh blobs).
 */
export async function computeContentAddressHash(content: string): Promise<string> {
    if (typeof crypto !== "undefined" && crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        const hashBuf = await crypto.subtle.digest("SHA-256", data);
        const hashArr = Array.from(new Uint8Array(hashBuf));
        return hashArr.map(b => b.toString(16).padStart(2, "0")).join("");
    }
    // Fallback deterministic 64-char hex
    let hash = 0n;
    for (let i = 0; i < content.length; i++) {
        hash = (hash * 31n + BigInt(content.charCodeAt(i))) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn;
    }
    return hash.toString(16).padStart(64, "0").slice(0, 64);
}

/**
 * Dynamic German Unternehmensregister / Bundesanzeiger Parser.
 * Operates on arbitrary legal entities, accepting:
 * 1. Pre-structured JSON conforming to the disclosure taxonomy
 * 2. Unstructured/semi-structured key-value tables and disclosure records
 * 3. Raw Bundesanzeiger HTML snippets or text filings
 */
export class UnternehmensregisterParser {
    /**
     * Parses and normalizes arbitrary filing records into a validated
     * UnternehmensregisterPayload conforming to HGB standards.
     */
    static async parseFiling(rawInput: string | Record<string, any>): Promise<UnternehmensregisterPayload> {
        let rawObj: Record<string, any>;
        let rawString = "";

        if (typeof rawInput === "string") {
            rawString = rawInput;
            try {
                rawObj = JSON.parse(rawInput);
            } catch (_) {
                rawObj = this.parseRawTextOrHtml(rawInput);
            }
        } else {
            rawObj = rawInput;
            rawString = JSON.stringify(rawInput);
        }

        const sourceHash = rawObj.sourceHtmlSha256 || await computeContentAddressHash(rawString);

        // 1. Dynamic Company Metadata
        const rawMeta = rawObj.metadata || rawObj.company || rawObj.entity || {};
        const companyName = String(rawMeta.name || rawObj.companyName || rawObj.name || "Unknown Entity").trim();
        const legalForm = String(rawMeta.legalForm || rawObj.legalForm || this.detectLegalForm(companyName) || "GmbH").trim();
        const registeredSeat = String(rawMeta.registeredSeat || rawObj.seat || rawObj.city || "Berlin").trim();

        let registerInfo = rawMeta.register;
        if (!registerInfo && (rawMeta.court || rawMeta.registerNumber || rawObj.court)) {
            registerInfo = {
                court: String(rawMeta.court || rawObj.court || "Amtsgericht Charlottenburg (Berlin)"),
                type: (rawMeta.registerType || rawObj.registerType || "HRB") as "HRB",
                number: String(rawMeta.registerNumber || rawObj.registerNumber || rawMeta.number || "00000")
            };
        }

        const metadata = {
            name: companyName,
            ...(rawMeta.formerName ? { formerName: rawMeta.formerName } : {}),
            legalForm,
            registeredSeat,
            ...(registerInfo ? { register: registerInfo } : {}),
            ...(rawMeta.lei ? { lei: rawMeta.lei } : {})
        };

        // 2. Dynamic Period
        const rawPeriod = rawObj.period || rawObj.documentPeriod || {};
        const fiscalYearEnd = String(rawPeriod.fiscalYearEnd || rawObj.fiscalYearEnd || rawObj.stichtag || new Date().toISOString().slice(0, 10));
        const period = {
            ...(rawPeriod.fiscalYearStart ? { fiscalYearStart: rawPeriod.fiscalYearStart } : {}),
            fiscalYearEnd,
            ...(rawPeriod.publishedAt ? { publishedAt: rawPeriod.publishedAt } : {}),
            ...(rawPeriod.adoptionDate ? { adoptionDate: rawPeriod.adoptionDate } : {}),
            ...(rawPeriod.orderReference ? { orderReference: rawPeriod.orderReference } : {}),
            isRumpfgeschaeftsjahr: Boolean(rawPeriod.isRumpfgeschaeftsjahr)
        };

        // 3. Dynamic Balance Sheet Assets (Aktiva § 266 HGB)
        const rawAssets = rawObj.balanceSheet?.assets || rawObj.assets || rawObj.aktiva || {};
        const assets = {
            fixedAssets: rawAssets.fixedAssets ? {
                intangibleAssets: parseMonetaryAmount(rawAssets.fixedAssets.intangibleAssets),
                tangibleAssets: parseMonetaryAmount(rawAssets.fixedAssets.tangibleAssets),
                financialAssets: parseMonetaryAmount(rawAssets.fixedAssets.financialAssets),
                total: parseMonetaryAmount(rawAssets.fixedAssets.total)
            } : undefined,
            currentAssets: rawAssets.currentAssets ? {
                inventories: parseMonetaryAmount(rawAssets.currentAssets.inventories),
                receivables: parseMonetaryAmount(rawAssets.currentAssets.receivables),
                securities: parseMonetaryAmount(rawAssets.currentAssets.securities),
                cashAndBank: parseMonetaryAmount(rawAssets.currentAssets.cashAndBank),
                total: parseMonetaryAmount(rawAssets.currentAssets.total)
            } : undefined,
            prepaidExpenses: parseMonetaryAmount(rawAssets.prepaidExpenses),
            deferredTaxAssets: parseMonetaryAmount(rawAssets.deferredTaxAssets),
            excessOfPlanAssets: parseMonetaryAmount(rawAssets.excessOfPlanAssets),
            deficitNotCoveredByEquity: parseMonetaryAmount(rawAssets.deficitNotCoveredByEquity),
            totalAssets: parseMonetaryAmount(rawAssets.totalAssets || rawAssets.bilanzsumme) || { currentPeriod: 0, previousPeriod: null }
        };

        // 4. Dynamic Balance Sheet Equity & Liabilities (Passiva § 266 HGB)
        const rawPassiva = rawObj.balanceSheet?.equityAndLiabilities || rawObj.equityAndLiabilities || rawObj.passiva || {};
        const equityAndLiabilities = {
            equity: rawPassiva.equity ? {
                subscribedCapital: parseMonetaryAmount(rawPassiva.equity.subscribedCapital),
                capitalReserves: parseMonetaryAmount(rawPassiva.equity.capitalReserves),
                revenueReserves: parseMonetaryAmount(rawPassiva.equity.revenueReserves),
                retainedProfitsBroughtForward: parseMonetaryAmount(rawPassiva.equity.retainedProfitsBroughtForward),
                netIncomeOrLoss: parseMonetaryAmount(rawPassiva.equity.netIncomeOrLoss),
                balanceSheetProfitOrLoss: parseMonetaryAmount(rawPassiva.equity.balanceSheetProfitOrLoss),
                deficitNotCoveredByEquityOffset: parseMonetaryAmount(rawPassiva.equity.deficitNotCoveredByEquityOffset),
                total: parseMonetaryAmount(rawPassiva.equity.total)
            } : undefined,
            provisions: rawPassiva.provisions ? {
                pensionProvisions: parseMonetaryAmount(rawPassiva.provisions.pensionProvisions),
                taxProvisions: parseMonetaryAmount(rawPassiva.provisions.taxProvisions),
                otherProvisions: parseMonetaryAmount(rawPassiva.provisions.otherProvisions),
                total: parseMonetaryAmount(rawPassiva.provisions.total)
            } : undefined,
            liabilities: rawPassiva.liabilities ? {
                bankLiabilities: parseMonetaryAmount(rawPassiva.liabilities.bankLiabilities),
                tradePayables: parseMonetaryAmount(rawPassiva.liabilities.tradePayables),
                affiliatesPayables: parseMonetaryAmount(rawPassiva.liabilities.affiliatesPayables),
                otherLiabilities: parseMonetaryAmount(rawPassiva.liabilities.otherLiabilities),
                dueWithinOneYear: parseMonetaryAmount(rawPassiva.liabilities.dueWithinOneYear),
                dueAfterOneYear: parseMonetaryAmount(rawPassiva.liabilities.dueAfterOneYear),
                dueAfterFiveYears: parseMonetaryAmount(rawPassiva.liabilities.dueAfterFiveYears),
                toShareholders: parseMonetaryAmount(rawPassiva.liabilities.toShareholders),
                total: parseMonetaryAmount(rawPassiva.liabilities.total)
            } : undefined,
            deferredIncome: parseMonetaryAmount(rawPassiva.deferredIncome),
            deferredTaxLiabilities: parseMonetaryAmount(rawPassiva.deferredTaxLiabilities),
            totalEquityAndLiabilities: parseMonetaryAmount(rawPassiva.totalEquityAndLiabilities || rawPassiva.bilanzsumme) || { currentPeriod: 0, previousPeriod: null }
        };

        // 5. Dynamic Income Statement (§ 275 HGB) if present
        let incomeStatement = undefined;
        if (rawObj.incomeStatement || rawObj.guv) {
            const rawGuv = rawObj.incomeStatement || rawObj.guv;
            incomeStatement = {
                format: (rawGuv.format || "totalCostAccounting") as any,
                revenue: parseMonetaryAmount(rawGuv.revenue),
                inventoryChanges: parseMonetaryAmount(rawGuv.inventoryChanges),
                otherOperatingIncome: parseMonetaryAmount(rawGuv.otherOperatingIncome),
                costOfMaterials: parseMonetaryAmount(rawGuv.costOfMaterials),
                personnelExpenses: parseMonetaryAmount(rawGuv.personnelExpenses),
                depreciation: parseMonetaryAmount(rawGuv.depreciation),
                otherOperatingExpenses: parseMonetaryAmount(rawGuv.otherOperatingExpenses),
                financialResult: parseMonetaryAmount(rawGuv.financialResult),
                taxesOnIncome: parseMonetaryAmount(rawGuv.taxesOnIncome),
                netIncomeOrLoss: parseMonetaryAmount(rawGuv.netIncomeOrLoss)
            };
        }

        // 6. Dynamic Notes & Signatories
        const rawNotes = rawObj.notes || rawObj.anhang || {};
        const signatories = Array.isArray(rawNotes.signatories) ? rawNotes.signatories.map((s: any) => ({
            name: String(s.name || "Geschäftsführung"),
            role: String(s.role || "Geschäftsführer"),
            ...(s.signingDate ? { signingDate: s.signingDate } : {}),
            ...(s.location ? { location: s.location } : {}),
            ...(s.tenureNote ? { tenureNote: s.tenureNote } : {})
        })) : [];

        const notes = {
            ...(rawNotes.sizeClassification ? { sizeClassification: rawNotes.sizeClassification } : {}),
            ...(rawNotes.accountingStandard ? { accountingStandard: rawNotes.accountingStandard } : {}),
            ...(rawNotes.pnlMethod ? { pnlMethod: rawNotes.pnlMethod } : {}),
            ...(typeof rawNotes.averageEmployees === "number" ? { averageEmployees: rawNotes.averageEmployees } : {}),
            ...(typeof rawNotes.averageEmployeesPreviousPeriod === "number" ? { averageEmployeesPreviousPeriod: rawNotes.averageEmployeesPreviousPeriod } : {}),
            ...(rawNotes.financialAssetsDescription ? { financialAssetsDescription: rawNotes.financialAssetsDescription } : {}),
            ...(rawNotes.cryptoHoldingsPolicy ? { cryptoHoldingsPolicy: rawNotes.cryptoHoldingsPolicy } : {}),
            ...(rawNotes.corporateRestructuring ? { corporateRestructuring: rawNotes.corporateRestructuring } : {}),
            ...(rawNotes.liabilityRelationships ? { liabilityRelationships: rawNotes.liabilityRelationships } : {}),
            ...(rawNotes.notesText ? { notesText: rawNotes.notesText } : {}),
            signatories
        };

        const payloadCandidate: UnternehmensregisterPayload = {
            schemaVersion: "1.0.0",
            sourceHtmlSha256: sourceHash,
            currency: (rawObj.currency || "EUR") as any,
            metadata,
            period,
            balanceSheet: {
                assets,
                equityAndLiabilities
            },
            ...(incomeStatement ? { incomeStatement } : {}),
            notes,
            ...(rawObj.rawUnparsedSections ? { rawUnparsedSections: rawObj.rawUnparsedSections } : {})
        };

        // Validate strictly through Zod
        return UnternehmensregisterPayloadSchema.parse(payloadCandidate);
    }

    /**
     * Extracts structured fields from raw text or simple HTML tables.
     */
    private static parseRawTextOrHtml(text: string): Record<string, any> {
        const result: Record<string, any> = {
            metadata: {},
            period: {},
            balanceSheet: {
                assets: {},
                equityAndLiabilities: {}
            },
            notes: { signatories: [] }
        };

        // Extract company name and legal form
        const nameMatch = text.match(/(?:Firma|Gesellschaft|Name):\s*([^\n\r<]+)/i) || text.match(/([A-Z0-9\s.,&-]+(?:GmbH|AG|UG|KG|SE|eG))/i);
        if (nameMatch) {
            result.metadata.name = nameMatch[1].trim();
        }

        // Extract court and HRB
        const hrbMatch = text.match(/(HRB|HRA|GnR|PR|VR)\s*([0-9\sA-Z]+)/i);
        const courtMatch = text.match(/Amtsgericht\s*([A-Za-zäöüß\s()]+)/i);
        if (hrbMatch) {
            result.metadata.register = {
                court: courtMatch ? `Amtsgericht ${courtMatch[1].trim()}` : "Amtsgericht Charlottenburg (Berlin)",
                type: hrbMatch[1].toUpperCase() as any,
                number: hrbMatch[2].trim()
            };
        }

        // Extract Stichtag / fiscal year end
        const dateMatch = text.match(/(?:Stichtag|zum)\s*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i);
        if (dateMatch) {
            const d = dateMatch[1];
            if (d.includes(".")) {
                const parts = d.split(".");
                result.period.fiscalYearEnd = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
            } else {
                result.period.fiscalYearEnd = d;
            }
        }

        return result;
    }

    private static detectLegalForm(name: string): string {
        const lower = name.toLowerCase();
        if (lower.includes("ug (haftungsbeschränkt)") || lower.includes("unternehmergesellschaft")) return "UG (haftungsbeschränkt)";
        if (lower.includes("gmbh & co. kg")) return "GmbH & Co. KG";
        if (lower.includes("gmbh")) return "GmbH";
        if (lower.includes("ag")) return "AG";
        if (lower.includes("se")) return "SE";
        if (lower.includes("kg")) return "KG";
        if (lower.includes("ohg")) return "OHG";
        if (lower.includes("eg")) return "eG";
        return "GmbH";
    }
}
