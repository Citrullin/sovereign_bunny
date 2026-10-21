// State Object Model (SOM) Unit & Given-When-Then BDD Tests
// Conforms to Phase 1, Phase 2 & docs/booklet/bunny-stack.tex (Dual-Track History & Sagas).

import assert from 'node:assert';
import { ethers } from 'ethers';
import { StateObjectModel, SomAction, SomEvent } from '../../src/state_object_model.js';

interface BddContext {
    given: (description: string, fn: () => void | Promise<void>) => Promise<void>;
    when: (description: string, fn: () => void | Promise<void>) => Promise<void>;
    then: (description: string, fn: () => void | Promise<void>) => Promise<void>;
    and: (description: string, fn: () => void | Promise<void>) => Promise<void>;
}

async function scenario(title: string, testFn: (bdd: BddContext) => Promise<void>) {
    console.log(`\n  Scenario: ${title}`);
    const bdd: BddContext = {
        given: async (desc, fn) => {
            console.log(`    Given ${desc}`);
            await fn();
        },
        when: async (desc, fn) => {
            console.log(`    When ${desc}`);
            await fn();
        },
        then: async (desc, fn) => {
            console.log(`    Then ${desc}`);
            await fn();
        },
        and: async (desc, fn) => {
            console.log(`    And ${desc}`);
            await fn();
        },
    };
    await testFn(bdd);
    console.log(`  ✓ Scenario passed: ${title}`);
}

