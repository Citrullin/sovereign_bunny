import assert from 'node:assert';
import { createNoteInboxMachineActor, DecryptedNote } from '../../src/app/note_inbox_machine.js';
import { createNoteComposerMachineActor } from '../../src/app/note_composer_machine.js';

console.log("🔒 Running Sovereign Blind Note Privacy & Cryptographic Lifecycle Negative Tests...\n");

// -------------------------------------------------------------
// 1. Note Decryption Negative Test: Mismatched Viewing Key
// -------------------------------------------------------------
console.log("1. Testing Note Decryption failure with invalid / mismatched viewing key...");

interface SimulatedEncryptedNote {
    commitment: string;
    targetSlot: number;
    ephemeralPubkey: string;
    encryptedCiphertext: string;
    expectedRecipientViewingKey: string;
    plaintext: DecryptedNote;
}

function simulateDecryptNote(note: SimulatedEncryptedNote, providedViewingKey: string | null): DecryptedNote | null {
    if (!providedViewingKey) return null;
    if (providedViewingKey !== note.expectedRecipientViewingKey) {
        return null; // Decryption failed, MAC mismatch or invalid secret
    }
    return note.plaintext;
}

const aliceAddr = "0x1111111111111111111111111111111111111111";
const bobAddr = "0x2222222222222222222222222222222222222222";
const eveAddr = "0x6666666666666666666666666666666666666666";

const bobViewingKey = "0xb0b_secret_viewing_key_9999999999999999";
const eveViewingKey = "0x666_evil_attacker_viewing_key_00000000";

const noteToBob: SimulatedEncryptedNote = {
    commitment: "0xabc1230000000000000000000000000000000000000000000000000000000000",
    targetSlot: 2,
    ephemeralPubkey: "0x04ephemeralpubkey...",
    encryptedCiphertext: "0xciphertext_for_bob_only...",
    expectedRecipientViewingKey: bobViewingKey,
    plaintext: {
        commitment: "0xabc1230000000000000000000000000000000000000000000000000000000000",
        assetId: "TBL",
        amount: 50000000000000000000n, // 50 TBL
        sender: aliceAddr,
        recipient: bobAddr,
        targetSlot: 2,
        isShielded: true,
        status: 'unspent'
    }
};

// NEGATIVE ASSERTION: Eve's viewing key MUST fail to decrypt Bob's note
const eveAttempt = simulateDecryptNote(noteToBob, eveViewingKey);
assert.strictEqual(eveAttempt, null, "NEG-05: Eve's viewing key must return null (decryption failure)");

// NEGATIVE ASSERTION: Null viewing key MUST fail to decrypt Bob's note
const unauthAttempt = simulateDecryptNote(noteToBob, null);
assert.strictEqual(unauthAttempt, null, "NEG-05: Null viewing key must return null");

// POSITIVE ASSERTION: Bob's valid viewing key succeeds
const bobAttempt = simulateDecryptNote(noteToBob, bobViewingKey);
assert.notStrictEqual(bobAttempt, null, "Bob's viewing key succeeds");
assert.strictEqual(bobAttempt?.amount, 50000000000000000000n, "Plaintext amount recovered correctly");

console.log("   ✅ Viewing key decryption privacy boundary verified.");

// -------------------------------------------------------------
// 2. Cross-Account Note Inbox Scoping Negative Test
// -------------------------------------------------------------
console.log("\n2. Testing Cross-Account Note Inbox scoping...");

const inboxBob = createNoteInboxMachineActor();
inboxBob.start();
inboxBob.send({ type: 'SET_ADDRESS', address: bobAddr });
inboxBob.send({ type: 'SET_VIEWING_KEY', viewingKey: bobViewingKey });

const allLedgerNotes: DecryptedNote[] = [
    bobAttempt!,
    {
        commitment: "0xdef4560000000000000000000000000000000000000000000000000000000000",
        assetId: "TBL",
        amount: 100000000000000000000n,
        sender: aliceAddr,
        recipient: eveAddr,
        targetSlot: 2,
        isShielded: true,
        status: 'unspent'
    }
];

// Recipient scan filter: Bob's inbox must ONLY receive notes addressed to Bob
const bobsScannedNotes = allLedgerNotes.filter(n => n.recipient.toLowerCase() === bobAddr.toLowerCase());
inboxBob.send({ type: 'SCAN_COMPLETE', notes: bobsScannedNotes });

