import { setup, assign, createActor } from 'xstate';

export interface ZodiacDaoContext {
    daoAddress: string;
    daoId: string;
    owner: string;
    avatar: string;
    roles: Array<{ relationId: number; name: string; member: string }>;
    dataRefs: Array<{ datasetId: string; blake3Root: string; sizeBytes: number; namespace: string }>;
    error: string | null;
}

export type ZodiacDaoState = 'idle' | 'loading' | 'ready' | 'executing' | 'pinning' | 'error';

export type ZodiacDaoEvent =
    | { type: 'LOAD_DAO'; daoAddress: string }
    | { type: 'DAO_LOADED'; data: Partial<ZodiacDaoContext> }
    | { type: 'EXECUTE_ACTION'; target: string; value: string; calldata: string; witnessPath: any[] }
    | { type: 'ACTION_SUCCESS'; txHash: string }
    | { type: 'ACTION_FAILED'; error: string }
    | { type: 'PIN_DATAREF'; datasetId: string; blake3Root: string; sizeBytes: number; namespace: string }
    | { type: 'RESET' };

export const initialZodiacContext: ZodiacDaoContext = {
    daoAddress: '',
    daoId: '',
    owner: '',
    avatar: '',
    roles: [],
    dataRefs: [],
    error: null,
};

export const zodiacDaoMachine = setup({
    types: {
        context: {} as ZodiacDaoContext,
        events: {} as ZodiacDaoEvent,
    },
    actions: {
        setDaoAddress: assign({
            daoAddress: ({ event }) => (event.type === 'LOAD_DAO' ? event.daoAddress : ''),
            error: () => null,
        }),
        setDaoLoaded: assign({
            daoId: ({ context, event }) => (event.type === 'DAO_LOADED' && event.data.daoId !== undefined ? event.data.daoId : context.daoId),
            avatar: ({ context, event }) => (event.type === 'DAO_LOADED' && event.data.avatar !== undefined ? event.data.avatar : context.avatar),
            owner: ({ context, event }) => (event.type === 'DAO_LOADED' && event.data.owner !== undefined ? event.data.owner : context.owner),
            roles: ({ context, event }) => (event.type === 'DAO_LOADED' && event.data.roles ? event.data.roles : context.roles),
            dataRefs: ({ context, event }) => (event.type === 'DAO_LOADED' && event.data.dataRefs ? event.data.dataRefs : context.dataRefs),
            error: () => null,
        }),
        setError: assign({
            error: ({ event }) => (event.type === 'ACTION_FAILED' ? event.error : null),
        }),
        clearError: assign({
            error: () => null,
        }),
        appendDataRef: assign({
            dataRefs: ({ context, event }) => {
                if (event.type === 'PIN_DATAREF') {
                    return [
                        ...context.dataRefs,
                        {
                            datasetId: event.datasetId,
                            blake3Root: event.blake3Root,
                            sizeBytes: event.sizeBytes,
                            namespace: event.namespace,
                        },
                    ];
                }
                return context.dataRefs;
            },
        }),
    },
}).createMachine({
    id: 'zodiacDao',
    initial: 'idle',
    context: initialZodiacContext,
    states: {
        idle: {
            on: {
                LOAD_DAO: {
                    target: 'loading',
                    actions: 'setDaoAddress',
                },
            },
        },
        loading: {
            on: {
                DAO_LOADED: {
                    target: 'ready',
                    actions: 'setDaoLoaded',
                },
                ACTION_FAILED: {
                    target: 'error',
                    actions: 'setError',
                },
            },
        },
        ready: {
            on: {
                EXECUTE_ACTION: {
                    target: 'executing',
                },
                PIN_DATAREF: {
                    target: 'pinning',
                    actions: 'appendDataRef',
                },
            },
        },
        executing: {
            on: {
                ACTION_SUCCESS: {
                    target: 'ready',
                    actions: 'clearError',
                },
                ACTION_FAILED: {
                    target: 'error',
                    actions: 'setError',
                },
            },
        },
        pinning: {
            on: {
                ACTION_SUCCESS: {
                    target: 'ready',
                    actions: 'clearError',
                },
                ACTION_FAILED: {
                    target: 'error',
                    actions: 'setError',
                },
            },
        },
        error: {
            on: {
                RESET: {
                    target: 'ready',
                    actions: 'clearError',
                },
                LOAD_DAO: {
                    target: 'loading',
                    actions: 'setDaoAddress',
                },
            },
        },
    },
});

export class ZodiacDaoStateMachine {
    private actor = createActor(zodiacDaoMachine);

    constructor() {
        this.actor.start();
    }

    getSnapshot(): { value: ZodiacDaoState; context: ZodiacDaoContext } {
        const snap = this.actor.getSnapshot();
        return {
            value: snap.value as ZodiacDaoState,
            context: snap.context,
        };
    }

    subscribe(callback: (snapshot: { value: ZodiacDaoState; context: ZodiacDaoContext }) => void): () => void {
        const sub = this.actor.subscribe((snap) => {
            callback({
                value: snap.value as ZodiacDaoState,
                context: snap.context,
            });
        });
        return () => sub.unsubscribe();
    }

    send(event: ZodiacDaoEvent): void {
        this.actor.send(event);
    }
}
