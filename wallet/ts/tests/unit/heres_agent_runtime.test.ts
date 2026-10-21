// Unit Tests for Heres: Autonomous AI Agent Swarm & Intent-Based System (IBS)
// Tests multi-actor declarative Lattice Saga protocol, Slot 7 locks, and compensation rollback.

import assert from 'node:assert';
import { ethers } from 'ethers';
import { VirtualCarBuffer } from '../../src/car_reconciler.js';
import {
    HeresAgent,
    IbsIntent,
    SLOT_SAGA_LOCK,
} from '../../src/heres_agent_runtime.js';
import { DaoTypeTag, DaoPluginRegistry } from '../../src/dao_plugin_system.js';

async function runTests() {
    console.log('--- Starting heres_agent_runtime.test.ts ---');

    const agent = new HeresAgent(
        'did:sov:heres:agent:alpha_01',
        'Heres Settlement Dispatcher',
        ['AUTONOMOUS_SAGA_EXECUTION', 'MULTI_HOP_NETTING', 'PATRONAGE_DISTRIBUTION']
    );

    const companyA = '0x1111111111111111111111111111111111111111';
    const supplierB = '0x2222222222222222222222222222222222222222';
    const coopC = '0x3333333333333333333333333333333333333333';

    // Test 1: Successful Multi-Actor Autonomous Saga Execution
    {
        console.log('Test 1: Successful multi-actor autonomous saga execution');
        const accounts = new Map<string, VirtualCarBuffer>();
        const bufA = new VirtualCarBuffer();
        const bufB = new VirtualCarBuffer();
        const bufC = new VirtualCarBuffer();

        // Initialize Slot 1 (Zanzibar ReBAC) on all participants
        bufA.setSlot(1, ethers.getBytes(ethers.id('rebac_companyA')));
        bufB.setSlot(1, ethers.getBytes(ethers.id('rebac_supplierB')));
        bufC.setSlot(1, ethers.getBytes(ethers.id('rebac_coopC')));

        accounts.set(companyA.toLowerCase(), bufA);
        accounts.set(supplierB.toLowerCase(), bufB);
        accounts.set(coopC.toLowerCase(), bufC);

        const intent: IbsIntent = {
            intentId: ethers.id('INTENT-B2B-INVOICE-8812'),
            initiatorDid: 'did:sov:companyA:treasury',
            description: 'Settle B2B invoice #8812 with supplier netting and coop dividend',
            targetAccounts: [companyA, supplierB, coopC],
            preconditions: [
                {
                    account: companyA,
                    slotId: 1,
                    predicateType: 'ZanzibarRelationActive',
                    expectedValue: ethers.ZeroHash,
                },
                {
                    account: supplierB,
                    slotId: SLOT_SAGA_LOCK,
                    predicateType: 'SlotUnlocked',
                    expectedValue: ethers.ZeroHash,
                },
            ],
            mutations: [
                // 1. Supplier B receives B2B confidential netting note in Slot 2
                {
                    account: supplierB,
                    slotId: 2,
                    newCommitment: ethers.ZeroHash,
                    typeTag: DaoTypeTag.SUPPLY_CONSORTIUM,
                    shieldedPayload: {
                        invoiceId: 'INV-8812',
                        nettingCycleId: 'NET-BERLIN-01',
                        grossAmountEur: 150000,
                        settledAmountEur: 145000,
                        bolHash: ethers.id('BOL-TRUCK-88'),
                        timestamp: Date.now(),
                    },
                },
                // 2. Company A anchors SQL invoice payment row to Slot 4
                {
                    account: companyA,
                    slotId: 4,
                    newCommitment: ethers.id('SQL_INVOICE_8812_SETTLED'),
                },
                // 3. Coop C receives shielded patronage distribution in Slot 2
                {
                    account: coopC,
                    slotId: 2,
                    newCommitment: ethers.ZeroHash,
                    typeTag: DaoTypeTag.EG_COOP,
                    shieldedPayload: {
                        memberDid: 'did:sov:gnr:member:99',
                        patronageRefundEur: 5000,
                        businessTurnoverEur: 150000,
                        fiscalPeriod: '2024-Q4',
                        auditVerificationHash: ethers.id('DGRV_Audit_2024'),
                    },
                },
            ],
            compensations: [
                {
                    account: companyA,
                    slotId: 4,
                    newCommitment: ethers.ZeroHash,
                },
                {
                    account: supplierB,
                    slotId: 2,
                    newCommitment: ethers.ZeroHash,
                },
                {
                    account: coopC,
                    slotId: 2,
                    newCommitment: ethers.ZeroHash,
                },
            ],
            timeoutEpoch: 200n,
            zkProofRequired: true,
        };

        const result = await agent.executeSaga(intent, accounts, 100n);
        assert.strictEqual(result.status, 'Committed');
        assert.strictEqual(result.modifiedSlots.length, 3);
        assert.strictEqual(result.emittedShieldedNotesCount, 2);
        assert.ok(result.noirProofHex && result.noirProofHex.startsWith('0xaaaa'));

        // Verify Slot 7 locks were cleared after commit
        for (const acc of [companyA, supplierB, coopC]) {
            const lockSlot = accounts.get(acc.toLowerCase())!.getSlot(SLOT_SAGA_LOCK);
            assert.ok(lockSlot.every(b => b === 0), `Slot 7 lock on ${acc} must be cleared`);
        }

        // Verify Slot 2 shielded notes can be cleanly unwrapped by the recipient
        const supplierNoteComm = accounts.get(supplierB.toLowerCase())!.getSlot(2);
        assert.ok(supplierNoteComm.some(b => b !== 0));

        console.log('✓ Multi-actor autonomous saga execution passed');
    }

    // Test 2: Contended Slot 7 Lock Rejection
    {
        console.log('Test 2: Contended Slot 7 lock rejection');
        const accounts = new Map<string, VirtualCarBuffer>();
        const bufA = new VirtualCarBuffer();
        const bufB = new VirtualCarBuffer();

        // Simulate that company A is already locked by another active saga
        bufA.setSlot(SLOT_SAGA_LOCK, ethers.getBytes(ethers.id('PREVIOUS_ACTIVE_SAGA_LOCK')));
        accounts.set(companyA.toLowerCase(), bufA);
        accounts.set(supplierB.toLowerCase(), bufB);

        const intent: IbsIntent = {
            intentId: ethers.id('INTENT-CONTENDED'),
            initiatorDid: 'did:sov:companyA:treasury',
            description: 'Contended intent',
            targetAccounts: [companyA, supplierB],
            preconditions: [
                {
                    account: companyA,
                    slotId: SLOT_SAGA_LOCK,
                    predicateType: 'SlotUnlocked',
                    expectedValue: ethers.ZeroHash,
                },
            ],
            mutations: [],
            compensations: [],
            timeoutEpoch: 200n,
        };

        const result = await agent.executeSaga(intent, accounts, 100n);
        assert.strictEqual(result.status, 'PreconditionFailed');
        assert.ok(result.errorMessage && result.errorMessage.includes('locked by another saga'));
        console.log('✓ Contended Slot 7 lock rejection passed');
    }

    // Test 3: Epoch Timeout and Compensation Rollback
    {
        console.log('Test 3: Epoch timeout and compensation rollback');
        const accounts = new Map<string, VirtualCarBuffer>();
        const bufA = new VirtualCarBuffer();
        bufA.setSlot(4, ethers.getBytes(ethers.id('ORIGINAL_SQL_STATE')));
        accounts.set(companyA.toLowerCase(), bufA);

        const intent: IbsIntent = {
            intentId: ethers.id('INTENT-EXPIRED'),
            initiatorDid: 'did:sov:companyA',
            description: 'Expired intent',
            targetAccounts: [companyA],
            preconditions: [],
            mutations: [
                {
                    account: companyA,
                    slotId: 4,
                    newCommitment: ethers.id('SPECULATIVE_SQL_MUTATION'),
                },
            ],
            compensations: [
                {
                    account: companyA,
                    slotId: 4,
                    newCommitment: ethers.id('ORIGINAL_SQL_STATE'),
                },
            ],
            timeoutEpoch: 150n,
        };

        // Execution attempted after timeout (epoch 160 > timeout 150)
        const result = await agent.executeSaga(intent, accounts, 160n);
        assert.strictEqual(result.status, 'Timeout');
        assert.ok(result.errorMessage && result.errorMessage.includes('timed out before staging'));
        console.log('✓ Epoch timeout and compensation rollback passed');
    }

    console.log('=== All Heres Agent Runtime Tests Passed Successfully ===');
}

runTests().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
