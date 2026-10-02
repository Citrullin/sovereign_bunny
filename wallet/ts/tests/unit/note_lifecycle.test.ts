import {
    createNoteInboxMachineActor,
    DecryptedNote,
    initialNoteInboxContext,
} from '../../src/app/note_inbox_machine.js';
import { SovereignNoteInbox } from '../../src/components/sovereign_note_inbox.js';
import {
    createNoteComposerMachineActor,
    initialNoteComposerContext,
} from '../../src/app/note_composer_machine.js';
import { SovereignNoteComposer } from '../../src/components/sovereign_note_composer.js';

console.log("💌 Running Sovereign Blind Note Lifecycle & Privacy Machine Tests...\n");

// -------------------------------------------------------------
// 1. NoteInboxMachine Lifecycle & Privacy States
// -------------------------------------------------------------
console.log("1. Testing NoteInboxMachine transitions and viewing key states...");
const inboxActor = createNoteInboxMachineActor();
inboxActor.start();

console.assert(inboxActor.getSnapshot().value === 'idle', "Initial state is idle");
console.assert(inboxActor.getSnapshot().context.viewingKey === null, "Viewing key initialized to null");

inboxActor.send({ type: 'SET_VIEWING_KEY', viewingKey: '0xdeadbeefcafebabe0102030405060708' });
console.assert(inboxActor.getSnapshot().value === 'scanning', "SET_VIEWING_KEY transitions to scanning");
console.assert(
    inboxActor.getSnapshot().context.viewingKey === '0xdeadbeefcafebabe0102030405060708',
    "Viewing key stored in context"
);

const sampleNotes: DecryptedNote[] = [
    {
        commitment: '0x1111111111111111111111111111111111111111111111111111111111111111',
        assetId: 'TBL',
        amount: 5000000000000000000n, // 5 TBL
        sender: '0x00000000000000000000000000000000000000aa',
        recipient: '0x00000000000000000000000000000000000000bb',
        targetSlot: 2,
        isShielded: true,
        status: 'unspent',
    },
    {
        commitment: '0x2222222222222222222222222222222222222222222222222222222222222222',
        assetId: 'DID_REGISTRATION_ASSET',
        amount: 1n,
        sender: '0x00000000000000000000000000000000000000cc',
        recipient: '0x00000000000000000000000000000000000000bb',
        isShielded: false,
        status: 'unspent',
    },
];

inboxActor.send({ type: 'SCAN_COMPLETE', notes: sampleNotes });
console.assert(inboxActor.getSnapshot().value === 'displaying', "SCAN_COMPLETE transitions to displaying");
console.assert(inboxActor.getSnapshot().context.notes.length === 2, "Loaded 2 notes into inbox context");

// Absorb Note
inboxActor.send({ type: 'ABSORB_NOTE', commitment: sampleNotes[0].commitment });
const absorbedNote = inboxActor.getSnapshot().context.notes.find((n) => n.commitment === sampleNotes[0].commitment);
console.assert(absorbedNote?.status === 'absorbed', "Note marked as absorbed");

// Clawback lifecycle
inboxActor.send({ type: 'INITIATE_CLAWBACK', commitment: sampleNotes[1].commitment });
console.assert(inboxActor.getSnapshot().value === 'clawback_pending', "Transitions to clawback_pending state");
const clawbackNote = inboxActor.getSnapshot().context.notes.find((n) => n.commitment === sampleNotes[1].commitment);
console.assert(clawbackNote?.status === 'clawback_pending', "Note marked as clawback_pending");

inboxActor.send({ type: 'CLAWBACK_COMPLETE', commitment: sampleNotes[1].commitment });
console.assert(inboxActor.getSnapshot().value === 'displaying', "Returns to displaying upon clawback completion");
const evaporatedNote = inboxActor.getSnapshot().context.notes.find((n) => n.commitment === sampleNotes[1].commitment);
console.assert(evaporatedNote?.status === 'evaporated', "Clawed back note evaporated");

inboxActor.send({ type: 'CLEAR' });
console.assert(inboxActor.getSnapshot().value === 'idle', "CLEAR transitions back to idle");
console.assert(inboxActor.getSnapshot().context.notes.length === 0, "Notes cleared");
inboxActor.stop();
console.log("   ✅ NoteInboxMachine transitions and privacy states verified.");

// -------------------------------------------------------------
// 2. <sovereign-note-inbox> Lit Component & Filtering
// -------------------------------------------------------------
console.log("\n2. Testing <sovereign-note-inbox> component properties and filtering...");
const inboxComponent = new SovereignNoteInbox();
inboxComponent.notes = sampleNotes;

console.assert(inboxComponent.filteredNotes.length === 2, "Default filter 'all' returns all notes");

inboxComponent.setFilter('shielded');
console.assert(inboxComponent.filteredNotes.length === 1, "Filter 'shielded' returns only 1 note");
console.assert(inboxComponent.filteredNotes[0].isShielded === true, "Returned note is shielded");

