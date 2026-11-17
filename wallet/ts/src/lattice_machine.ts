import { setup, assign, createActor } from 'xstate';

export interface LocalLatticeState {
    headCommitment: `0x${string}`;
    sequence: bigint;
    pendingIntermediateRoot: `0x${string}` | null;
    isLocked: boolean;
    lockExpiryEpoch: bigint;
}

export interface LatticeContext {
    account: `0x${string}`;
    currentEpoch: bigint;
    onChainTip: `0x${string}`;
    localState: LocalLatticeState;
    stagedOperations: any[];
    error: string | null;
}

export type LatticeEvent =
    | { type: 'STAGE_OPERATION'; operation: any }
    | { type: 'COMMIT_LOCAL'; newRoot: `0x${string}` }
    | { type: 'LEASE_LOCK'; intermediateRoot: `0x${string}`; durationEpochs: bigint }
    | { type: 'UNLOCK'; newTip: `0x${string}` }
    | { type: 'REVERT_ROLLBACK' }
    | { type: 'ADVANCE_EPOCH'; epoch: bigint }
    | { type: 'SYNC_ON_CHAIN'; onChainTip: `0x${string}`; sequence: bigint };

export const latticeTransitionMachine = setup({
    types: {
        context: {} as LatticeContext,
        events: {} as LatticeEvent,
        input: {} as Partial<LatticeContext> | undefined,
    },
    actions: {
        stageOp: assign({
            stagedOperations: ({ context, event }) => {
                if (event.type === 'STAGE_OPERATION') {
                    return [...context.stagedOperations, event.operation];
                }
                return context.stagedOperations;
            },
        }),
        applyLocalCommit: assign({
            localState: ({ context, event }) => {
                if (event.type === 'COMMIT_LOCAL') {
                    return {
                        ...context.localState,
                        headCommitment: event.newRoot,
                        sequence: context.localState.sequence + 1n,
                    };
                }
                return context.localState;
            },
            stagedOperations: () => [],
            error: () => null,
        }),
        applyLeaseLock: assign({
            localState: ({ context, event }) => {
                if (event.type === 'LEASE_LOCK') {
                    return {
                        ...context.localState,
                        isLocked: true,
                        pendingIntermediateRoot: event.intermediateRoot,
                        lockExpiryEpoch: context.currentEpoch + event.durationEpochs,
                    };
                }
                return context.localState;
            },
        }),
        applyUnlock: assign({
            localState: ({ context, event }) => {
                if (event.type === 'UNLOCK') {
                    return {
                        ...context.localState,
                        headCommitment: event.newTip,
                        sequence: context.localState.sequence + 1n,
                        isLocked: false,
                        pendingIntermediateRoot: null,
                        lockExpiryEpoch: 0n,
                    };
                }
                return context.localState;
            },
            onChainTip: ({ event }) => (event.type === 'UNLOCK' ? event.newTip : '0x0'),
        }),
        applyRevert: assign({
            localState: ({ context }) => ({
                ...context.localState,
                isLocked: false,
                pendingIntermediateRoot: null,
                lockExpiryEpoch: 0n,
            }),
            stagedOperations: () => [],
            error: () => null,
        }),
        setEpoch: assign({
            currentEpoch: ({ event }) => (event.type === 'ADVANCE_EPOCH' ? event.epoch : 0n),
        }),
        applySync: assign({
            onChainTip: ({ event }) => (event.type === 'SYNC_ON_CHAIN' ? event.onChainTip : '0x0'),
            localState: ({ context, event }) => {
                if (event.type === 'SYNC_ON_CHAIN') {
                    return {
                        ...context.localState,
                        headCommitment: event.onChainTip,
                        sequence: event.sequence,
                        isLocked: false,
                        pendingIntermediateRoot: null,
                    };
                }
                return context.localState;
            },
        }),
    },
    guards: {
        isLeaseExpired: ({ context, event }) => {
            if (event.type === 'ADVANCE_EPOCH') {
                return event.epoch >= context.localState.lockExpiryEpoch;
            }
            return false;
        },
    },
}).createMachine({
    id: 'latticeKernel',
    initial: 'idle',
    context: ({ input }) => ({
        account: input?.account || '0x0',
        currentEpoch: input?.currentEpoch !== undefined ? input.currentEpoch : 1n,
        onChainTip: input?.onChainTip || '0x0',
        localState: {
            headCommitment: input?.localState?.headCommitment || input?.onChainTip || '0x0',
            sequence: input?.localState?.sequence || 0n,
            pendingIntermediateRoot: input?.localState?.pendingIntermediateRoot || null,
            isLocked: input?.localState?.isLocked || false,
            lockExpiryEpoch: input?.localState?.lockExpiryEpoch || 0n,
        },
        stagedOperations: input?.stagedOperations || [],
        error: input?.error || null,
    }),
    states: {
        idle: {
            on: {
                STAGE_OPERATION: {
                    actions: 'stageOp',
                    target: 'staging',
                },
                LEASE_LOCK: {
                    actions: 'applyLeaseLock',
                    target: 'leased',
                },
                SYNC_ON_CHAIN: {
                    actions: 'applySync',
                },
                ADVANCE_EPOCH: {
                    actions: 'setEpoch',
                },
            },
        },
        staging: {
            on: {
                STAGE_OPERATION: {
                    actions: 'stageOp',
                },
                COMMIT_LOCAL: {
                    actions: 'applyLocalCommit',
                    target: 'speculative',
                },
                REVERT_ROLLBACK: {
                    actions: 'applyRevert',
                    target: 'idle',
                },
            },
        },
        speculative: {
            on: {
                LEASE_LOCK: {
                    actions: 'applyLeaseLock',
                    target: 'leased',
                },
                SYNC_ON_CHAIN: {
                    actions: 'applySync',
                    target: 'idle',
                },
                REVERT_ROLLBACK: {
                    actions: 'applyRevert',
                    target: 'idle',
                },
            },
        },
        leased: {
            on: {
                UNLOCK: {
                    actions: 'applyUnlock',
                    target: 'idle',
                },
                REVERT_ROLLBACK: {
                    actions: 'applyRevert',
                    target: 'idle',
                },
                ADVANCE_EPOCH: [
                    {
                        guard: 'isLeaseExpired',
                        actions: 'setEpoch',
                        target: 'expired',
                    },
                    {
                        actions: 'setEpoch',
                    },
                ],
            },
        },
        expired: {
            on: {
                REVERT_ROLLBACK: {
                    actions: 'applyRevert',
                    target: 'idle',
                },
                ADVANCE_EPOCH: {
                    actions: 'setEpoch',
                },
            },
        },
    },
});

export class LatticeTransitionKernel {
    private actor: ReturnType<typeof createLatticeMachineActor>;

    constructor(initialContext?: Partial<LatticeContext>) {
        this.actor = createLatticeMachineActor(initialContext);
        this.actor.start();
        if (initialContext?.account) {
            this.actor.send({
                type: 'SYNC_ON_CHAIN',
                onChainTip: initialContext.onChainTip || '0x0',
                sequence: initialContext.localState?.sequence || 0n,
            });
        }
    }

    getSnapshot() {
        return this.actor.getSnapshot();
    }

    send(event: LatticeEvent) {
        this.actor.send(event);
    }

    stop() {
        this.actor.stop();
    }
}

export function createLatticeMachineActor(initialContext?: Partial<LatticeContext>) {
    return createActor(latticeTransitionMachine, {
        input: initialContext,
    });
}
