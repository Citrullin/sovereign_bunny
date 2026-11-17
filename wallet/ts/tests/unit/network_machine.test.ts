import { NetworkStateMachine } from '../../src/app/network_machine.js';

console.log("🌐 Running Network XState Machine Unit Tests...");

// 1. Initial disconnected state
const machine = new NetworkStateMachine();
let snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'disconnected', `Initial state must be disconnected, got ${snapshot.value}`);
console.assert(snapshot.context.epochHeight === 1, "Default epoch height should be 1");
console.assert(snapshot.context.peerCount === 0, "Default peer count should be 0");
console.log("   ✅ Initial disconnected state verified.");

// 2. CONNECT transitions to connecting
machine.send({
    type: 'CONNECT',
    rpcUrl: 'http://localhost:8545',
    chainId: '1337',
});
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'connecting', `State should be connecting, got ${snapshot.value}`);
console.assert(snapshot.context.rpcUrl === 'http://localhost:8545', "Context rpcUrl should be set");
console.log("   ✅ CONNECT transition verified.");

// 3. CONNECT_FAIL transitions back to disconnected
machine.send({
    type: 'CONNECT_FAIL',
    error: 'ECONNREFUSED',
});
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'disconnected', `State should be disconnected on failure, got ${snapshot.value}`);
console.assert(snapshot.context.error === 'ECONNREFUSED', "Error context set on CONNECT_FAIL");
console.log("   ✅ CONNECT_FAIL error handling verified.");

// 4. Successful CONNECT -> CONNECTED transitions to connected then auto to polling
machine.send({
    type: 'CONNECT',
    rpcUrl: 'http://localhost:8545',
});
machine.send({
    type: 'CONNECTED',
    chainId: '1337',
});
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'polling', `State should automatically transition to polling, got ${snapshot.value}`);
console.log("   ✅ CONNECTED transitions to polling verified.");

// 5. Polling events update epoch, peers, and latency
machine.send({
    type: 'POLL_OK',
    epochHeight: 42,
    peerCount: 7,
    latencyMs: 14,
});
snapshot = machine.getSnapshot();
console.assert(snapshot.context.epochHeight === 42, `Epoch height should be 42, got ${snapshot.context.epochHeight}`);
console.assert(snapshot.context.peerCount === 7, `Peer count should be 7, got ${snapshot.context.peerCount}`);
console.assert(snapshot.context.latencyMs === 14, `Latency should be 14ms, got ${snapshot.context.latencyMs}`);
console.log("   ✅ POLL_OK metrics update verified.");

// 6. Direct EPOCH_ADVANCED event
machine.send({
    type: 'EPOCH_ADVANCED',
    epochHeight: 43,
});
snapshot = machine.getSnapshot();
console.assert(snapshot.context.epochHeight === 43, `Epoch height should advance to 43, got ${snapshot.context.epochHeight}`);
console.log("   ✅ EPOCH_ADVANCED event verified.");

// 7. DISCONNECT transitions back to disconnected
machine.send({ type: 'DISCONNECT' });
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'disconnected', `State should be disconnected after DISCONNECT, got ${snapshot.value}`);
console.log("   ✅ DISCONNECT transition verified.");

machine.stop();
console.log("🎉 All NetworkStateMachine unit tests passed!\n");
