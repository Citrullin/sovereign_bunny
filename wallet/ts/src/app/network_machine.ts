import { setup, assign, createActor, fromPromise } from 'xstate';

export interface NetworkContext {
    rpcUrl: string;
    chainId: string;
    epochHeight: number;
    peerCount: number;
    latencyMs: number;
    error: string | null;
}

export type NetworkState = 'disconnected' | 'connecting' | 'connected' | 'polling';

export type NetworkEvent =
    | { type: 'CONNECT'; rpcUrl: string; chainId?: string }
    | { type: 'CONNECTED'; chainId: string }
    | { type: 'CONNECT_FAIL'; error: string }
    | { type: 'EPOCH_ADVANCED'; epochHeight: number }
    | { type: 'SET_PEER_COUNT'; peerCount: number }
    | { type: 'SET_LATENCY'; latencyMs: number }
    | { type: 'POLL' }
    | { type: 'POLL_OK'; epochHeight: number; peerCount?: number; latencyMs?: number }
    | { type: 'POLL_FAIL'; error: string }
    | { type: 'DISCONNECT' };

export const initialNetworkContext: NetworkContext = {
    rpcUrl: '/rpc',
    chainId: '1337',
    epochHeight: 1,
    peerCount: 0,
    latencyMs: 0,
    error: null,
};

export interface BunnyRpcResponse<T = any> {
    jsonrpc: string;
    id: number | string;
    result?: T;
    error?: { code: number; message: string; data?: any };
}

/**
 * Robust JSON-RPC caller supporting Reth (8545) and CAIP Proxy (8546) fallback
 */
export async function callBunnyRpc<T = any>(
    method: string,
    params: any[] = [],
    rpcUrlInput?: string
): Promise<BunnyRpcResponse<T>> {
    const rawRpc = rpcUrlInput || (typeof document !== 'undefined' ? (document.getElementById('rpc-endpoint-input') as HTMLInputElement)?.value : null) || '/rpc';
    let primaryUrl = rawRpc;
    if (primaryUrl.startsWith('/') && typeof window !== 'undefined') {
        primaryUrl = `${window.location.origin}${primaryUrl}`;
    }
    const endpoints: string[] = [];
    const isModern = typeof localStorage !== 'undefined' && localStorage.getItem('sovereign_api_mode') === 'modern';
    if (isModern && primaryUrl.includes(':8545')) {
        endpoints.push(primaryUrl.replace(':8545', ':8546'));
    }
    endpoints.push(primaryUrl);
    if (!isModern && primaryUrl.includes(':8545')) {
        endpoints.push(primaryUrl.replace(':8545', ':8546'));
    }
    if (typeof window !== 'undefined' && !endpoints.includes(`${window.location.origin}/rpc`)) {
        endpoints.push(`${window.location.origin}/rpc`);
    }

    let lastError: any = null;
    for (const ep of endpoints) {
        try {
            const resp = await fetch(ep, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method,
                    params,
                }),
            });
            if (resp.ok) {
                return (await resp.json()) as BunnyRpcResponse<T>;
            }
            lastError = new Error(`HTTP ${resp.status} from ${ep}`);
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError || new Error(`Failed to call RPC method ${method}`);
}

