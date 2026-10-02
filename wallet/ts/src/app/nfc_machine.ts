import { setup, assign, createActor } from 'xstate';

export interface NfcContext {
    tagType: 'ntag216' | 'ntag424_dna' | null;
    model: 1 | 2 | 3 | null;
    tagData: any | null;
    nullifier: string | null;
    recipientAddress: string | null;
    error: string | null;
}

export type NfcState = 'idle' | 'scanning' | 'tag_read' | 'verifying_proof' | 'absorbing' | 'done' | 'error';

export type NfcEvent =
    | { type: 'START_SCAN' }
    | { type: 'TAG_DETECTED'; model: 1 | 2 | 3; payload: any; tagType?: 'ntag216' | 'ntag424_dna' }
    | { type: 'VERIFY_PROOF'; pin?: string }
    | { type: 'PROOF_VERIFIED'; nullifier?: string }
    | { type: 'ABSORB'; recipientAddress: string }
    | { type: 'ABSORB_SUCCESS' }
    | { type: 'FAIL'; error: string }
    | { type: 'RESET' };

export const initialNfcContext: NfcContext = {
    tagType: null,
    model: null,
    tagData: null,
    nullifier: null,
    recipientAddress: null,
    error: null,
};

export const nfcMachine = setup({
    types: {
        context: {} as NfcContext,
        events: {} as NfcEvent,
    },
    actions: {
        setScanning: assign({
            error: () => null,
        }),
        setTagRead: assign({
            model: ({ event }) => (event.type === 'TAG_DETECTED' ? event.model : null),
            tagData: ({ event }) => (event.type === 'TAG_DETECTED' ? event.payload : null),
            tagType: ({ event }) => (event.type === 'TAG_DETECTED' && event.tagType ? event.tagType : 'ntag424_dna'),
            error: () => null,
        }),
        setProofVerified: assign({
            nullifier: ({ event }) => (event.type === 'PROOF_VERIFIED' && event.nullifier ? event.nullifier : null),
            error: () => null,
        }),
        setAbsorbing: assign({
            recipientAddress: ({ event }) => (event.type === 'ABSORB' ? event.recipientAddress : null),
            error: () => null,
        }),
        setError: assign({
            error: ({ event }) => (event.type === 'FAIL' ? event.error : 'NFC operation failed'),
        }),
        resetContext: assign(() => ({ ...initialNfcContext })),
    },
}).createMachine({
    id: 'nfc',
    initial: 'idle',
    context: initialNfcContext,
    states: {
        idle: {
            on: {
                START_SCAN: {
                    target: 'scanning',
                    actions: 'setScanning',
                },
                RESET: {
                    actions: 'resetContext',
                },
            },
        },
        scanning: {
            on: {
                TAG_DETECTED: {
                    target: 'tag_read',
                    actions: 'setTagRead',
                },
                FAIL: {
                    target: 'error',
                    actions: 'setError',
                },
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
            },
        },
        tag_read: {
            on: {
                VERIFY_PROOF: {
                    target: 'verifying_proof',
                },
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
            },
        },
        verifying_proof: {
            on: {
                PROOF_VERIFIED: {
                    target: 'absorbing',
                    actions: 'setProofVerified',
                },
                FAIL: {
                    target: 'error',
                    actions: 'setError',
                },
            },
        },
        absorbing: {
            on: {
                ABSORB: {
                    actions: 'setAbsorbing',
                },
                ABSORB_SUCCESS: {
                    target: 'done',
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
            },
        },
        error: {
            on: {
                START_SCAN: {
                    target: 'scanning',
                    actions: 'setScanning',
                },
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
            },
        },
    },
});

export class NfcStateMachine {
    private actor = createActor(nfcMachine);

    constructor() {
        this.actor.start();
    }

    getSnapshot(): { value: NfcState; context: NfcContext } {
        const snap = this.actor.getSnapshot();
        return {
            value: snap.value as NfcState,
            context: snap.context,
        };
    }

    subscribe(callback: (snapshot: { value: NfcState; context: NfcContext }) => void): () => void {
        const sub = this.actor.subscribe((snap) => {
            callback({
                value: snap.value as NfcState,
                context: snap.context,
            });
        });
        return () => sub.unsubscribe();
    }

    send(event: NfcEvent): void {
        this.actor.send(event);
    }

    stop(): void {
        this.actor.stop();
    }
}