inboxComponent.setFilter('unspent');
console.assert(inboxComponent.filteredNotes.length === 2, "Filter 'unspent' returns 2 unspent notes");

let absorbedEventReceived: boolean = false;
inboxComponent.addEventListener('absorb-note', (e: any) => {
    if (e.detail?.commitment === sampleNotes[0].commitment) {
        absorbedEventReceived = true;
    }
});
inboxComponent.absorb(sampleNotes[0].commitment);
console.assert(Boolean(absorbedEventReceived), "absorb() fired custom event 'absorb-note'");
console.log("   ✅ <sovereign-note-inbox> component binding & filtering verified.");

// -------------------------------------------------------------
// 3. NoteComposerMachine Lifecycle & BigInt Verification
// -------------------------------------------------------------
console.log("\n3. Testing NoteComposerMachine composition and commit workflow...");
const composerActor = createNoteComposerMachineActor();
composerActor.start();

console.assert(composerActor.getSnapshot().value === 'composing', "Initial state is composing");

composerActor.send({ type: 'SET_RECIPIENT', recipient: '0x00000000000000000000000000000000000000dd' });
composerActor.send({ type: 'SET_AMOUNT', amount: 10000000000000000000n }); // 10 TBL
composerActor.send({ type: 'SET_ASSET', assetId: 'TBL' });
composerActor.send({ type: 'SET_SLOT', targetSlot: 7 });
composerActor.send({ type: 'SET_SHIELDED', isShielded: true });
composerActor.send({ type: 'SET_PAYLOAD', payload: '0xca7b007' });

const compCtx = composerActor.getSnapshot().context;
console.assert(compCtx.recipient === '0x00000000000000000000000000000000000000dd', "Recipient stored");
console.assert(compCtx.amount === 10000000000000000000n, "Amount stored as BigInt");
console.assert(compCtx.targetSlot === 7, "Target slot stored");
console.assert(compCtx.isShielded === true, "Shielded flag stored");
console.assert(compCtx.payload === '0xca7b007', "Payload stored");

composerActor.send({ type: 'PREPARE_COMMIT' });
console.assert(composerActor.getSnapshot().value === 'committing', "PREPARE_COMMIT transitions to committing");

composerActor.send({
    type: 'COMMIT_SUCCESS',
    commitment: '0x9999999999999999999999999999999999999999999999999999999999999999',
    txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});
console.assert(composerActor.getSnapshot().value === 'committed', "COMMIT_SUCCESS transitions to committed");
console.assert(
    composerActor.getSnapshot().context.commitment === '0x9999999999999999999999999999999999999999999999999999999999999999',
    "Commitment hash recorded"
);
console.assert(
    composerActor.getSnapshot().context.txHash === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    "Tx hash recorded"
);

composerActor.send({ type: 'RESET' });
console.assert(composerActor.getSnapshot().value === 'composing', "RESET returns machine to composing");
console.assert(composerActor.getSnapshot().context.amount === 0n, "Amount reset to 0n");

// Error branch
composerActor.send({ type: 'PREPARE_COMMIT' });
composerActor.send({ type: 'COMMIT_FAIL', error: 'Precompile 0x01 reverted: Insufficient balance' });
console.assert(composerActor.getSnapshot().value === 'error', "COMMIT_FAIL transitions to error");
console.assert(
    composerActor.getSnapshot().context.error === 'Precompile 0x01 reverted: Insufficient balance',
    "Error message captured in context"
);

composerActor.send({ type: 'RETRY' });
console.assert(composerActor.getSnapshot().value === 'committing', "RETRY returns to committing");
composerActor.stop();
console.log("   ✅ NoteComposerMachine commit & error branches verified.");

// -------------------------------------------------------------
// 4. <sovereign-note-composer> Lit Component Form & Actor Binding
// -------------------------------------------------------------
console.log("\n4. Testing <sovereign-note-composer> component integration...");
const composerComponent = new SovereignNoteComposer();
composerComponent.sender = '0x1234567890123456789012345678901234567890';
composerComponent.connectedCallback();

composerComponent.updateField('recipient', '0x9999999999999999999999999999999999999999');
composerComponent.updateField('amount', '2500000000000000000');
composerComponent.updateField('targetSlot', 3);
composerComponent.updateField('isShielded', true);

let commitEventReceived: boolean = false;
composerComponent.addEventListener('commit-note', (e: any) => {
    if (e.detail?.amount === 2500000000000000000n && e.detail?.targetSlot === 3) {
        commitEventReceived = true;
    }
});

composerComponent.commit();
console.assert(Boolean(commitEventReceived), "commit() emitted 'commit-note' event with BigInt amount & slot");
console.assert(composerComponent.composerState === 'committing', "Component state updated to committing");

composerComponent.reset();
console.assert(composerComponent.composerState === 'composing', "reset() restored state to composing");
console.assert(composerComponent.amount === '0', "Amount reset to '0'");
console.log("   ✅ <sovereign-note-composer> component verified.");

console.log("\n🎉 All Blind Note Lifecycle & Privacy Unit Tests Passed Successfully!\n");
