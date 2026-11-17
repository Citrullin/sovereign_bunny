import { describe, it } from 'node:test';
import assert from 'node:assert';
import { UnternehmensregisterParser, normalizeGermanNumber } from '../../src/unternehmensregister_parser.js';

describe('Unternehmensregister Dynamic Parser & HGB Schema Unit Tests', () => {
    it('normalizes arbitrary German number notations', () => {
        assert.strictEqual(normalizeGermanNumber('1.234.567,89'), 1234567.89);
        assert.strictEqual(normalizeGermanNumber('(50.000,00)'), -50000.00);
        assert.strictEqual(normalizeGermanNumber('-12.500,50 €'), -12500.50);
        assert.strictEqual(normalizeGermanNumber('-'), null);
        assert.strictEqual(normalizeGermanNumber(''), null);
        assert.strictEqual(normalizeGermanNumber(42.5), 42.5);
    });

    it('dynamically parses and validates arbitrary entity disclosures without hardcoding', async () => {
        const dynamicFiling = {
            metadata: {
                name: "Nova Decentralized Robotics GmbH",
                legalForm: "GmbH",
                registeredSeat: "München",
                register: {
                    court: "Amtsgericht München",
                    type: "HRB",
                    number: "987654"
                }
            },
            period: {
                fiscalYearStart: "2024-01-01",
                fiscalYearEnd: "2024-12-31",
                publishedAt: "2025-06-15",
                isRumpfgeschaeftsjahr: false
            },
            currency: "EUR",
            balanceSheet: {
                assets: {
                    fixedAssets: {
                        intangibleAssets: { currentPeriod: 150000, previousPeriod: 120000 },
                        tangibleAssets: { currentPeriod: 450000, previousPeriod: 400000 },
                        financialAssets: { currentPeriod: 200000, previousPeriod: 180000 },
                        total: { currentPeriod: 800000, previousPeriod: 700000 }
                    },
                    currentAssets: {
                        inventories: { currentPeriod: 50000, previousPeriod: 40000 },
                        receivables: { currentPeriod: 320000, previousPeriod: 280000 },
                        cashAndBank: { currentPeriod: 480000, previousPeriod: 350000 },
                        total: { currentPeriod: 850000, previousPeriod: 670000 }
                    },
                    totalAssets: { currentPeriod: 1650000, previousPeriod: 1370000 }
                },
                equityAndLiabilities: {
                    equity: {
                        subscribedCapital: { currentPeriod: 100000, previousPeriod: 100000 },
                        capitalReserves: { currentPeriod: 500000, previousPeriod: 500000 },
                        balanceSheetProfitOrLoss: { currentPeriod: 350000, previousPeriod: 200000 },
                        total: { currentPeriod: 950000, previousPeriod: 800000 }
                    },
                    provisions: {
                        taxProvisions: { currentPeriod: 100000, previousPeriod: 70000 },
                        otherProvisions: { currentPeriod: 150000, previousPeriod: 100000 },
                        total: { currentPeriod: 250000, previousPeriod: 170000 }
                    },
                    liabilities: {
                        tradePayables: { currentPeriod: 150000, previousPeriod: 100000 },
                        otherLiabilities: { currentPeriod: 300000, previousPeriod: 300000 },
                        dueWithinOneYear: { currentPeriod: 450000, previousPeriod: 400000 },
                        total: { currentPeriod: 450000, previousPeriod: 400000 }
                    },
                    totalEquityAndLiabilities: { currentPeriod: 1650000, previousPeriod: 1370000 }
                }
            },
            notes: {
                sizeClassification: "Kleine Kapitalgesellschaft (§ 267 Abs. 1 HGB)",
                averageEmployees: 18,
                signatories: [
                    { name: "Dr. Elena Rostova", role: "Geschäftsführerin", signingDate: "2025-05-30" }
                ]
            }
        };

        const parsed = await UnternehmensregisterParser.parseFiling(dynamicFiling);
        assert.strictEqual(parsed.schemaVersion, "1.0.0");
        assert.strictEqual(parsed.metadata.name, "Nova Decentralized Robotics GmbH");
        assert.strictEqual(parsed.metadata.register?.court, "Amtsgericht München");
        assert.strictEqual(parsed.balanceSheet.assets.totalAssets.currentPeriod, 1650000);
        assert.strictEqual(parsed.balanceSheet.equityAndLiabilities.totalEquityAndLiabilities.currentPeriod, 1650000);
        assert(parsed.sourceHtmlSha256 && parsed.sourceHtmlSha256.length === 64, "Deterministic content address hash must be 64-char hex");
        assert.strictEqual(parsed.notes?.signatories[0].name, "Dr. Elena Rostova");
    });
});
