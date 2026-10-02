import { setup, assign, createActor, ActorRefFrom } from 'xstate';

export interface DecryptedNote {
    commitment: string;
    assetId: string;
    amount: bigint;
    sender: string;
    recipient: string;
    targetSlot?: number;
    payload?: string;
    isShielded: boolean;
    viewTag?: number;
    decayEpoch?: number;
    clawbackEpoch?: number;
    status: 'unspent' | 'absorbed' | 'clawback_pending' | 'evaporated';
}

export interface NoteInboxContext {
    address: string;
    viewingKey: string | null;
    notes: DecryptedNote[];
    selectedCommitment: string | null;
    error: string | null;
}

export type NoteInboxState = 'idle' | 'scanning' | 'decrypting' | 'displaying' | 'clawback_pending';

export type NoteInboxEvent =
    | { type: 'SET_ADDRESS'; address: string }
    | { type: 'SET_VIEWING_KEY'; viewingKey: string }
    | { type: 'CLEAR_VIEWING_KEY' }
    | { type: 'SCAN' }
    | { type: 'SCAN_COMPLETE'; notes: DecryptedNote[] }
    | { type: 'SCAN_FAIL'; error: string }
    | { type: 'DECRYPT_NOTE'; commitment: string }
    | { type: 'DECRYPT_SUCCESS'; note: DecryptedNote }
    | { type: 'DECRYPT_FAIL'; error: string }
    | { type: 'SELECT_NOTE'; commitment: string | null }
    | { type: 'ABSORB_NOTE'; commitment: string }
    | { type: 'RECLAIM_NOTE'; commitment: string }
    | { type: 'INITIATE_CLAWBACK'; commitment: string }
    | { type: 'CLAWBACK_COMPLETE'; commitment: string }
    | { type: 'CANCEL_CLAWBACK'; commitment: string }
    | { type: 'EVAPORATE_NOTE'; commitment: string }
    | { type: 'CLEAR' };

export const initialNoteInboxContext: NoteInboxContext = {
    address: '',
    viewingKey: null,
    notes: [],
    selectedCommitment: null,
    error: null,
};

