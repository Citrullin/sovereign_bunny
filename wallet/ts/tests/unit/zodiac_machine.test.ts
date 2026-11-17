import { ZodiacDaoStateMachine } from '../../src/zodiac_machine.js';

console.log("🏛️ Running Zodiac DAO XState Machine Unit Tests...");

// 1. Initial state
const machine = new ZodiacDaoStateMachine();
let snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'idle', `Initial state must be idle, got ${snapshot.value}`);
console.assert(snapshot.context.daoAddress === '', "Initial daoAddress should be empty");
console.log("   ✅ Initial state verified.");

// 2. Load DAO event transitions to loading
machine.send({ type: 'LOAD_DAO', daoAddress: '0x1111111111111111111111111111111111111111' });
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'loading', "State should be loading after LOAD_DAO");
console.assert(snapshot.context.daoAddress === '0x1111111111111111111111111111111111111111', "daoAddress should be set");
console.log("   ✅ LOAD_DAO event verified.");

// 3. DAO_LOADED event transitions to ready with context populated
machine.send({
    type: 'DAO_LOADED',
    data: {
        daoId: '0xda0011223344',
        avatar: '0x1111111111111111111111111111111111111111',
        owner: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        roles: [
            { relationId: 1, name: 'Owner', member: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' },
            { relationId: 4, name: 'Executor', member: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' }
        ],
        dataRefs: [
            {
                datasetId: '0x5a5a',
                blake3Root: '0x3344',
                sizeBytes: 10737418240,
                namespace: 'dao_treasury/financial_reports_2026'
            }
        ]
    }
});
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'ready', "State should be ready after DAO_LOADED");
console.assert(snapshot.context.roles.length === 2, "Roles count should be 2");
console.assert(snapshot.context.dataRefs.length === 1, "DataRefs count should be 1");
console.log("   ✅ DAO_LOADED transition and context verified.");

// 4. EXECUTE_ACTION transitions to executing
machine.send({
    type: 'EXECUTE_ACTION',
    target: '0x6b6b000000000000000000000000000000000002',
    value: '0',
    calldata: '0xa9059cbb',
    witnessPath: [
        { namespaceId: 0x20D1, objectId: '0xda0011223344', relationId: 4, subject: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' }
    ]
});
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'executing', "State should be executing after EXECUTE_ACTION");
console.log("   ✅ EXECUTE_ACTION event verified.");

// 5. ACTION_SUCCESS transitions back to ready
machine.send({ type: 'ACTION_SUCCESS', txHash: '0xabc123' });
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'ready', "State should return to ready on ACTION_SUCCESS");
console.log("   ✅ ACTION_SUCCESS event verified.");

// 6. Negative Case: ACTION_FAILED records error and transitions to error
machine.send({
    type: 'EXECUTE_ACTION',
    target: '0x6b6b000000000000000000000000000000000002',
    value: '0',
    calldata: '0xa9059cbb',
    witnessPath: [] // missing witness!
});
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'executing', "State should be executing");
machine.send({ type: 'ACTION_FAILED', error: 'Unauthorized: Missing upfront witness path' });
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'error', "State should transition to error on ACTION_FAILED");
console.assert(snapshot.context.error === 'Unauthorized: Missing upfront witness path', "Error should be recorded in context");
console.log("   ✅ ACTION_FAILED error recording and transition to error verified.");

// 7. RESET clears error and returns to ready
machine.send({ type: 'RESET' });
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'ready', "State should return to ready on RESET");
console.assert(snapshot.context.error === null, "Error should be cleared on RESET");
console.log("   ✅ RESET transition verified.");

// 8. PIN_DATAREF appends dataset and transitions to pinning
machine.send({
    type: 'PIN_DATAREF',
    datasetId: '0x7777',
    blake3Root: '0x8888',
    sizeBytes: 5368709120,
    namespace: 'dao_governance/proposal_discussions_archive'
});
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'pinning', "State should be pinning after PIN_DATAREF");
console.assert(snapshot.context.dataRefs.length === 2, "DataRefs count should be 2 after pin");
machine.send({ type: 'ACTION_SUCCESS', txHash: '0xpin123' });
snapshot = machine.getSnapshot();
console.assert(snapshot.value === 'ready', "State should return to ready after pinning SUCCESS");
console.log("   ✅ PIN_DATAREF and pinning lifecycle verified.");

console.log("🎉 All Zodiac DAO XState Machine Unit Tests Passed Successfully!");
