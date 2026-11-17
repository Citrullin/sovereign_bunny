import { setup, assign, createActor, ActorRefFrom } from 'xstate';
import type { WalletProfile, DecryptedAccountKeys } from './globals.js';

export interface WalletContext {
    connectedAddress: string | null;
    profiles: WalletProfile[];
    activeProfileIndex: number;
    currentKeys: DecryptedAccountKeys | null;
    storageMode: 'native' | 'file_api' | null;
    error: string | null;
    isRegisteringDid: boolean;
    didRegisterError: string | null;
}

export type WalletState = 'locked' | 'unlocking' | 'unlocked' | 'syncing' | 'ready';

export type WalletEvent =
    | { type: 'UNLOCK'; address: string; password?: string }
    | { type: 'UNLOCK_OK'; keys: DecryptedAccountKeys; profileIndex?: number }
    | { type: 'UNLOCK_FAIL'; error: string }
    | { type: 'LOCK' }
    | { type: 'SET_PROFILES'; profiles: WalletProfile[]; activeIndex?: number }
    | { type: 'SWITCH_PROFILE'; index: number }
    | { type: 'SET_CONNECTED_ADDRESS'; address: string | null }
    | { type: 'SET_STORAGE_MODE'; mode: 'native' | 'file_api' | null }
    | { type: 'REGISTER_DID_START' }
    | { type: 'REGISTER_DID_SUCCESS'; txHash?: string }
    | { type: 'REGISTER_DID_FAILURE'; error: string }
    | { type: 'SYNC' }
    | { type: 'SYNC_OK'; profile: Partial<WalletProfile> }
    | { type: 'SYNC_FAIL'; error: string }
    | { type: 'RESET' };

export const initialWalletContext: WalletContext = {
    connectedAddress: null,
    profiles: [],
    activeProfileIndex: -1,
    currentKeys: null,
    storageMode: null,
    error: null,
    isRegisteringDid: false,
    didRegisterError: null,
};

