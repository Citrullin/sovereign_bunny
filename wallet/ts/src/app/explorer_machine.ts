import { setup, assign, createActor } from 'xstate';
import type { GraphData } from '../components/graph_explorer.js';
import type { NetworkStats } from '../components/public_explorer.js';

export interface AccountLatticeMetrics {
    account: string;
    accountHeight: bigint;
    consensusEpoch: number;
    autoReclaimTimeout: number;
    consensusModel: string;
}

export interface ExplorerContext {
    rpcUrl: string;
    targetAddress: string;
    networkStats: NetworkStats | null;
    accountMetrics: AccountLatticeMetrics | null;
    graphData: GraphData | null;
    error: string | null;
}

export type ExplorerState = 'idle' | 'loading_metrics' | 'loading_graph' | 'ready';

export type ExplorerEvent =
    | { type: 'LOAD'; rpcUrl?: string; address?: string }
    | { type: 'METRICS_LOADED'; stats: NetworkStats; metrics?: AccountLatticeMetrics }
    | { type: 'GRAPH_LOADED'; graph: GraphData }
    | { type: 'LOAD_FAIL'; error: string }
    | { type: 'SELECT_ADDRESS'; address: string }
    | { type: 'RESET' };

export const initialExplorerContext: ExplorerContext = {
    rpcUrl: '/rpc',
    targetAddress: '0x0000000000000000000000000000000000000000',
    networkStats: null,
    accountMetrics: null,
    graphData: null,
    error: null,
};

export const explorerMachine = setup({
    types: {
        context: {} as ExplorerContext,
        events: {} as ExplorerEvent,
    },
    actions: {
        initiateLoading: assign({
            rpcUrl: ({ context, event }) => (event.type === 'LOAD' && event.rpcUrl ? event.rpcUrl : context.rpcUrl),
            targetAddress: ({ context, event }) =>
                event.type === 'LOAD' && event.address ? event.address : context.targetAddress,
            error: () => null,
        }),
        applyMetrics: assign({
            networkStats: ({ event }) => (event.type === 'METRICS_LOADED' ? event.stats : null),
            accountMetrics: ({ event }) => (event.type === 'METRICS_LOADED' && event.metrics ? event.metrics : null),
            error: () => null,
        }),
        applyGraph: assign({
            graphData: ({ event }) => (event.type === 'GRAPH_LOADED' ? event.graph : null),
            error: () => null,
        }),
        setError: assign({
            error: ({ event }) => (event.type === 'LOAD_FAIL' ? event.error : 'Explorer error'),
        }),
        updateTargetAddress: assign({
            targetAddress: ({ event }) => (event.type === 'SELECT_ADDRESS' ? event.address : ''),
        }),
        resetContext: assign(() => ({ ...initialExplorerContext })),
    },
}).createMachine({
    id: 'explorer',
    initial: 'idle',
    context: initialExplorerContext,
    states: {
        idle: {
            on: {
                LOAD: {
                    target: 'loading_metrics',
                    actions: 'initiateLoading',
                },
                SELECT_ADDRESS: {
                    actions: 'updateTargetAddress',
                },
            },
        },
        loading_metrics: {
            on: {
                METRICS_LOADED: {
                    target: 'loading_graph',
                    actions: 'applyMetrics',
                },
                LOAD_FAIL: {
                    target: 'idle',
                    actions: 'setError',
                },
            },
        },
        loading_graph: {
            on: {
                GRAPH_LOADED: {
                    target: 'ready',
                    actions: 'applyGraph',
                },
                LOAD_FAIL: {
                    target: 'ready',
                    actions: 'setError',
                },
            },
        },
        ready: {
            on: {
                LOAD: {
                    target: 'loading_metrics',
                    actions: 'initiateLoading',
                },
                SELECT_ADDRESS: {
                    actions: 'updateTargetAddress',
                },
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
            },
        },
    },
});

export class ExplorerStateMachine {
    private actor = createActor(explorerMachine);

    constructor() {
        this.actor.start();
    }

    getSnapshot(): { value: ExplorerState; context: ExplorerContext } {
        const snap = this.actor.getSnapshot();
        return {
            value: snap.value as ExplorerState,
            context: snap.context,
        };
    }

    subscribe(callback: (snapshot: { value: ExplorerState; context: ExplorerContext }) => void): () => void {
        const sub = this.actor.subscribe((snap) => {
            callback({
                value: snap.value as ExplorerState,
                context: snap.context,
            });
        });
        return () => sub.unsubscribe();
    }

    send(event: ExplorerEvent): void {
        this.actor.send(event);
    }

    stop(): void {
        this.actor.stop();
    }
}
