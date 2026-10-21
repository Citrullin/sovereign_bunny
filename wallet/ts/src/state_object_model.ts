import { ethers } from 'ethers';
import { VirtualCarBuffer, LocalStoreAdapter, CommitPhase, MemoryLocalStoreAdapter } from './car_reconciler.js';

export interface SomAction {
    type: string;
    targetSlot: number;
    callerDid: string;
    payload: {
        newCommitment?: Uint8Array | string; // 32-byte hex or bytes
        metadata?: any;
        delta?: any;
    };
}

export interface SomEvent {
    type: string;
    slotId: number;
    path: string;
    target: 'slot' | 'account' | 'manifold';
    timestamp: number;
    payload: any;
}

export type SomObserverCallback = (newValue: any, oldValue: any, path: string) => void;
export type SomEventListener = (event: SomEvent) => void;

export interface SomConfig {
    storage?: LocalStoreAdapter;
    enforceDeRebac?: boolean;
    batchIntervalMs?: number; // Fiber-style batching interval (0 = microtask tick)
}

export class StateObjectModel {
    public readonly accountAddress: string;
    private buffer: VirtualCarBuffer;
    private baseBuffer: VirtualCarBuffer;
    private storage: LocalStoreAdapter;
    private enforceDeRebac: boolean;

    // Path observers for fine-grained reactivity (Signals pattern)
    private pathObservers: Map<string, Set<SomObserverCallback>> = new Map();
    // Hierarchical event listeners (Bubbling pattern)
    private eventListeners: Map<string, Set<SomEventListener>> = new Map();

    // Fiber queue for transaction squashing & coalescing
    private pendingActionQueue: SomAction[] = [];
    private isBatching: boolean = false;
    private uncommittedActions: SomAction[] = [];

    // deReBAC relation cache: (caller, relation, slot)
    private deRebacRules: Map<string, Set<number>> = new Map();

    constructor(
        accountAddress: string,
        initialBuffer?: VirtualCarBuffer,
        config: SomConfig = {}
    ) {
        this.accountAddress = accountAddress.toLowerCase();
        this.buffer = initialBuffer ? initialBuffer.clone() : new VirtualCarBuffer();
        this.baseBuffer = this.buffer.clone();
        this.storage = config.storage || new MemoryLocalStoreAdapter();
        this.enforceDeRebac = config.enforceDeRebac ?? true;

        // Default permission: self DID has access to all slots
        this.grantDeRebacPermission(`did:sov:${this.accountAddress}`, 'can_mutate', Array.from({ length: 64 }, (_, i) => i));
    }

    /// Read-only observable projection: returns a frozen copy of slot data.
    /// Attempting to mutate returned data directly does not affect canonical state.
    public getSlot(slotId: number): Uint8Array {
        if (slotId < 0 || slotId >= 64) {
            throw new RangeError(`Slot index out of bounds: ${slotId}`);
        }
        const copy = new Uint8Array(this.buffer.getSlot(slotId));
        return new Proxy(copy, {
            get(target, prop) {
                if (prop === 'length' || prop === 'byteLength' || prop === 'byteOffset' || prop === 'buffer') {
                    return Reflect.get(target, prop);
                }
                const val = Reflect.get(target, prop);
                if (typeof val === 'function') return (val as Function).bind(target);
                return val;
            },
            set: () => {
                throw new TypeError('Cannot modify read-only slot projection');
            }
        });
    }

    public getSlotHex(slotId: number): string {
        return ethers.hexlify(this.getSlot(slotId));
    }

    public getNonce(): bigint {
        return this.buffer.nonce;
    }

    /// Fine-grained path observer (Signals pattern)
    /// Example path: "slots[3].git.tree_root", "slots[2].notes.unspent"
    public observe(path: string, callback: SomObserverCallback): () => void {
        if (!this.pathObservers.has(path)) {
            this.pathObservers.set(path, new Set());
        }
        this.pathObservers.get(path)!.add(callback);
        return () => {
            this.pathObservers.get(path)?.delete(callback);
        };
    }