export const walletMachine = setup({
    types: {
        context: {} as WalletContext,
        events: {} as WalletEvent,
    },
    actions: {
        setUnlocking: assign({
            error: () => null,
        }),
        setUnlocked: assign({
            currentKeys: ({ event }) => (event.type === 'UNLOCK_OK' ? event.keys : null),
            connectedAddress: ({ context, event }) => {
                if (event.type === 'UNLOCK_OK') {
                    return event.keys.address || context.connectedAddress;
                }
                return context.connectedAddress;
            },
            activeProfileIndex: ({ context, event }) => {
                if (event.type === 'UNLOCK_OK' && event.profileIndex !== undefined) {
                    return event.profileIndex;
                }
                return context.activeProfileIndex;
            },
            error: () => null,
        }),
        setUnlockFailed: assign({
            error: ({ event }) => (event.type === 'UNLOCK_FAIL' ? event.error : 'Unlock failed'),
        }),
        setLocked: assign({
            currentKeys: () => null,
            error: () => null,
        }),
        setProfiles: assign({
            profiles: ({ event }) => (event.type === 'SET_PROFILES' ? event.profiles : []),
            activeProfileIndex: ({ context, event }) => {
                if (event.type === 'SET_PROFILES' && event.activeIndex !== undefined) {
                    return event.activeIndex;
                }
                return context.activeProfileIndex;
            },
        }),
        switchProfile: assign({
            activeProfileIndex: ({ context, event }) => {
                if (event.type === 'SWITCH_PROFILE') {
                    if (event.index >= 0 && event.index < context.profiles.length) {
                        return event.index;
                    }
                }
                return context.activeProfileIndex;
            },
            currentKeys: ({ context, event }) => {
                if (event.type === 'SWITCH_PROFILE') {
                    if (event.index >= 0 && event.index < context.profiles.length) {
                        return context.profiles[event.index] as DecryptedAccountKeys;
                    }
                }
                return context.currentKeys;
            },
            connectedAddress: ({ context, event }) => {
                if (event.type === 'SWITCH_PROFILE') {
                    if (event.index >= 0 && event.index < context.profiles.length) {
                        return context.profiles[event.index].address;
                    }
                }
                return context.connectedAddress;
            },
        }),
        setConnectedAddress: assign({
            connectedAddress: ({ event }) => (event.type === 'SET_CONNECTED_ADDRESS' ? event.address : null),
        }),
        setStorageMode: assign({
            storageMode: ({ event }) => (event.type === 'SET_STORAGE_MODE' ? event.mode : null),
        }),
        applySync: assign({
            profiles: ({ context, event }) => {
                if (event.type === 'SYNC_OK') {
                    const idx = context.activeProfileIndex;
                    if (idx >= 0 && idx < context.profiles.length) {
                        const updated = [...context.profiles];
                        updated[idx] = { ...updated[idx], ...event.profile };
                        return updated;
                    }
                }
                return context.profiles;
            },
            error: () => null,
        }),
        setSyncFailed: assign({
            error: ({ event }) => (event.type === 'SYNC_FAIL' ? event.error : 'Sync failed'),
        }),
        setRegisteringDid: assign({
            isRegisteringDid: () => true,
            didRegisterError: () => null,
        }),
        setDidRegistered: assign({
            isRegisteringDid: () => false,
            didRegisterError: () => null,
            profiles: ({ context }) => {
                const idx = context.activeProfileIndex;
                if (idx >= 0 && idx < context.profiles.length) {
                    const copy = [...context.profiles];
                    copy[idx] = { ...copy[idx], registered: true };
                    return copy;
                }
                return context.profiles;
            },
            currentKeys: ({ context }) => {
                if (context.currentKeys) {
                    return { ...context.currentKeys, registered: true };
                }
                return null;
            },
        }),
        setDidRegisterFailed: assign({
            isRegisteringDid: () => false,
            didRegisterError: ({ event }) => (event.type === 'REGISTER_DID_FAILURE' ? event.error : 'Registration failed'),
        }),
        resetContext: assign(() => ({ ...initialWalletContext })),
    },
}).createMachine({
    id: 'wallet',
    initial: 'locked',
    context: initialWalletContext,
    states: {
        locked: {
            on: {
                UNLOCK: {
                    target: 'unlocking',
                    actions: 'setUnlocking',
                },
                SET_PROFILES: {
                    actions: 'setProfiles',
                },
                SET_CONNECTED_ADDRESS: {
                    actions: 'setConnectedAddress',
                },
                SET_STORAGE_MODE: {
                    actions: 'setStorageMode',
                },
                RESET: {
                    actions: 'resetContext',
                },
            },
        },
        unlocking: {
            on: {
                UNLOCK_OK: {
                    target: 'unlocked',
                    actions: 'setUnlocked',
                },
                UNLOCK_FAIL: {
                    target: 'locked',
                    actions: 'setUnlockFailed',
                },
                LOCK: {
                    target: 'locked',
                    actions: 'setLocked',
                },
            },
        },
        unlocked: {
            on: {
                SYNC: {
                    target: 'syncing',
                },
                SWITCH_PROFILE: {
                    actions: 'switchProfile',
                },
                SET_PROFILES: {
                    actions: 'setProfiles',
                },
                SET_STORAGE_MODE: {
                    actions: 'setStorageMode',
                },
                LOCK: {
                    target: 'locked',
                    actions: 'setLocked',
                },
                RESET: {
                    target: 'locked',
                    actions: 'resetContext',
                },
            },
            // Auto transition to ready once unlocked
            always: {
                target: 'ready',
            },
        },
        syncing: {
            on: {
                SYNC_OK: {
                    target: 'ready',
                    actions: 'applySync',
                },
                SYNC_FAIL: {
                    target: 'ready',
                    actions: 'setSyncFailed',
                },
                LOCK: {
                    target: 'locked',
                    actions: 'setLocked',
                },
            },
        },
        ready: {
            on: {
                SYNC: {
                    target: 'syncing',
                },
                SWITCH_PROFILE: {
                    actions: 'switchProfile',
                },
                SET_PROFILES: {
                    actions: 'setProfiles',
                },
                SET_STORAGE_MODE: {
                    actions: 'setStorageMode',
                },
                LOCK: {
                    target: 'locked',
                    actions: 'setLocked',
                },
                RESET: {
                    target: 'locked',
                    actions: 'resetContext',
                },
            },
        },
    },
});

export class WalletStateMachine {
    private actor = createActor(walletMachine);

    constructor(initialCtx?: Partial<WalletContext>) {
        this.actor.start();
        if (initialCtx?.profiles) {
            this.send({
                type: 'SET_PROFILES',
                profiles: initialCtx.profiles,
                activeIndex: initialCtx.activeProfileIndex,
            });
        }
        if (initialCtx?.connectedAddress) {
            this.send({ type: 'SET_CONNECTED_ADDRESS', address: initialCtx.connectedAddress });
        }
        if (initialCtx?.storageMode) {
            this.send({ type: 'SET_STORAGE_MODE', mode: initialCtx.storageMode });
        }
    }

    getSnapshot(): { value: WalletState; context: WalletContext } {
        const snap = this.actor.getSnapshot();
        return {
            value: snap.value as WalletState,
            context: snap.context,
        };
    }

    subscribe(callback: (snapshot: { value: WalletState; context: WalletContext }) => void): () => void {
        const sub = this.actor.subscribe((snap) => {
            callback({
                value: snap.value as WalletState,
                context: snap.context,
            });
        });
        return () => sub.unsubscribe();
    }

    send(event: WalletEvent): void {
        this.actor.send(event);
    }

    stop(): void {
        this.actor.stop();
    }
}