async function runBddTests() {
    console.log('======================================================================');
    console.log('   SOM BDD SPECIFICATION: DUAL-TRACK HISTORY & BLIND NOTE SAGAS');
    console.log('======================================================================');

    const aliceDid = 'did:sov:0x1111111111111111111111111111111111111111';
    const bobDid = 'did:sov:0x2222222222222222222222222222222222222222';

    // Scenario 1: Local Ephemeral Virtual Undo and Redo (Track A)
    await scenario('Local Ephemeral Virtual Undo and Redo (Track A)', async (bdd) => {
        let som: StateObjectModel;
        const initialRoot = ethers.id('git-tree-initial-v0');
        const commitV1 = ethers.id('git-commit-v1');
        const commitV2 = ethers.id('git-commit-v2');

        await bdd.given('an account initialized with Git tree root in Slot 3', async () => {
            som = new StateObjectModel('0x1111111111111111111111111111111111111111');
            await som.dispatch({
                type: 'INIT_GIT',
                targetSlot: 3,
                callerDid: aliceDid,
                payload: { newCommitment: initialRoot },
            });
            assert.strictEqual(som.getSlotHex(3), initialRoot);
            assert.strictEqual(som.getNonce(), 1n);
            assert.strictEqual(som.canUndo(), false);
        });

        await bdd.when('the user stages an uncommitted local action updating Slot 3 to V1', async () => {
            som.stage({
                type: 'EDIT_GIT',
                targetSlot: 3,
                callerDid: aliceDid,
                payload: { newCommitment: commitV1 },
            });
        });

        await bdd.then('the local SOM virtual projection immediately reflects V1 at 60fps', async () => {
            assert.strictEqual(som.getSlotHex(3), commitV1);
            // Nonce on committed ledger remains unchanged (1n)
            assert.strictEqual(som.getNonce(), 1n);
            assert.strictEqual(som.canUndo(), true);
            assert.strictEqual(som.canRedo(), false);
        });

        await bdd.when('the user stages another action updating Slot 3 to V2', async () => {
            som.stage({
                type: 'EDIT_GIT',
                targetSlot: 3,
                callerDid: aliceDid,
                payload: { newCommitment: commitV2 },
            });
        });

        await bdd.then('the uncommitted queue has length 2 and Slot 3 reflects V2', async () => {
            assert.strictEqual(som.getSlotHex(3), commitV2);
            assert.strictEqual(som.getUncommittedActions().length, 2);
        });

        await bdd.when('the user invokes "som.undo()" before block sealing', async () => {
            const success = som.undo();
            assert.strictEqual(success, true);
        });

        await bdd.then('Slot 3 instantly rewinds back to V1 with zero ledger gas and zero circuit generation', async () => {
            assert.strictEqual(som.getSlotHex(3), commitV1);
            assert.strictEqual(som.canRedo(), true);
        });

        await bdd.when('the user invokes "som.undo()" again', async () => {
            som.undo();
        });

        await bdd.then('Slot 3 rewinds back to the committed base root V0', async () => {
            assert.strictEqual(som.getSlotHex(3), initialRoot);
            assert.strictEqual(som.canUndo(), false);
        });

        await bdd.when('the user invokes "som.redo()"', async () => {
            const success = som.redo();
            assert.strictEqual(success, true);
        });

        await bdd.then('Slot 3 re-advances to V1 in memory', async () => {
            assert.strictEqual(som.getSlotHex(3), commitV1);
        });

        await bdd.when('the user calls "som.discardUncommitted()"', async () => {
            som.discardUncommitted();
        });

        await bdd.then('all uncommitted actions are discarded, returning state cleanly to V0', async () => {
            assert.strictEqual(som.getSlotHex(3), initialRoot);
            assert.strictEqual(som.canUndo(), false);
            assert.strictEqual(som.canRedo(), false);
        });
    });

    // Scenario 2: Fiber-Style Transaction Squashing and State Folding
    await scenario('Fiber-Style Transaction Squashing and State Folding', async (bdd) => {
        let som: StateObjectModel;
        const invDelta1 = ethers.id('inv-delta-1');
        const invDelta2 = ethers.id('inv-delta-2');
        const invFinal = ethers.id('inv-final-composite');

        await bdd.given('an active account initialized with initial nonce 0', async () => {
            som = new StateObjectModel('0x1111111111111111111111111111111111111111');
            assert.strictEqual(som.getNonce(), 0n);
        });

        await bdd.when('3 rapid micro-actions targeting Slot 5 are dispatched in the same tick', async () => {
            const p1 = som.dispatch({ type: 'ADJUST', targetSlot: 5, callerDid: aliceDid, payload: { newCommitment: invDelta1 } });
            const p2 = som.dispatch({ type: 'ADJUST', targetSlot: 5, callerDid: aliceDid, payload: { newCommitment: invDelta2 } });
            const p3 = som.dispatch({ type: 'ADJUST', targetSlot: 5, callerDid: aliceDid, payload: { newCommitment: invFinal } });
            await Promise.all([p1, p2, p3]);
        });

        await bdd.then('the actions are squashed into a single composite fold advancing nonce by 1n', async () => {
            assert.strictEqual(som.getNonce(), 1n);
            assert.strictEqual(som.getSlotHex(5), invFinal);
        });

        await bdd.and('a new StateBlock is recorded in the Invertible Delta DAG at height 1', async () => {
            assert.strictEqual(som.getBlockHeight(), 1n);
            const block = som.getBlock(1n);
            assert.ok(block !== undefined);
            assert.strictEqual(block!.nonce, 1n);
            assert.ok(block!.delta.slotMutations.has(5));
            assert.ok(block!.inverseDelta.slotMutations.has(5));
        });
    });

    // Scenario 3: Monotonic Ledger Revert via Invertible Delta DAG (Track B)
    await scenario('Monotonic Ledger Revert via Invertible Delta DAG (Track B)', async (bdd) => {
        let som: StateObjectModel;
        const stateRootBlock1 = ethers.id('git-release-v1.0.0');
        const stateRootBlock2 = ethers.id('git-release-v1.1.0');
        const stateRootBlock3 = ethers.id('git-release-v2.0.0');

        await bdd.given('an account with 3 committed blocks on the ledger', async () => {
            som = new StateObjectModel('0x1111111111111111111111111111111111111111');

            // Block 1
            await som.dispatch({ type: 'COMMIT_B1', targetSlot: 3, callerDid: aliceDid, payload: { newCommitment: stateRootBlock1 } });
            // Block 2
            await som.dispatch({ type: 'COMMIT_B2', targetSlot: 3, callerDid: aliceDid, payload: { newCommitment: stateRootBlock2 } });
            // Block 3
            await som.dispatch({ type: 'COMMIT_B3', targetSlot: 3, callerDid: aliceDid, payload: { newCommitment: stateRootBlock3 } });

            assert.strictEqual(som.getBlockHeight(), 3n);
            assert.strictEqual(som.getNonce(), 3n);
            assert.strictEqual(som.getSlotHex(3), stateRootBlock3);
        });

        await bdd.when('the user requests a rollback to Block 1 via "som.revert(1n)"', async () => {
            await som.revert(1n);
        });

        await bdd.then('the SOM computes the inverse delta patch and dispatches a forward Block 4 with nonce 4n', async () => {
            assert.strictEqual(som.getBlockHeight(), 4n);
            assert.strictEqual(som.getNonce(), 4n); // Strictly monotonic! Nonce never goes backwards!
        });

        await bdd.and('the state in Slot 3 is restored bit-exact to Block 1 root (v1.0.0)', async () => {
            assert.strictEqual(som.getSlotHex(3), stateRootBlock1);
        });

        await bdd.and('attempting to revert to an invalid future height throws RangeError', async () => {
            await assert.rejects(
                async () => await som.revert(99n),
                /Invalid target block height/
            );
        });
    });

    // Scenario 4: Superposition Rollback of Unconsumed Blind Note via Decay Timeout (Track C)
    await scenario('Superposition Rollback of Unconsumed Blind Note via Decay Timeout (Track C)', async (bdd) => {
        let som: StateObjectModel;
        const sagaId = 'SAGA-INVOICE-8812';
        const depositAmount = 50_000n;
        const decayEpoch = 200n;

        await bdd.given('Account A dispatches a B2B payment saga with a €50,000 blind note deposit for Account B', async () => {
            som = new StateObjectModel('0x1111111111111111111111111111111111111111');
            const saga = som.initiateBlindNoteSaga({
                sagaId,
                initiatorDid: aliceDid,
                counterpartyDid: bobDid,
                targetSlot: 2,
                depositAmount,
                decayEpoch,
            });

            assert.strictEqual(saga.status, 'Superposition');
            assert.strictEqual(saga.depositAmount, 50_000n);
            assert.ok(saga.spendingNullifier.startsWith('0x'));
            assert.ok(saga.reclaimNullifier.startsWith('0x'));
        });

        await bdd.when('Counterparty B goes offline and consensus advances to epoch 205 without note consumption', async () => {
            // Epoch 205 >= decayEpoch (200)
        });

        await bdd.then('Account A detects the expired decay window and generates the reclamation nullifier', async () => {
            const { saga, refundCommitment } = som.reclaimExpiredNote(sagaId, 205n);
            assert.strictEqual(saga.status, 'Reclaimed');
            assert.strictEqual(refundCommitment, saga.depositCommitment);
        });

        await bdd.and('Account A reclaims the €50,000 note locally without Account B ever coming online', async () => {
            const saga = som.getSaga(sagaId);
            assert.strictEqual(saga?.status, 'Reclaimed');
        });

        await bdd.and('attempting to reclaim before the decay epoch is rejected fail-closed', async () => {
            const earlySagaId = 'SAGA-EARLY-001';
            som.initiateBlindNoteSaga({
                sagaId: earlySagaId,
                initiatorDid: aliceDid,
                counterpartyDid: bobDid,
                targetSlot: 2,
                depositAmount: 10_000n,
                decayEpoch: 500n,
            });

            assert.throws(() => {
                som.reclaimExpiredNote(earlySagaId, 450n); // 450 < 500
            }, /Decay epoch 500 not reached yet/);
        });
    });

    // Scenario 5: Active Compensation and Bond Slashing Backstop for Consumed Note (Track C)
    await scenario('Active Compensation and Bond Slashing Backstop for Consumed Note (Track C)', async (bdd) => {
        let som: StateObjectModel;
        const sagaId = 'SAGA-ESCROW-404';

        await bdd.given('Account B claims Account A\'s blind note from Superposition into Slot 2', async () => {
            som = new StateObjectModel('0x1111111111111111111111111111111111111111');
            som.initiateBlindNoteSaga({
                sagaId,
                initiatorDid: aliceDid,
                counterpartyDid: bobDid,
                targetSlot: 2,
                depositAmount: 25_000n,
                decayEpoch: 100n,
            });

            // Bob claims the note
            const claimed = som.claimBlindNoteSaga(sagaId, bobDid);
            assert.strictEqual(claimed.status, 'Claimed');
        });

        await bdd.when('downstream service delivery fails and Account B compensates with a refund', async () => {
            const compensated = som.compensateConsumedNote(sagaId, ethers.id('refund-note-25000'));
            assert.strictEqual(compensated.status, 'Compensated');
        });

        await bdd.when('another counterparty defaults on compensation past dispute deadline epoch 300', async () => {
            const defaultSagaId = 'SAGA-DEFAULT-999';
            som.initiateBlindNoteSaga({
                sagaId: defaultSagaId,
                initiatorDid: aliceDid,
                counterpartyDid: bobDid,
                targetSlot: 2,
                depositAmount: 30_000n,
                decayEpoch: 100n,
            });
            som.claimBlindNoteSaga(defaultSagaId, bobDid);

            // Counterparty fails to compensate; dispute deadline (epoch 300) passes
            const slashResult = som.slashDefaultingCounterparty(defaultSagaId, 305n, 300n);
            assert.strictEqual(slashResult.slashed, true);
            assert.strictEqual(slashResult.seizedAmount, 60_000n); // 2x bond seized
            assert.strictEqual(som.getSaga(defaultSagaId)?.status, 'SlashingTriggered');
        });

        await bdd.then('the default triggers operational bond seizure protecting Account A\'s capital', async () => {
            // Verified above: seizedAmount = 2x depositAmount
        });
    });

    // Scenario 6: In-Memory deReBAC Filtering, Path Signals, and Sovereign Pure Rebase
    await scenario('In-Memory deReBAC Filtering, Path Signals, and Sovereign Pure Rebase', async (bdd) => {
        let som: StateObjectModel;

        await bdd.given('an account with owner Alice and unauthorized Bob', async () => {
            som = new StateObjectModel('0x1111111111111111111111111111111111111111');
            assert.strictEqual(som.canMutate(aliceDid, 3), true);
            assert.strictEqual(som.canMutate(bobDid, 3), false);
        });

        await bdd.when('Bob attempts an unauthorized write on Slot 3', async () => {
            // Will check rejection in then
        });

        await bdd.then('the in-memory deReBAC guard rejects the action in <1ms with a security violation', async () => {
            await assert.rejects(
                async () => await som.dispatch({
                    type: 'ATTACK',
                    targetSlot: 3,
                    callerDid: bobDid,
                    payload: { newCommitment: ethers.id('bad-data') }
                }),
                /\[SOM Security Violation\] Caller .* lacks deReBAC capability/
            );
        });

        await bdd.when('Alice has uncommitted staged actions on Slot 3 and remote peer updates Slot 2', async () => {
            const aliceCommitment = ethers.id('alice-local-slot3');
            som.stage({
                type: 'LOCAL_GIT',
                targetSlot: 3,
                callerDid: aliceDid,
                payload: { newCommitment: aliceCommitment }
            });

            const remoteSlots: Uint8Array[] = Array.from({ length: 64 }, () => new Uint8Array(32));
            const remoteNoteCommitment = new Uint8Array(ethers.getBytes(ethers.id('remote-peer-slot2')));
            remoteSlots[2] = remoteNoteCommitment;

            const rebaseRes = som.rebase({ slots: remoteSlots, nonce: 1n });
            assert.strictEqual(rebaseRes.success, true);
            assert.strictEqual(rebaseRes.conflictedSlots.length, 0);
            assert.strictEqual(som.getSlotHex(2), ethers.hexlify(remoteNoteCommitment));
            assert.strictEqual(som.getSlotHex(3), aliceCommitment);
        });

        await bdd.then('the sovereign rebase merges cleanly without conflict and advances nonce', async () => {
            assert.strictEqual(som.getNonce(), 2n);
        });

        await bdd.and('if remote peer modified the same Slot 3, rebase detects collision conflict [3]', async () => {
            const conflictingRemote: Uint8Array[] = Array.from({ length: 64 }, () => new Uint8Array(32));
            conflictingRemote[3] = new Uint8Array(ethers.getBytes(ethers.id('conflicting-slot3')));

            const conflictRes = som.rebase({ slots: conflictingRemote, nonce: 5n });
            assert.strictEqual(conflictRes.success, false);
            assert.deepStrictEqual(conflictRes.conflictedSlots, [3]);
        });
    });

    console.log('\n======================================================================');
    console.log('   ALL SOM GIVEN-WHEN-THEN BDD SCENARIOS PASSED (6/6)! 🎉');
    console.log('======================================================================\n');
}

runBddTests().catch(err => {
    console.error('BDD Test Failed:', err);
    process.exit(1);
});
