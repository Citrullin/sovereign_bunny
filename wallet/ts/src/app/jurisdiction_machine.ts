import { setup, assign, createActor } from 'xstate';

export interface JurisdictionContext {
    address: string;
    jurisdiction: string;
    compliant: boolean;
    activeBits: bigint;
    mandate: string;
    lotlRoot: string;
    allowLegacy: boolean;
    isQuantumSecure: boolean;
    error: string | null;
}

export type JurisdictionState = 'idle' | 'loading' | 'ready' | 'submitting' | 'done' | 'error';

export type JurisdictionEvent =
    | { type: 'LOAD'; address: string; jurisdiction?: string }
    | {
          type: 'LOAD_SUCCESS';
          compliant: boolean;
          activeBits: bigint;
          lotlRoot: string;
          allowLegacy?: boolean;
          isQuantumSecure?: boolean;
      }
    | { type: 'SUBMIT_PREDICATE'; predicateId: number; zkProof: string }
    | { type: 'SUBMIT_SUCCESS'; compliant: boolean }
    | { type: 'FAIL'; error: string }
    | { type: 'SET_ALLOW_LEGACY'; allow: boolean }
    | { type: 'RESET' };

export const initialJurisdictionContext: JurisdictionContext = {
    address: '',
    jurisdiction: 'EU (eIDAS / BaFin)',
    compliant: false,
    activeBits: 0n,
    mandate: 'MiCA / FinFRG Tier-2 Gate',
    lotlRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
    allowLegacy: false,
    isQuantumSecure: true,
    error: null,
};

export const jurisdictionMachine = setup({
    types: {
        context: {} as JurisdictionContext,
        events: {} as JurisdictionEvent,
    },
    actions: {
        setLoading: assign({
            address: ({ event }) => (event.type === 'LOAD' ? event.address : ''),
            jurisdiction: ({ context, event }) =>
                event.type === 'LOAD' && event.jurisdiction ? event.jurisdiction : context.jurisdiction,
            error: () => null,
        }),
        setLoaded: assign({
            compliant: ({ event }) => (event.type === 'LOAD_SUCCESS' ? event.compliant : false),
            activeBits: ({ event }) => (event.type === 'LOAD_SUCCESS' ? event.activeBits : 0n),
            lotlRoot: ({ event }) => (event.type === 'LOAD_SUCCESS' ? event.lotlRoot : ''),
            allowLegacy: ({ context, event }) =>
                event.type === 'LOAD_SUCCESS' && event.allowLegacy !== undefined
                    ? event.allowLegacy
                    : context.allowLegacy,
            isQuantumSecure: ({ context, event }) =>
                event.type === 'LOAD_SUCCESS' && event.isQuantumSecure !== undefined
                    ? event.isQuantumSecure
                    : context.isQuantumSecure,
            error: () => null,
        }),
        setSubmitting: assign({
            error: () => null,
        }),
        setSubmitted: assign({
            compliant: ({ event }) => (event.type === 'SUBMIT_SUCCESS' ? event.compliant : false),
            error: () => null,
        }),
        setAllowLegacyAction: assign({
            allowLegacy: ({ event }) => (event.type === 'SET_ALLOW_LEGACY' ? event.allow : false),
            isQuantumSecure: ({ event }) => (event.type === 'SET_ALLOW_LEGACY' ? !event.allow : true),
        }),
        setError: assign({
            error: ({ event }) => (event.type === 'FAIL' ? event.error : 'Jurisdiction error'),
        }),
        resetContext: assign(() => ({ ...initialJurisdictionContext })),
    },
}).createMachine({
    id: 'jurisdiction',
    initial: 'idle',
    context: initialJurisdictionContext,
    states: {
        idle: {
            on: {
                LOAD: {
                    target: 'loading',
                    actions: 'setLoading',
                },
                RESET: {
                    actions: 'resetContext',
                },
            },
        },
        loading: {
            on: {
                LOAD_SUCCESS: {
                    target: 'ready',
                    actions: 'setLoaded',
                },
                FAIL: {
                    target: 'error',
                    actions: 'setError',
                },
            },
        },
        ready: {
            on: {
                SUBMIT_PREDICATE: {
                    target: 'submitting',
                    actions: 'setSubmitting',
                },
                SET_ALLOW_LEGACY: {
                    actions: 'setAllowLegacyAction',
                },
                LOAD: {
                    target: 'loading',
                    actions: 'setLoading',
                },
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
            },
        },
        submitting: {
            on: {
                SUBMIT_SUCCESS: {
                    target: 'done',
                    actions: 'setSubmitted',
                },
                FAIL: {
                    target: 'error',
                    actions: 'setError',
                },
            },
        },
        done: {
            on: {
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
                LOAD: {
                    target: 'loading',
                    actions: 'setLoading',
                },
            },
        },
        error: {
            on: {
                LOAD: {
                    target: 'loading',
                    actions: 'setLoading',
                },
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
            },
        },
    },
});

export class JurisdictionStateMachine {
    private actor = createActor(jurisdictionMachine);

    constructor() {
        this.actor.start();
    }

    getSnapshot(): { value: JurisdictionState; context: JurisdictionContext } {
        const snap = this.actor.getSnapshot();
        return {
            value: snap.value as JurisdictionState,
            context: snap.context,
        };
    }

    subscribe(callback: (snapshot: { value: JurisdictionState; context: JurisdictionContext }) => void): () => void {
        const sub = this.actor.subscribe((snap) => {
            callback({
                value: snap.value as JurisdictionState,
                context: snap.context,
            });
        });
        return () => sub.unsubscribe();
    }

    send(event: JurisdictionEvent): void {
        this.actor.send(event);
    }

    stop(): void {
        this.actor.stop();
    }
}
