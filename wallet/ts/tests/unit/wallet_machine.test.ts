import { WalletStateMachine } from '../../src/app/wallet_machine.js';

console.log("💼 Running Wallet XState Machine Unit Tests...");

// 1. Initial state
const machine = new WalletStateMachine();
let snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'locked', `Initial state must be locked, got ${snapshot.value}`);
console.assert(snapshot.context.connectedAddress === null, "Initial connectedAddress should be null");
console.assert(snapshot.context.currentKeys === null, "Initial currentKeys should be null");
console.assert(snapshot.context.profiles.length === 0, "Initial profiles should be empty");
console.log("   ✅ Initial locked state verified.");

// 2. Set profiles and connected address
machine.send({
    type: 'SET_PROFILES',
    profiles: [
        {
            address: '0x1111111111111111111111111111111111111111',
            did: 'did:sov:0x1111111111111111111111111111111111111111',
        },
        {
            address: '0x2222222222222222222222222222222222222222',
            did: 'did:sov:0x2222222222222222222222222222222222222222',
        }
    ],
    activeIndex: 0,
});
snapshot = machine.getSnapshot();
console.assert(snapshot.context.profiles.length === 2, "Profiles length should be 2");
console.assert(snapshot.context.activeProfileIndex === 0, "Active profile index should be 0");
console.log("   ✅ SET_PROFILES verified.");

// 3. Initiate unlock -> unlocking state
machine.send({
    type: 'UNLOCK',
    address: '0x1111111111111111111111111111111111111111',
    password: 'password123',
});
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'unlocking', `State should be unlocking, got ${snapshot.value}`);
console.log("   ✅ UNLOCK event transitions to unlocking verified.");

// 4. UNLOCK_FAIL transitions back to locked with error context
machine.send({
    type: 'UNLOCK_FAIL',
    error: 'Invalid password',
});
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'locked', `State should be locked after failure, got ${snapshot.value}`);
console.assert(snapshot.context.error === 'Invalid password', "Error context should record failure reason");
console.log("   ✅ UNLOCK_FAIL error handling verified.");

// 5. Successful UNLOCK sequence: UNLOCK -> UNLOCK_OK -> ready
machine.send({
    type: 'UNLOCK',
    address: '0x1111111111111111111111111111111111111111',
});
machine.send({
    type: 'UNLOCK_OK',
    keys: {
        address: '0x1111111111111111111111111111111111111111',
        did: 'did:sov:0x1111111111111111111111111111111111111111',
        signing_key: '0xmocksigningkey',
    },
    profileIndex: 0,
});
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'ready', `State should be ready after UNLOCK_OK, got ${snapshot.value}`);
console.assert(snapshot.context.currentKeys?.address === '0x1111111111111111111111111111111111111111', "Keys address populated");
console.assert(snapshot.context.connectedAddress === '0x1111111111111111111111111111111111111111', "Connected address set");
console.log("   ✅ UNLOCK_OK transitions to ready verified.");

// 6. Profile switching in ready state
machine.send({
    type: 'SWITCH_PROFILE',
    index: 1,
});
snapshot = machine.getSnapshot();
console.assert(snapshot.context.activeProfileIndex === 1, "Active profile should be switched to 1");
console.assert(snapshot.context.connectedAddress === '0x2222222222222222222222222222222222222222', "Connected address updated to profile 1");
console.log("   ✅ SWITCH_PROFILE verified.");

// 7. Sync workflow: SYNC -> SYNC_OK -> ready
machine.send({ type: 'SYNC' });
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'syncing', `State should be syncing, got ${snapshot.value}`);

machine.send({
    type: 'SYNC_OK',
    profile: { registered: true },
});
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'ready', `State should be ready after sync, got ${snapshot.value}`);
console.assert(snapshot.context.profiles[1].registered === true, "Profile 1 updated with sync data");
console.log("   ✅ SYNC and SYNC_OK workflow verified.");

// 8. LOCK event returns to locked and clears keys
machine.send({ type: 'LOCK' });
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'locked', `State should be locked after LOCK event, got ${snapshot.value}`);
console.assert(snapshot.context.currentKeys === null, "Current keys cleared on lock");
console.log("   ✅ LOCK transition verified.");

machine.stop();
console.log("🎉 All WalletStateMachine unit tests passed!\n");
