import { setup, assign, createActor } from 'xstate';

export interface SovereignTransaction {
    hash: string;
    from: string;
    to: string;
    value: string;
    timestamp: number;
    status: 'success' | 'failed' | 'pending';
    type?: string;
}

export interface TxHistoryContext {
    address: string;
    filter: 'all' | 'sent' | 'received';
    transactions: SovereignTransaction[];
    error: string | null;
}

export type TxHistoryState = 'idle' | 'loading' | 'ready';

export type TxHistoryEvent =
    | { type: 'LOAD'; address: string }
    | { type: 'LOAD_SUCCESS'; transactions: SovereignTransaction[] }
    | { type: 'LOAD_FAIL'; error: string }
    | { type: 'SET_FILTER'; filter: 'all' | 'sent' | 'received' }
    | { type: 'RECORD_TX'; tx: SovereignTransaction };

export const initialTxHistoryContext: TxHistoryContext = {
    address: '',
    filter: 'all',
    transactions: [],
    error: null,
};

export const txHistoryMachine = setup({
    types: {
        context: {} as TxHistoryContext,
        events: {} as TxHistoryEvent,
    },
    actions: {
        setLoading: assign({
            address: ({ event }) => (event.type === 'LOAD' ? event.address : ''),
            error: () => null,
        }),
        setLoaded: assign({
            transactions: ({ event }) => (event.type === 'LOAD_SUCCESS' ? event.transactions : []),
            error: () => null,
        }),
        setError: assign({
            error: ({ event }) => (event.type === 'LOAD_FAIL' ? event.error : 'Failed to load txs'),
        }),
        setFilter: assign({
            filter: ({ event }) => (event.type === 'SET_FILTER' ? event.filter : 'all'),
        }),
        recordTransaction: assign({
            transactions: ({ context, event }) => {
                if (event.type === 'RECORD_TX') {
                    return [event.tx, ...context.transactions];
                }
                return context.transactions;
            },
        }),
    },
}).createMachine({
    id: 'txHistory',
    initial: 'idle',
    context: initialTxHistoryContext,
    states: {
        idle: {
            on: {
                LOAD: {
                    target: 'loading',
                    actions: 'setLoading',
                },
                SET_FILTER: {
                    actions: 'setFilter',
                },
                RECORD_TX: {
                    actions: 'recordTransaction',
                },
            },
        },
        loading: {
            on: {
                LOAD_SUCCESS: {
                    target: 'ready',
                    actions: 'setLoaded',
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
                    target: 'loading',
                    actions: 'setLoading',
                },
                SET_FILTER: {
                    actions: 'setFilter',
                },
                RECORD_TX: {
                    actions: 'recordTransaction',
                },
            },
        },
    },
});

export class TxHistoryStateMachine {
    private actor = createActor(txHistoryMachine);

    constructor() {
        this.actor.start();
    }

    getSnapshot(): { value: TxHistoryState; context: TxHistoryContext } {
        const snap = this.actor.getSnapshot();
        return {
            value: snap.value as TxHistoryState,
            context: snap.context,
        };
    }

    subscribe(callback: (snapshot: { value: TxHistoryState; context: TxHistoryContext }) => void): () => void {
        const sub = this.actor.subscribe((snap) => {
            callback({
                value: snap.value as TxHistoryState,
                context: snap.context,
            });
        });
        return () => sub.unsubscribe();
    }

    send(event: TxHistoryEvent): void {
        this.actor.send(event);
    }

    stop(): void {
        this.actor.stop();
    }
}