export const networkMachine = setup({
    types: {
        context: {} as NetworkContext,
        events: {} as NetworkEvent,
    },
    actions: {
        setConnecting: assign({
            rpcUrl: ({ event }) => (event.type === 'CONNECT' ? event.rpcUrl : '/rpc'),
            chainId: ({ context, event }) =>
                event.type === 'CONNECT' && event.chainId ? event.chainId : context.chainId,
            error: () => null,
        }),
        setConnected: assign({
            chainId: ({ event }) => (event.type === 'CONNECTED' ? event.chainId : '1337'),
            error: () => null,
        }),
        setConnectFailed: assign({
            error: ({ event }) => (event.type === 'CONNECT_FAIL' ? event.error : 'Connection failed'),
        }),
        setEpochAdvanced: assign({
            epochHeight: ({ event }) => (event.type === 'EPOCH_ADVANCED' ? event.epochHeight : 1),
        }),
        setPeerCount: assign({
            peerCount: ({ event }) => (event.type === 'SET_PEER_COUNT' ? event.peerCount : 0),
        }),
        setLatency: assign({
            latencyMs: ({ event }) => (event.type === 'SET_LATENCY' ? event.latencyMs : 0),
        }),
        applyPollSuccess: assign({
            epochHeight: ({ context, event }) => {
                if (event.type === 'POLL_OK') {
                    return Math.max(context.epochHeight, event.epochHeight);
                }
                return context.epochHeight;
            },
            peerCount: ({ context, event }) => {
                if (event.type === 'POLL_OK' && event.peerCount !== undefined) {
                    return event.peerCount;
                }
                return context.peerCount;
            },
            latencyMs: ({ context, event }) => {
                if (event.type === 'POLL_OK' && event.latencyMs !== undefined) {
                    return event.latencyMs;
                }
                return context.latencyMs;
            },
            error: () => null,
        }),
        applyPollError: assign({
            error: ({ event }) => (event.type === 'POLL_FAIL' ? event.error : null),
        }),
        resetDisconnected: assign(() => ({
            ...initialNetworkContext,
        })),
    },
}).createMachine({
    id: 'network',
    initial: 'disconnected',
    context: initialNetworkContext,
    states: {
        disconnected: {
            on: {
                CONNECT: {
                    target: 'connecting',
                    actions: 'setConnecting',
                },
                EPOCH_ADVANCED: {
                    actions: 'setEpochAdvanced',
                },
            },
        },
        connecting: {
            on: {
                CONNECTED: {
                    target: 'connected',
                    actions: 'setConnected',
                },
                CONNECT_FAIL: {
                    target: 'disconnected',
                    actions: 'setConnectFailed',
                },
                DISCONNECT: {
                    target: 'disconnected',
                    actions: 'resetDisconnected',
                },
            },
        },
        connected: {
            // Transitions automatically to polling
            always: {
                target: 'polling',
            },
            on: {
                DISCONNECT: {
                    target: 'disconnected',
                    actions: 'resetDisconnected',
                },
            },
        },
        polling: {
            after: {
                3000: {
                    target: 'polling',
                    actions: assign({}), // Trigger self-transition for next cycle
                },
            },
            on: {
                POLL_OK: {
                    actions: 'applyPollSuccess',
                },
                POLL_FAIL: {
                    actions: 'applyPollError',
                },
                EPOCH_ADVANCED: {
                    actions: 'setEpochAdvanced',
                },
                SET_PEER_COUNT: {
                    actions: 'setPeerCount',
                },
                SET_LATENCY: {
                    actions: 'setLatency',
                },
                DISCONNECT: {
                    target: 'disconnected',
                    actions: 'resetDisconnected',
                },
            },
        },
    },
});

export class NetworkStateMachine {
    private actor = createActor(networkMachine);

    constructor(initialCtx?: Partial<NetworkContext>) {
        this.actor.start();
        if (initialCtx?.rpcUrl) {
            this.send({
                type: 'CONNECT',
                rpcUrl: initialCtx.rpcUrl,
                chainId: initialCtx.chainId,
            });
        }
    }

    getSnapshot(): { value: NetworkState; context: NetworkContext } {
        const snap = this.actor.getSnapshot();
        return {
            value: snap.value as NetworkState,
            context: snap.context,
        };
    }

    subscribe(callback: (snapshot: { value: NetworkState; context: NetworkContext }) => void): () => void {
        const sub = this.actor.subscribe((snap) => {
            callback({
                value: snap.value as NetworkState,
                context: snap.context,
            });
        });
        return () => sub.unsubscribe();
    }

    send(event: NetworkEvent): void {
        this.actor.send(event);
    }

    stop(): void {
        this.actor.stop();
    }
}