export const noteInboxMachine = setup({
    types: {
        context: {} as NoteInboxContext,
        events: {} as NoteInboxEvent,
    },
    actions: {
        setAddress: assign({
            address: ({ event }) => (event.type === 'SET_ADDRESS' ? event.address : ''),
        }),
        setViewingKey: assign({
            viewingKey: ({ event }) => (event.type === 'SET_VIEWING_KEY' ? event.viewingKey : null),
            error: () => null,
        }),
        clearViewingKey: assign({
            viewingKey: () => null,
        }),
        setNotes: assign({
            notes: ({ event }) => (event.type === 'SCAN_COMPLETE' ? event.notes : []),
            error: () => null,
        }),
        setError: assign({
            error: ({ event }) => {
                if (event.type === 'SCAN_FAIL') return event.error;
                if (event.type === 'DECRYPT_FAIL') return event.error;
                return 'Note inbox error';
            },
        }),
        setSelectedCommitment: assign({
            selectedCommitment: ({ event }) => (event.type === 'SELECT_NOTE' ? event.commitment : null),
        }),
        updateNoteDecrypted: assign({
            notes: ({ context, event }) => {
                if (event.type !== 'DECRYPT_SUCCESS') return context.notes;
                return context.notes.map((n) => (n.commitment === event.note.commitment ? event.note : n));
            },
            error: () => null,
        }),
        markAbsorbed: assign({
            notes: ({ context, event }) => {
                if (event.type !== 'ABSORB_NOTE') return context.notes;
                return context.notes.map((n) =>
                    n.commitment === event.commitment ? { ...n, status: 'absorbed' as const } : n
                );
            },
        }),
        markReclaimed: assign({
            notes: ({ context, event }) => {
                if (event.type !== 'RECLAIM_NOTE') return context.notes;
                return context.notes.map((n) =>
                    n.commitment === event.commitment ? { ...n, status: 'absorbed' as const } : n
                );
            },
        }),
        markClawbackPending: assign({
            notes: ({ context, event }) => {
                if (event.type !== 'INITIATE_CLAWBACK') return context.notes;
                return context.notes.map((n) =>
                    n.commitment === event.commitment ? { ...n, status: 'clawback_pending' as const } : n
                );
            },
            selectedCommitment: ({ event }) => (event.type === 'INITIATE_CLAWBACK' ? event.commitment : null),
        }),
        markClawbackDone: assign({
            notes: ({ context, event }) => {
                if (event.type !== 'CLAWBACK_COMPLETE') return context.notes;
                return context.notes.map((n) =>
                    n.commitment === event.commitment ? { ...n, status: 'evaporated' as const } : n
                );
            },
        }),
        markClawbackCancelled: assign({
            notes: ({ context, event }) => {
                if (event.type !== 'CANCEL_CLAWBACK') return context.notes;
                return context.notes.map((n) =>
                    n.commitment === event.commitment ? { ...n, status: 'unspent' as const } : n
                );
            },
        }),
        markEvaporated: assign({
            notes: ({ context, event }) => {
                if (event.type !== 'EVAPORATE_NOTE') return context.notes;
                return context.notes.map((n) =>
                    n.commitment === event.commitment ? { ...n, status: 'evaporated' as const } : n
                );
            },
        }),
        clearAll: assign({
            notes: () => [],
            selectedCommitment: () => null,
            error: () => null,
        }),
    },
}).createMachine({
    id: 'noteInbox',
    initial: 'idle',
    context: initialNoteInboxContext,
    states: {
        idle: {
            on: {
                SET_ADDRESS: { actions: 'setAddress' },
                SET_VIEWING_KEY: { target: 'scanning', actions: 'setViewingKey' },
                CLEAR_VIEWING_KEY: { actions: 'clearViewingKey' },
                SCAN: { target: 'scanning' },
                SELECT_NOTE: { actions: 'setSelectedCommitment' },
            },
        },
        scanning: {
            on: {
                SCAN_COMPLETE: { target: 'displaying', actions: 'setNotes' },
                SCAN_FAIL: { target: 'idle', actions: 'setError' },
                DECRYPT_NOTE: { target: 'decrypting' },
            },
        },
        decrypting: {
            on: {
                DECRYPT_SUCCESS: { target: 'displaying', actions: 'updateNoteDecrypted' },
                DECRYPT_FAIL: { target: 'displaying', actions: 'setError' },
            },
        },
        displaying: {
            on: {
                SET_ADDRESS: { actions: 'setAddress' },
                SET_VIEWING_KEY: { target: 'scanning', actions: 'setViewingKey' },
                CLEAR_VIEWING_KEY: { actions: 'clearViewingKey' },
                SCAN: { target: 'scanning' },
                DECRYPT_NOTE: { target: 'decrypting' },
                SELECT_NOTE: { actions: 'setSelectedCommitment' },
                ABSORB_NOTE: { actions: 'markAbsorbed' },
                RECLAIM_NOTE: { actions: 'markReclaimed' },
                INITIATE_CLAWBACK: { target: 'clawback_pending', actions: 'markClawbackPending' },
                EVAPORATE_NOTE: { actions: 'markEvaporated' },
                CLEAR: { target: 'idle', actions: 'clearAll' },
            },
        },
        clawback_pending: {
            on: {
                ABSORB_NOTE: { target: 'displaying', actions: 'markAbsorbed' },
                CLAWBACK_COMPLETE: { target: 'displaying', actions: 'markClawbackDone' },
                CANCEL_CLAWBACK: { target: 'displaying', actions: 'markClawbackCancelled' },
                SELECT_NOTE: { actions: 'setSelectedCommitment' },
            },
        },
    },
});

export type NoteInboxMachine = typeof noteInboxMachine;
export type NoteInboxActor = ActorRefFrom<typeof noteInboxMachine>;

export function createNoteInboxMachineActor(context?: Partial<NoteInboxContext>): NoteInboxActor {
    return createActor(noteInboxMachine, {
        input: context ? { ...initialNoteInboxContext, ...context } : initialNoteInboxContext,
    });
}
