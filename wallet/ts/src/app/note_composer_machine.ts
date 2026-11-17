import { setup, assign, createActor, ActorRefFrom } from 'xstate';

export interface NoteComposerContext {
    sender: string;
    recipient: string;
    amount: bigint;
    assetId: string;
    targetSlot: number;
    payload: string;
    isShielded: boolean;
    commitment: string | null;
    txHash: string | null;
    error: string | null;
}

export type NoteComposerState = 'composing' | 'committing' | 'committed' | 'error';

export type NoteComposerEvent =
    | { type: 'SET_SENDER'; sender: string }
    | { type: 'SET_RECIPIENT'; recipient: string }
    | { type: 'SET_AMOUNT'; amount: bigint }
    | { type: 'SET_ASSET'; assetId: string }
    | { type: 'SET_SLOT'; targetSlot: number }
    | { type: 'SET_PAYLOAD'; payload: string }
    | { type: 'SET_SHIELDED'; isShielded: boolean }
    | { type: 'PREPARE_COMMIT' }
    | { type: 'COMMIT_SUCCESS'; commitment: string; txHash: string }
    | { type: 'COMMIT_FAIL'; error: string }
    | { type: 'RETRY' }
    | { type: 'RESET' };

export const initialNoteComposerContext: NoteComposerContext = {
    sender: '',
    recipient: '',
    amount: 0n,
    assetId: 'TBL',
    targetSlot: 0,
    payload: '',
    isShielded: false,
    commitment: null,
    txHash: null,
    error: null,
};

export const noteComposerMachine = setup({
    types: {
        context: {} as NoteComposerContext,
        events: {} as NoteComposerEvent,
    },
    actions: {
        setSender: assign({
            sender: ({ event }) => (event.type === 'SET_SENDER' ? event.sender : ''),
        }),
        setRecipient: assign({
            recipient: ({ event }) => (event.type === 'SET_RECIPIENT' ? event.recipient : ''),
        }),
        setAmount: assign({
            amount: ({ event }) => (event.type === 'SET_AMOUNT' ? event.amount : 0n),
        }),
        setAsset: assign({
            assetId: ({ event }) => (event.type === 'SET_ASSET' ? event.assetId : 'TBL'),
        }),
        setSlot: assign({
            targetSlot: ({ event }) => (event.type === 'SET_SLOT' ? event.targetSlot : 0),
        }),
        setPayload: assign({
            payload: ({ event }) => (event.type === 'SET_PAYLOAD' ? event.payload : ''),
        }),
        setShielded: assign({
            isShielded: ({ event }) => (event.type === 'SET_SHIELDED' ? event.isShielded : false),
        }),
        setCommitSuccess: assign({
            commitment: ({ event }) => (event.type === 'COMMIT_SUCCESS' ? event.commitment : null),
            txHash: ({ event }) => (event.type === 'COMMIT_SUCCESS' ? event.txHash : null),
            error: () => null,
        }),
        setCommitError: assign({
            error: ({ event }) => (event.type === 'COMMIT_FAIL' ? event.error : 'Failed to commit note'),
        }),
        resetForm: assign({
            recipient: () => '',
            amount: () => 0n,
            assetId: () => 'TBL',
            targetSlot: () => 0,
            payload: () => '',
            isShielded: () => false,
            commitment: () => null,
            txHash: () => null,
            error: () => null,
        }),
    },
}).createMachine({
    id: 'noteComposer',
    initial: 'composing',
    context: initialNoteComposerContext,
    states: {
        composing: {
            on: {
                SET_SENDER: { actions: 'setSender' },
                SET_RECIPIENT: { actions: 'setRecipient' },
                SET_AMOUNT: { actions: 'setAmount' },
                SET_ASSET: { actions: 'setAsset' },
                SET_SLOT: { actions: 'setSlot' },
                SET_PAYLOAD: { actions: 'setPayload' },
                SET_SHIELDED: { actions: 'setShielded' },
                PREPARE_COMMIT: { target: 'committing' },
                RESET: { actions: 'resetForm' },
            },
        },
        committing: {
            on: {
                COMMIT_SUCCESS: { target: 'committed', actions: 'setCommitSuccess' },
                COMMIT_FAIL: { target: 'error', actions: 'setCommitError' },
                RESET: { target: 'composing', actions: 'resetForm' },
            },
        },
        committed: {
            on: {
                RESET: { target: 'composing', actions: 'resetForm' },
            },
        },
        error: {
            on: {
                RETRY: { target: 'committing' },
                RESET: { target: 'composing', actions: 'resetForm' },
            },
        },
    },
});

export type NoteComposerMachine = typeof noteComposerMachine;
export type NoteComposerActor = ActorRefFrom<typeof noteComposerMachine>;

export function createNoteComposerMachineActor(context?: Partial<NoteComposerContext>): NoteComposerActor {
    return createActor(noteComposerMachine, {
        input: context ? { ...initialNoteComposerContext, ...context } : initialNoteComposerContext,
    });
}
