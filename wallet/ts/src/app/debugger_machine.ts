import { setup, assign, createActor } from 'xstate';
import { SovereignDebugger, DebugAnalysisResult } from '../debugger.js';

export interface DebuggerContext {
    inputPayload: string;
    targetAddress: string;
    valueWei: string;
    execMode: 'quantum_wrapped' | 'raw_bytecode' | 'standard_evm' | 'native_pq';
    analysisResult: DebugAnalysisResult | null;
    simulationResult: { success: boolean; output: string } | null;
    dispatchResult: { success: boolean; txHash?: string; message: string } | null;
    wotState: {
        title: string;
        properties: string;
        cid: string | null;
        error: string | null;
    };
    zanState: {
        object: string;
        relation: string;
        subject: string;
        encodedCalldata: string | null;
    };
    didState: {
        keyTier: string;
        encodedPayload: string | null;
    };
    error: string | null;
}

export type DebuggerEvent =
    | { type: 'SET_INPUT'; payload: string; target?: string; value?: string }
    | { type: 'LOAD_PRESET'; preset: 'pq_block' | 'pq_wrap' | 'zanzibar' | 'verkle'; connectedAddress?: string }
    | { type: 'CLEAR' }
    | { type: 'ANALYZE' }
    | { type: 'ANALYZE_SUCCESS'; result: DebugAnalysisResult }
    | { type: 'ANALYZE_FAILURE'; error: string }
    | { type: 'SET_DISPATCH_CONFIG'; target?: string; valueWei?: string; execMode?: 'quantum_wrapped' | 'raw_bytecode' | 'standard_evm' | 'native_pq' }
    | { type: 'SIMULATE_START' }
    | { type: 'SIMULATE_SUCCESS'; output: string }
    | { type: 'SIMULATE_FAILURE'; error: string }
    | { type: 'DISPATCH_START' }
    | { type: 'DISPATCH_SUCCESS'; txHash: string; message: string }
    | { type: 'DISPATCH_FAILURE'; error: string }
    | { type: 'SET_WOT_CONFIG'; title?: string; properties?: string }
    | { type: 'WOT_GENERATED'; cid: string | null; error: string | null }
    | { type: 'SET_ZANZIBAR_CONFIG'; object?: string; relation?: string; subject?: string }
    | { type: 'ZANZIBAR_ENCODED'; calldata: string }
    | { type: 'SET_DID_CONFIG'; keyTier?: string }
    | { type: 'DID_ENCODED'; payload: string };

export const initialDebuggerContext: DebuggerContext = {
    inputPayload: '',
    targetAddress: '0x0000000000000000000000000000000000000003',
    valueWei: '0',
    execMode: 'quantum_wrapped',
    analysisResult: null,
    simulationResult: null,
    dispatchResult: null,
    wotState: {
        title: 'Sovereign Smart Enclave Sensor',
        properties: 'temperature, humidity, status',
        cid: null,
        error: null,
    },
    zanState: {
        object: 'doc:smart_contract_spec',
        relation: 'editor',
        subject: '',
        encodedCalldata: null,
    },
    didState: {
        keyTier: 'QuantumReady',
        encodedPayload: null,
    },
    error: null,
};