    /// Hierarchical event listener (Event Bubbling)
    public addEventListener(eventType: string, listener: SomEventListener): () => void {
        if (!this.eventListeners.has(eventType)) {
            this.eventListeners.set(eventType, new Set());
        }
        this.eventListeners.get(eventType)!.add(listener);
        return () => {
            this.eventListeners.get(eventType)?.delete(listener);
        };
    }

    /// Grants in-memory deReBAC permission in Slot 1
    public grantDeRebacPermission(callerDid: string, relation: string, allowedSlots: number[]) {
        const key = `${callerDid.toLowerCase()}:${relation}`;
        if (!this.deRebacRules.has(key)) {
            this.deRebacRules.set(key, new Set());
        }
        const set = this.deRebacRules.get(key)!;
        for (const s of allowedSlots) set.add(s);
    }

    /// Evaluates in-memory deReBAC capability guard (Slot 1) in <1ms
    public canMutate(callerDid: string, targetSlot: number): boolean {
        if (!this.enforceDeRebac) return true;
        const key = `${callerDid.toLowerCase()}:can_mutate`;
        const allowedSlots = this.deRebacRules.get(key);
        return allowedSlots ? allowedSlots.has(targetSlot) : false;
    }

    /// Strict Unidirectional Data Flow: Actions are dispatched, guarded, batched, and folded.
    public async dispatch(action: SomAction): Promise<CommitPhase> {
        // Step 1: Scoped deReBAC Guard (Slot 1)
        if (!this.canMutate(action.callerDid, action.targetSlot)) {
            throw new Error(
                `[SOM Security Violation] Caller ${action.callerDid} lacks deReBAC capability "can_mutate" on Slot ${action.targetSlot}`
            );
        }

        // Step 2: Queue into Fiber Lane for transaction squashing
        this.pendingActionQueue.push(action);

        if (!this.isBatching) {
            this.isBatching = true;
            // Schedule microtask turn (run-to-completion event loop semantics)
            return await new Promise<CommitPhase>((resolve, reject) => {
                queueMicrotask(async () => {
                    try {
                        const phase = await this.flushFiberBatch();
                        resolve(phase);
                    } catch (e) {
                        reject(e);
                    } finally {
                        this.isBatching = false;
                    }
                });
            });
        }

        return {
            phase: 'Staged',
            nonce: this.buffer.nonce + 1n,
        };
    }

    /// Flushes coalesced Fiber-lane actions into a single atomic state fold
    private async flushFiberBatch(): Promise<CommitPhase> {
        if (this.pendingActionQueue.length === 0) {
            return { phase: 'Anchored', nonce: this.buffer.nonce, epoch: 0n };
        }

        // Transaction Squashing: coalesce multiple micro-actions targeting the same slot
        const actionsToProcess = [...this.pendingActionQueue];
        this.pendingActionQueue = [];
        this.uncommittedActions.push(...actionsToProcess);

        const dirtyMap = new Map<number, Uint8Array>();
        const oldSlotValues = new Map<number, Uint8Array>();

        for (const act of actionsToProcess) {
            if (!oldSlotValues.has(act.targetSlot)) {
                oldSlotValues.set(act.targetSlot, this.getSlot(act.targetSlot));
            }

            let newBytes: Uint8Array;
            if (act.payload.newCommitment instanceof Uint8Array) {
                newBytes = act.payload.newCommitment;
            } else if (typeof act.payload.newCommitment === 'string') {
                newBytes = ethers.getBytes(ethers.zeroPadValue(act.payload.newCommitment, 32));
            } else {
                newBytes = ethers.getBytes(ethers.id(JSON.stringify(act.payload)));
            }

            // Coalesce / squash
            dirtyMap.set(act.targetSlot, newBytes);
        }

        // Step 3: Pure State Transition Fold: S_{t+1} = f(S_t, delta S)
        const nextNonce = this.buffer.nonce + 1n;
        for (const [slot, val] of dirtyMap.entries()) {
            this.buffer.setSlot(slot, val);
        }
        this.buffer.nonce = nextNonce;

        // Persist durably to storage adapter
        await this.storage.commitAtomicBatch(nextNonce, dirtyMap);

        // Step 4: Fire Fine-Grained Path Observers & Bubble Events
        for (const [slot, newVal] of dirtyMap.entries()) {
            const oldVal = oldSlotValues.get(slot)!;
            const slotPath = `slots[${slot}]`;

            // Notify specific slot path observers
            this.notifyObservers(slotPath, newVal, oldVal);

            // Hierarchical Event Bubbling: Leaf -> Account -> Manifold
            const eventPayload: SomEvent = {
                type: 'SLOT_MUTATED',
                slotId: slot,
                path: slotPath,
                target: 'slot',
                timestamp: Date.now(),
                payload: { oldHex: ethers.hexlify(oldVal), newHex: ethers.hexlify(newVal) },
            };
            this.bubbleEvent(eventPayload);
        }

        return {
            phase: 'Staged',
            nonce: nextNonce,
        };
    }