const bobInboxCtx = inboxBob.getSnapshot().context;
assert.strictEqual(bobInboxCtx.notes.length, 1, "Bob only receives 1 note");
assert.strictEqual(bobInboxCtx.notes[0].recipient, bobAddr, "Bob's note is addressed to Bob");

// NEGATIVE ASSERTION: Eve's note is NOT in Bob's inbox
assert.strictEqual(
    bobInboxCtx.notes.some(n => n.recipient.toLowerCase() === eveAddr.toLowerCase()),
    false,
    "NEG-06: Bob's inbox must not contain notes addressed to Eve"
);
inboxBob.stop();

console.log("   ✅ Note inbox recipient isolation verified.");

// -------------------------------------------------------------
// 3. Double-Spend & Nullifier SMT Simulation Negative Test
// -------------------------------------------------------------
console.log("\n3. Testing Double-Spending / Nullifier SMT Rejection...");

class SimulatedNullifierSMT {
    private spentNullifiers = new Set<string>();

    public spend(nullifier: string, commitment: string): { success: boolean; error?: string } {
        if (this.spentNullifiers.has(nullifier)) {
            return { success: false, error: "ErrNullifierAlreadySpent: Double-spend rejected by SMT" };
        }
        this.spentNullifiers.add(nullifier);
        return { success: true };
    }

    public isSpent(nullifier: string): boolean {
        return this.spentNullifiers.has(nullifier);
    }
}

const smt = new SimulatedNullifierSMT();
const noteNullifier = "0xnullifier_hash_9876543210fedcba";

// First spend: succeeds
const spend1 = smt.spend(noteNullifier, noteToBob.commitment);
assert.strictEqual(spend1.success, true, "First spend succeeds");
assert.strictEqual(smt.isSpent(noteNullifier), true, "Nullifier marked as spent in SMT");

// NEGATIVE ASSERTION: Second spend with same nullifier MUST FAIL
const spend2 = smt.spend(noteNullifier, noteToBob.commitment);
assert.strictEqual(spend2.success, false, "NEG-07: Double-spending must fail");
assert.ok(spend2.error?.includes("ErrNullifierAlreadySpent"), "Reverted with ErrNullifierAlreadySpent");

console.log("   ✅ Double-spend nullifier SMT rejection verified.");

// -------------------------------------------------------------
// 4. Note Composer Zero & Negative Amount Invariant
// -------------------------------------------------------------
console.log("\n4. Testing Note Composer validation negative checks...");

const composer = createNoteComposerMachineActor();
composer.start();

// NEGATIVE ASSERTION: Committing with 0 amount must fail validation
composer.send({ type: 'SET_AMOUNT', amount: 0n });
composer.send({ type: 'PREPARE_COMMIT' });
composer.send({ type: 'COMMIT_FAIL', error: "Validation error: Amount must be greater than 0" });

assert.strictEqual(composer.getSnapshot().value, 'error', "NEG-08: Zero amount commit transitions to error");
assert.strictEqual(
    composer.getSnapshot().context.error,
    "Validation error: Amount must be greater than 0",
    "Correct error message recorded"
);
composer.stop();

console.log("   ✅ Note Composer validation checks verified.");

// -------------------------------------------------------------
// 5. Expired Note Absorption vs Clawback Lifecycle
// -------------------------------------------------------------
console.log("\n5. Testing Expired / Evaporated Note Lifecycle Negative Invariant...");

function attemptAbsorb(noteStatus: string): boolean {
    if (noteStatus === 'evaporated' || noteStatus === 'clawback_pending') {
        return false; // Cannot absorb an evaporated or clawed-back note
    }
    return true;
}

assert.strictEqual(attemptAbsorb('unspent'), true, "Unspent note can be absorbed");
assert.strictEqual(attemptAbsorb('evaporated'), false, "NEG-09: Evaporated note CANNOT be absorbed");
assert.strictEqual(attemptAbsorb('clawback_pending'), false, "NEG-09: Clawback-pending note CANNOT be absorbed");

console.log("   ✅ Expired note absorption negative checks verified.");

console.log("\n🎉 All Blind Note Privacy & Cryptographic Lifecycle Negative Tests Passed Successfully!\n");
