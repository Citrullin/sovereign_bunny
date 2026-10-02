import { setup, assign, createActor, ActorRefFrom } from 'xstate';
import { GraphData, GraphNode } from './graph_explorer.js';

export interface AuthorityCertStep {
    role: string;
    certHash: string;
    label: string;
}

export interface CourtOrderData {
    documentHash: string;
    targetAccount: string;
    mandate: string;
    issuedEpoch: number;
}

export interface AuthorityPanelContext {
    authorityId: string;
    authorityAddress: string;
    jurisdiction: string;
    courtOrder: CourtOrderData | null;
    certChain: AuthorityCertStep[];
    targetAccount: string;
    viewingKey: string | null;
    highlightedPath: string[];
    revealedNotes: Array<{ commitment: string; targetSlot: number; amount: string; decryptedPayload: any }>;
    error: string | null;
}

export type AuthorityPanelEvent =
    | {
          type: 'LOAD_AUTHORITY';
          authorityId: string;
          authorityAddress: string;
          jurisdiction: string;
          courtOrder: CourtOrderData | null;
          certChain: AuthorityCertStep[];
      }
    | { type: 'TRAVERSE_AUDIT_PATH'; sourceId: string; targetId: string; path: string[] }
    | { type: 'SUBMIT_DAO_CONFIRMATION'; daoAddress: string; approved: boolean }
    | { type: 'REVEAL_VIEWING_KEY'; viewingKey: string; notes: Array<{ commitment: string; targetSlot: number; amount: string; decryptedPayload: any }> }
    | { type: 'RESET' };

export const initialAuthorityContext: AuthorityPanelContext = {
    authorityId: '',
    authorityAddress: '',
    jurisdiction: 'Global',
    courtOrder: null,
    certChain: [],
    targetAccount: '',
    viewingKey: null,
    highlightedPath: [],
    revealedNotes: [],
    error: null,
};

export const authorityPanelMachine = setup({
    types: {
        context: {} as AuthorityPanelContext,
        events: {} as AuthorityPanelEvent,
    },
    actions: {
        setAuthorityLoaded: assign({
            authorityId: ({ event }) => (event.type === 'LOAD_AUTHORITY' ? event.authorityId : ''),
            authorityAddress: ({ event }) => (event.type === 'LOAD_AUTHORITY' ? event.authorityAddress : ''),
            jurisdiction: ({ event }) => (event.type === 'LOAD_AUTHORITY' ? event.jurisdiction : 'Global'),
            courtOrder: ({ event }) => (event.type === 'LOAD_AUTHORITY' ? event.courtOrder : null),
            certChain: ({ event }) => (event.type === 'LOAD_AUTHORITY' ? event.certChain : []),
            targetAccount: ({ event }) =>
                event.type === 'LOAD_AUTHORITY' && event.courtOrder ? event.courtOrder.targetAccount : '',
            highlightedPath: () => [],
            viewingKey: () => null,
            revealedNotes: () => [],
            error: () => null,
        }),
        setPathHighlighted: assign({
            highlightedPath: ({ event }) => (event.type === 'TRAVERSE_AUDIT_PATH' ? event.path : []),
        }),
        setRevealedViewingKey: assign({
            viewingKey: ({ event }) => (event.type === 'REVEAL_VIEWING_KEY' ? event.viewingKey : null),
            revealedNotes: ({ event }) => (event.type === 'REVEAL_VIEWING_KEY' ? event.notes : []),
        }),
        resetContext: assign({
            ...initialAuthorityContext,
        }),
    },
}).createMachine({
    id: 'authorityPanel',
    initial: 'idle',
    context: initialAuthorityContext,
    states: {
        idle: {
            on: {
                LOAD_AUTHORITY: {
                    target: 'inspecting',
                    actions: 'setAuthorityLoaded',
                },
            },
        },
        inspecting: {
            on: {
                TRAVERSE_AUDIT_PATH: {
                    target: 'path_highlighted',
                    actions: 'setPathHighlighted',
                },
                SUBMIT_DAO_CONFIRMATION: [
                    {
                        guard: ({ event }) => event.approved,
                        target: 'dao_approved',
                    },
                    {
                        target: 'dao_rejected',
                    },
                ],
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
            },
        },
        path_highlighted: {
            on: {
                SUBMIT_DAO_CONFIRMATION: [
                    {
                        guard: ({ event }) => event.approved,
                        target: 'dao_approved',
                    },
                    {
                        target: 'dao_rejected',
                    },
                ],
                TRAVERSE_AUDIT_PATH: {
                    actions: 'setPathHighlighted',
                },
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
            },
        },
        dao_approved: {
            on: {
                REVEAL_VIEWING_KEY: {
                    target: 'viewing_revealed',
                    actions: 'setRevealedViewingKey',
                },
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
            },
        },
        dao_rejected: {
            on: {
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
            },
        },
        viewing_revealed: {
            on: {
                RESET: {
                    target: 'idle',
                    actions: 'resetContext',
                },
            },
        },
    },
});

export class AuthorityPanelStateMachine {
    private actor: ReturnType<typeof createActor<typeof authorityPanelMachine>>;

    constructor(initialContext?: Partial<AuthorityPanelContext>) {
        this.actor = createActor(authorityPanelMachine, {
            input: { ...initialAuthorityContext, ...initialContext },
        });
        this.actor.start();
    }

    send(event: AuthorityPanelEvent): void {
        this.actor.send(event);
    }

    getSnapshot() {
        return this.actor.getSnapshot();
    }

    stop(): void {
        this.actor.stop();
    }
}