    /// Notifies path observers matching exact path or prefix
    private notifyObservers(path: string, newVal: any, oldVal: any) {
        for (const [observedPath, callbacks] of this.pathObservers.entries()) {
            if (path.startsWith(observedPath) || observedPath.startsWith(path)) {
                for (const cb of callbacks) {
                    try {
                        cb(newVal, oldVal, path);
                    } catch (e) {
                        console.error(`[SOM Observer Error] ${e}`);
                    }
                }
            }
        }
    }

    /// Bubbles event upward through the hierarchy: Slot -> Account -> Manifold
    private bubbleEvent(event: SomEvent) {
        const dispatchTo = (targetLevel: 'slot' | 'account' | 'manifold') => {
            const ev = { ...event, target: targetLevel };
            const listeners = this.eventListeners.get(ev.type);
            if (listeners) {
                for (const l of listeners) {
                    try {
                        l(ev);
                    } catch (e) {
                        console.error(`[SOM Event Listener Error] ${e}`);
                    }
                }
            }
        };

        dispatchTo('slot');
        dispatchTo('account');
        dispatchTo('manifold');
    }

    /// Git-Style Sovereign Pure Rebase:
    /// Re-applies uncommitted local actions on top of an updated remote head
    public rebase(remoteHead: { slots: Uint8Array[]; nonce: bigint }): {
        success: boolean;
        conflictedSlots: number[];
        newNonce: bigint;
    } {
        const remoteModifiedSlots = new Set<number>();
        for (let i = 0; i < 64; i++) {
            const baseSlot = this.baseBuffer.getSlot(i);
            const remoteSlot = remoteHead.slots[i] || new Uint8Array(32);
            if (ethers.hexlify(baseSlot) !== ethers.hexlify(remoteSlot)) {
                remoteModifiedSlots.add(i);
            }
        }

        // Check for slot contention conflicts
        const conflictedSlots: number[] = [];
        const localTouchedSlots = new Set(this.uncommittedActions.map(a => a.targetSlot));

        for (const slot of localTouchedSlots) {
            if (remoteModifiedSlots.has(slot)) {
                conflictedSlots.push(slot);
            }
        }

        if (conflictedSlots.length > 0) {
            return {
                success: false,
                conflictedSlots,
                newNonce: remoteHead.nonce,
            };
        }

        // Clean rebase: adopt remote state as new base, then replay uncommitted actions
        for (let i = 0; i < 64; i++) {
            const slotVal = remoteHead.slots[i] || new Uint8Array(32);
            this.baseBuffer.slots[i] = new Uint8Array(slotVal);
            this.buffer.slots[i] = new Uint8Array(slotVal);
        }
        this.baseBuffer.nonce = remoteHead.nonce;
        this.buffer.nonce = remoteHead.nonce;

        // Replay uncommitted actions
        for (const act of this.uncommittedActions) {
            let newBytes: Uint8Array;
            if (act.payload.newCommitment instanceof Uint8Array) {
                newBytes = act.payload.newCommitment;
            } else if (typeof act.payload.newCommitment === 'string') {
                newBytes = ethers.getBytes(ethers.zeroPadValue(act.payload.newCommitment, 32));
            } else {
                newBytes = ethers.getBytes(ethers.id(JSON.stringify(act.payload)));
            }
            this.buffer.setSlot(act.targetSlot, newBytes);
        }
        this.buffer.nonce += BigInt(this.uncommittedActions.length > 0 ? 1 : 0);

        return {
            success: true,
            conflictedSlots: [],
            newNonce: this.buffer.nonce,
        };
    }
}
