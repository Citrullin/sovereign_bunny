// Unit Tests for Polymorphic DAO Plugin System & Private Type Identification
// Covers GmbH (HRB), eG Cooperative (GnR), e.V. Association (VR),
// Supply Chain Consortium, and Mutual Credit Bank (CBMT).

import assert from 'node:assert';
import { ethers } from 'ethers';
import {
    DaoPluginRegistry,
    DaoTypeTag,
    ShieldedTypeExtractor,
    SHIELDED_NOTE_MAGIC,
    GmbhCorporatePlugin,
    GenossenschaftCooperativePlugin,
    VereinAssociationPlugin,
    SupplyChainConsortiumPlugin,
    MutualCreditBankPlugin,
    GmbhShieldedDividendNote,
    CoopShieldedPatronageNote,
    VereinShieldedMeritNote,
    SupplyChainShieldedNote,
    MutualBankShieldedNote,
} from '../../src/dao_plugin_system.js';
import { VirtualCarBuffer } from '../../src/car_reconciler.js';
import { CarTreeInspector } from '../../src/car_inspector.js';
import { UnternehmensregisterPayload } from '../../src/unternehmensregister_schema.js';

async function runTests() {
    console.log('--- Starting dao_plugin_system.test.ts ---');

    // Test 1: Canonical Plugins Registration & Type Tags
    {
        console.log('Test 1: Canonical plugins registration & type tags');
        const allPlugins = DaoPluginRegistry.getAll();
        assert.strictEqual(allPlugins.length, 5);

        const gmbhPlugin = DaoPluginRegistry.get(DaoTypeTag.GMBH_CORP);
        assert.ok(gmbhPlugin);
        assert.strictEqual(gmbhPlugin.typeTag, DaoTypeTag.GMBH_CORP);
        assert.strictEqual(gmbhPlugin.registerType, 'HRB');

        const coopPlugin = DaoPluginRegistry.get(DaoTypeTag.EG_COOP);
        assert.ok(coopPlugin);
        assert.strictEqual(coopPlugin.typeTag, DaoTypeTag.EG_COOP);
        assert.strictEqual(coopPlugin.registerType, 'GnR');

        const vereinPlugin = DaoPluginRegistry.get(DaoTypeTag.EV_ASSOC);
        assert.ok(vereinPlugin);
        assert.strictEqual(vereinPlugin.typeTag, DaoTypeTag.EV_ASSOC);
        assert.strictEqual(vereinPlugin.registerType, 'VR');

        const supplyPlugin = DaoPluginRegistry.get(DaoTypeTag.SUPPLY_CONSORTIUM);
        assert.ok(supplyPlugin);

        const bankPlugin = DaoPluginRegistry.get(DaoTypeTag.MUTUAL_CREDIT_BANK);
        assert.ok(bankPlugin);
        console.log('✓ Canonical plugins registration passed');
    }

    // Test 2: Dynamic Ingestion from Unternehmensregister (GmbH HRB)
    {
        console.log('Test 2: Dynamic ingestion from Unternehmensregister (GmbH HRB)');
        const gmbhFiling: UnternehmensregisterPayload = {
            schemaVersion: '1.0.0',
            currency: 'EUR',
            metadata: {
                name: 'Hyperion Quantum Robotics GmbH',
                legalForm: 'GmbH',
                registeredSeat: 'Stuttgart',
                register: {
                    court: 'Amtsgericht Stuttgart',
                    type: 'HRB',
                    number: '765432',
                },
            },
            period: {
                fiscalYearEnd: '2024-12-31',
            },
            balanceSheet: {
                assets: {
                    totalAssets: { currentPeriod: 5200000 },
                },
                equityAndLiabilities: {
                    equity: {
                        subscribedCapital: { currentPeriod: 100000 },
                        netIncomeOrLoss: { currentPeriod: 850000 },
                    },
                    totalEquityAndLiabilities: { currentPeriod: 5200000 },
                },
            },
            notes: {
                signatories: [
                    { name: 'Dr. Klaus Vormann', role: 'Geschäftsführer' },
                    { name: 'Maria Lindner', role: 'Geschäftsführerin' },
                ],
            },
        };

        const resolvedPlugin = DaoPluginRegistry.resolveFromUnternehmensregister(gmbhFiling);
        assert.strictEqual(resolvedPlugin.typeTag, DaoTypeTag.GMBH_CORP);

        const state = (resolvedPlugin as GmbhCorporatePlugin).fromUnternehmensregister(gmbhFiling);
        assert.strictEqual(state.companyName, 'Hyperion Quantum Robotics GmbH');
        assert.strictEqual(state.subscribedCapitalEur, 100000);
        assert.strictEqual(state.balanceSheetTotalEur, 5200000);
        assert.strictEqual(state.geschaeftsfuehrer.length, 2);

        // Encode into 64-slot CAR buffer
        const slots = resolvedPlugin.encodeSlots(state);
        const buffer = new VirtualCarBuffer();
        for (const [slotId, bytes] of slots.entries()) {
            buffer.setSlot(slotId, bytes);
        }

        // Verify slot commitments
        const inspectedSlot1 = CarTreeInspector.inspectSlot(buffer, 1, resolvedPlugin, state);
        assert.ok(inspectedSlot1.decodedSummary.includes('Klaus Vormann'));
        assert.strictEqual(inspectedSlot1.typeName, 'GmbH Corporate DAO (HRB)');

        const inspectedSlot4 = CarTreeInspector.inspectSlot(buffer, 4, resolvedPlugin, state);
        assert.ok(inspectedSlot4.decodedSummary.includes('5,200,000'));
        console.log('✓ Dynamic GmbH ingestion and slot mounting passed');
    }

    // Test 3: eG Cooperative Statutory Democratic Invariant (One-Member-One-Vote)
    {
        console.log('Test 3: eG Cooperative Statutory Democratic Invariant (One-Member-One-Vote)');
        const coopFiling: UnternehmensregisterPayload = {
            schemaVersion: '1.0.0',
            currency: 'EUR',
            metadata: {
                name: 'Solarstrom Bürgergenossenschaft eG',
                legalForm: 'eG',
                registeredSeat: 'Freiburg',
                register: {
                    court: 'Amtsgericht Freiburg',
                    type: 'GnR',
                    number: '12345',
                },
            },
            period: {
                fiscalYearEnd: '2024-12-31',
            },
            balanceSheet: {
                assets: {
                    totalAssets: { currentPeriod: 1200000 },
                },
                equityAndLiabilities: {
                    totalEquityAndLiabilities: { currentPeriod: 1200000 },
                },
            },
            notes: {
                averageEmployees: 10,
                signatories: [
                    { name: 'Hans Meier', role: 'Vorstand' },
                ],
            },
        };

        const resolvedPlugin = DaoPluginRegistry.resolveFromUnternehmensregister(coopFiling);
        assert.strictEqual(resolvedPlugin.typeTag, DaoTypeTag.EG_COOP);

        const state = (resolvedPlugin as GenossenschaftCooperativePlugin).fromUnternehmensregister(coopFiling);
        assert.strictEqual(state.totalMembers, 50); // 10 * 5
        assert.strictEqual(state.members[0].hasVoice, true);

        // Verify slot 6 governance matrix encodes GenG § 43 democratic equality
        const slots = resolvedPlugin.encodeSlots(state);
        const buffer = new VirtualCarBuffer();
        for (const [slotId, bytes] of slots.entries()) {
            buffer.setSlot(slotId, bytes);
        }

        const inspectedSlot6 = CarTreeInspector.inspectSlot(buffer, 6, resolvedPlugin, state);
        assert.ok(inspectedSlot6.decodedSummary.includes('Democratic 1-Member-1-Vote'));
        console.log('✓ eG Cooperative democratic equality passed');
    }

    // Test 4: Private Type Identification via Blind Notes (Slot 2)
    {
        console.log('Test 4: Private type identification & zero-knowledge confidentiality');

        // Case A: Confidential GmbH Dividend Note
        const gmbhDividend: GmbhShieldedDividendNote = {
            recipientShareholder: '0x1111111111111111111111111111111111111111',
            dividendEur: 45000,
            fiscalYear: '2024',
            resolutionHash: ethers.id('Resolution_2024_01'),
            epoch: 120,
        };
        const gmbhPlugin = DaoPluginRegistry.get<GmbhCorporatePlugin>(DaoTypeTag.GMBH_CORP)!;
        const gmbhPayloadBytes = gmbhPlugin.encodeShieldedPayload(gmbhDividend);
        const gmbhShieldedEnvelope = ShieldedTypeExtractor.wrap(DaoTypeTag.GMBH_CORP, gmbhPayloadBytes);

        // External Observer Check:
        // The ledger only sees the Poseidon/Keccak hash of this envelope. The plaintext type is NOT visible on-chain.
        const publicCommitment = ethers.keccak256(gmbhShieldedEnvelope);
        assert.strictEqual(publicCommitment.length, 66);

        // Recipient Decryption & Dynamic Polymorphic Unwrap:
        const unwrappedGmbh = DaoPluginRegistry.unwrapDecryptedNote(gmbhShieldedEnvelope);
        assert.strictEqual(unwrappedGmbh.typeTag, DaoTypeTag.GMBH_CORP);
        assert.strictEqual(unwrappedGmbh.plugin.typeName, 'GmbH Corporate DAO (HRB)');
        const restoredDividend = unwrappedGmbh.payload as GmbhShieldedDividendNote;
        assert.strictEqual(restoredDividend.dividendEur, 45000);
        assert.strictEqual(restoredDividend.fiscalYear, '2024');

        // Case B: Confidential eG Cooperative Patronage Refund Note
        const coopPatronage: CoopShieldedPatronageNote = {
            memberDid: 'did:sov:gnr:member:42',
            patronageRefundEur: 3200,
            businessTurnoverEur: 64000,
            fiscalPeriod: '2024-Q4',
            auditVerificationHash: ethers.id('DGRV_Audit_Report_2024'),
        };
        const coopPlugin = DaoPluginRegistry.get<GenossenschaftCooperativePlugin>(DaoTypeTag.EG_COOP)!;
        const coopPayloadBytes = coopPlugin.encodeShieldedPayload(coopPatronage);
        const coopShieldedEnvelope = ShieldedTypeExtractor.wrap(DaoTypeTag.EG_COOP, coopPayloadBytes);

        const unwrappedCoop = DaoPluginRegistry.unwrapDecryptedNote(coopShieldedEnvelope);
        assert.strictEqual(unwrappedCoop.typeTag, DaoTypeTag.EG_COOP);
        assert.strictEqual(unwrappedCoop.plugin.typeName, 'eG Cooperative DAO (GnR)');
        const restoredPatronage = unwrappedCoop.payload as CoopShieldedPatronageNote;
        assert.strictEqual(restoredPatronage.patronageRefundEur, 3200);

        // Case C: Confidential e.V. Association Busy Bee Merit Note
        const vereinMerit: VereinShieldedMeritNote = {
            recipientMemberDid: 'did:sov:vr:hacker:07',
            meritPoints: 250,
            contributionHash: ethers.id('PR_Lattice_6LoWPAN_Offload'),
            epoch: 125,
            attestationSignature: '0x' + 'ab'.repeat(65),
        };
        const vereinPlugin = DaoPluginRegistry.get<VereinAssociationPlugin>(DaoTypeTag.EV_ASSOC)!;
        const vereinShieldedEnvelope = ShieldedTypeExtractor.wrap(
            DaoTypeTag.EV_ASSOC,
            vereinPlugin.encodeShieldedPayload(vereinMerit)
        );

        const unwrappedVerein = DaoPluginRegistry.unwrapDecryptedNote(vereinShieldedEnvelope);
        assert.strictEqual(unwrappedVerein.typeTag, DaoTypeTag.EV_ASSOC);
        const restoredMerit = unwrappedVerein.payload as VereinShieldedMeritNote;
        assert.strictEqual(restoredMerit.meritPoints, 250);

        // Case D: Confidential Supply-Chain Consortium Netting Note
        const supplyNote: SupplyChainShieldedNote = {
            invoiceId: 'INV-2024-0099',
            nettingCycleId: 'CYCLE-BERLIN-88',
            grossAmountEur: 1200000,
            settledAmountEur: 1150000,
            bolHash: ethers.id('BillOfLading_Container_44'),
            timestamp: Date.now(),
        };
        const supplyPlugin = DaoPluginRegistry.get<SupplyChainConsortiumPlugin>(DaoTypeTag.SUPPLY_CONSORTIUM)!;
        const supplyShieldedEnvelope = ShieldedTypeExtractor.wrap(
            DaoTypeTag.SUPPLY_CONSORTIUM,
            supplyPlugin.encodeShieldedPayload(supplyNote)
        );

        const unwrappedSupply = DaoPluginRegistry.unwrapDecryptedNote(supplyShieldedEnvelope);
        assert.strictEqual(unwrappedSupply.typeTag, DaoTypeTag.SUPPLY_CONSORTIUM);
        const restoredSupply = unwrappedSupply.payload as SupplyChainShieldedNote;
        assert.strictEqual(restoredSupply.grossAmountEur, 1200000);

        // Case E: Confidential Mutual Credit Bank CBMT Liquidity Note
        const bankNote: MutualBankShieldedNote = {
            cbmtAmountEur: 5000000,
            sourceBic: 'GENODEF1FRE',
            targetBic: 'WELADED1BER',
            interbankPaymentRef: 'REF-TARGET2-20241021-99',
            pontesSettlementHash: ethers.id('Pontes_DvP_Batch_88'),
        };
        const bankPlugin = DaoPluginRegistry.get<MutualCreditBankPlugin>(DaoTypeTag.MUTUAL_CREDIT_BANK)!;
        const bankShieldedEnvelope = ShieldedTypeExtractor.wrap(
            DaoTypeTag.MUTUAL_CREDIT_BANK,
            bankPlugin.encodeShieldedPayload(bankNote)
        );

        const unwrappedBank = DaoPluginRegistry.unwrapDecryptedNote(bankShieldedEnvelope);
        assert.strictEqual(unwrappedBank.typeTag, DaoTypeTag.MUTUAL_CREDIT_BANK);
        const restoredBank = unwrappedBank.payload as MutualBankShieldedNote;
        assert.strictEqual(restoredBank.cbmtAmountEur, 5000000);

        console.log('✓ Private type identification across all 5 DAO archetypes passed');
    }

    // Test 5: Negative Security Invariants (Invalid MAGIC, Truncation, Unregistered Types)
    {
        console.log('Test 5: Negative security invariants');

        // Invalid MAGIC header
        const invalidMagic = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x7b, 0x7d]);
        assert.throws(() => {
            ShieldedTypeExtractor.unwrap(invalidMagic);
        }, /expected SHLD/);

        // Truncated payload
        const truncated = new Uint8Array([0x53, 0x48, 0x4C, 0x44, 0x00, 0x01, 0x00, 0x00, 0x00, 0x50, 0x01]);
        assert.throws(() => {
            ShieldedTypeExtractor.unwrap(truncated);
        }, /payload truncated/);

        // Unregistered type tag (0x9999)
        const unknownTypeEnvelope = ShieldedTypeExtractor.wrap(
            0x9999 as DaoTypeTag,
            ethers.toUtf8Bytes('{"data": 123}')
        );
        assert.throws(() => {
            DaoPluginRegistry.unwrapDecryptedNote(unknownTypeEnvelope);
        }, /No registered DAO plugin found/);

        console.log('✓ Negative security invariants passed');
    }

    console.log('=== All DAO Plugin System Tests Passed Successfully ===');
}

runTests().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