export const debuggerMachine = setup({
    types: {
        context: {} as DebuggerContext,
        events: {} as DebuggerEvent,
    },
    actions: {
        setInput: assign({
            inputPayload: ({ event }) => (event.type === 'SET_INPUT' ? event.payload : ''),
            targetAddress: ({ context, event }) =>
                event.type === 'SET_INPUT' && event.target ? event.target : context.targetAddress,
            valueWei: ({ context, event }) =>
                event.type === 'SET_INPUT' && event.value ? event.value : context.valueWei,
            error: () => null,
        }),
        loadPreset: assign({
            inputPayload: ({ event }) => {
                if (event.type !== 'LOAD_PRESET') return '';
                switch (event.preset) {
                    case 'pq_block':
                        return '{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Post-Quantum security required. Address has no registered DID and ALLOW_LEGACY is false."}}';
                    case 'pq_wrap':
                        return '0x814100000000000000000000000000000000000000000003' + '11'.repeat(32) + '22'.repeat(32) + '1b' + '33'.repeat(3309) + 'bfe671c00000000000000000000000000000000000000000000000000000000000000020';
                    case 'zanzibar': {
                        const addr = event.connectedAddress || '0x0000000000000000000000000000000000000000';
                        return JSON.stringify({
                            jsonrpc: '2.0',
                            method: 'eth_call',
                            params: [{
                                to: '0x0000000000000000000000000000000000000061',
                                data: '0x9586e679' + '00'.repeat(32),
                                from: addr,
                            }],
                            id: 1,
                        }, null, 2);
                    }
                    case 'verkle':
                        return '{"jsonrpc":"2.0","id":1,"error":{"code":-32003,"message":"Receive verification failed: Invalid Verkle proof"}}';
                }
            },
            targetAddress: ({ event }) => {
                if (event.type === 'LOAD_PRESET' && event.preset === 'zanzibar') {
                    return '0x0000000000000000000000000000000000000061';
                }
                return '0x0000000000000000000000000000000000000003';
            },
            error: () => null,
        }),
        clearState: assign({
            inputPayload: () => '',
            analysisResult: () => null,
            simulationResult: () => null,
            dispatchResult: () => null,
            error: () => null,
        }),
        setAnalysisSuccess: assign({
            analysisResult: ({ event }) => (event.type === 'ANALYZE_SUCCESS' ? event.result : null),
            targetAddress: ({ context, event }) =>
                event.type === 'ANALYZE_SUCCESS' && event.result.targetAddress
                    ? event.result.targetAddress
                    : context.targetAddress,
            error: () => null,
        }),
        setAnalysisFailure: assign({
            error: ({ event }) => (event.type === 'ANALYZE_FAILURE' ? event.error : 'Analysis failed'),
        }),
        setDispatchConfig: assign({
            targetAddress: ({ context, event }) =>
                event.type === 'SET_DISPATCH_CONFIG' && event.target ? event.target : context.targetAddress,
            valueWei: ({ context, event }) =>
                event.type === 'SET_DISPATCH_CONFIG' && event.valueWei ? event.valueWei : context.valueWei,
            execMode: ({ context, event }) =>
                event.type === 'SET_DISPATCH_CONFIG' && event.execMode ? event.execMode : context.execMode,
        }),
        setSimulateSuccess: assign({
            simulationResult: ({ event }) =>
                event.type === 'SIMULATE_SUCCESS' ? { success: true, output: event.output } : null,
            error: () => null,
        }),
        setSimulateFailure: assign({
            simulationResult: ({ event }) =>
                event.type === 'SIMULATE_FAILURE' ? { success: false, output: event.error } : null,
            error: ({ event }) => (event.type === 'SIMULATE_FAILURE' ? event.error : null),
        }),
        setDispatchSuccess: assign({
            dispatchResult: ({ event }) =>
                event.type === 'DISPATCH_SUCCESS'
                    ? { success: true, txHash: event.txHash, message: event.message }
                    : null,
            error: () => null,
        }),
        setDispatchFailure: assign({
            dispatchResult: ({ event }) =>
                event.type === 'DISPATCH_FAILURE'
                    ? { success: false, message: event.error }
                    : null,
            error: ({ event }) => (event.type === 'DISPATCH_FAILURE' ? event.error : null),
        }),
        setWotConfig: assign({
            wotState: ({ context, event }) => {
                if (event.type !== 'SET_WOT_CONFIG') return context.wotState;
                return {
                    ...context.wotState,
                    title: event.title !== undefined ? event.title : context.wotState.title,
                    properties: event.properties !== undefined ? event.properties : context.wotState.properties,
                };
            },
        }),
        setWotGenerated: assign({
            wotState: ({ context, event }) => {
                if (event.type !== 'WOT_GENERATED') return context.wotState;
                return {
                    ...context.wotState,
                    cid: event.cid,
                    error: event.error,
                };
            },
        }),
        setZanzibarConfig: assign({
            zanState: ({ context, event }) => {
                if (event.type !== 'SET_ZANZIBAR_CONFIG') return context.zanState;
                return {
                    ...context.zanState,
                    object: event.object !== undefined ? event.object : context.zanState.object,
                    relation: event.relation !== undefined ? event.relation : context.zanState.relation,
                    subject: event.subject !== undefined ? event.subject : context.zanState.subject,
                };
            },
        }),
        setZanzibarEncoded: assign({
            zanState: ({ context, event }) => {
                if (event.type !== 'ZANZIBAR_ENCODED') return context.zanState;
                return {
                    ...context.zanState,
                    encodedCalldata: event.calldata,
                };
            },
            inputPayload: ({ event }) => (event.type === 'ZANZIBAR_ENCODED' ? event.calldata : ''),
            targetAddress: () => '0x0000000000000000000000000000000000000061',
        }),
        setDidConfig: assign({
            didState: ({ context, event }) => {
                if (event.type !== 'SET_DID_CONFIG') return context.didState;
                return {
                    ...context.didState,
                    keyTier: event.keyTier !== undefined ? event.keyTier : context.didState.keyTier,
                };
            },
        }),
        setDidEncoded: assign({
            didState: ({ context, event }) => {
                if (event.type !== 'DID_ENCODED') return context.didState;
                return {
                    ...context.didState,
                    encodedPayload: event.payload,
                };
            },
            inputPayload: ({ event }) => (event.type === 'DID_ENCODED' ? event.payload : ''),
            targetAddress: () => '0x0000000000000000000000000000000000000003',
        }),
    },
}).createMachine({
    id: 'debugger',
    initial: 'idle',
    context: initialDebuggerContext,
    states: {
        idle: {
            on: {
                SET_INPUT: { actions: 'setInput' },
                LOAD_PRESET: { actions: 'loadPreset' },
                CLEAR: { actions: 'clearState' },
                ANALYZE: { target: 'analyzing' },
                ANALYZE_SUCCESS: { actions: 'setAnalysisSuccess' },
                ANALYZE_FAILURE: { actions: 'setAnalysisFailure' },
                SET_DISPATCH_CONFIG: { actions: 'setDispatchConfig' },
                SIMULATE_START: { target: 'simulating' },
                DISPATCH_START: { target: 'dispatching' },
                SET_WOT_CONFIG: { actions: 'setWotConfig' },
                WOT_GENERATED: { actions: 'setWotGenerated' },
                SET_ZANZIBAR_CONFIG: { actions: 'setZanzibarConfig' },
                ZANZIBAR_ENCODED: { actions: 'setZanzibarEncoded' },
                SET_DID_CONFIG: { actions: 'setDidConfig' },
                DID_ENCODED: { actions: 'setDidEncoded' },
            },
        },
        analyzing: {
            on: {
                ANALYZE_SUCCESS: {
                    target: 'idle',
                    actions: 'setAnalysisSuccess',
                },
                ANALYZE_FAILURE: {
                    target: 'idle',
                    actions: 'setAnalysisFailure',
                },
            },
        },
        simulating: {
            on: {
                SIMULATE_SUCCESS: {
                    target: 'idle',
                    actions: 'setSimulateSuccess',
                },
                SIMULATE_FAILURE: {
                    target: 'idle',
                    actions: 'setSimulateFailure',
                },
            },
        },
        dispatching: {
            on: {
                DISPATCH_SUCCESS: {
                    target: 'idle',
                    actions: 'setDispatchSuccess',
                },
                DISPATCH_FAILURE: {
                    target: 'idle',
                    actions: 'setDispatchFailure',
                },
            },
        },
    },
});

export function createDebuggerActor(initialCtx?: Partial<DebuggerContext>) {
    return createActor(debuggerMachine, {
        input: initialCtx,
    });
}
