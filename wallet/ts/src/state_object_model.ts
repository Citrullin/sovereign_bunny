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

/// ----------------------------------------------------------------------------
/// Invertible Delta DAG & History Data Structures
/// ----------------------------------------------------------------------------

export interface SlotPatch {
    slotId: number;
    prevValue: Uint8Array;
    nextValue: Uint8Array;
    metadata?: any;
}

export interface StateDelta {
    slotMutations: Map<number, SlotPatch>;
}

export interface StateBlock {
    blockHeight: bigint;
    nonce: bigint;
    parentHash: string; // 32-byte hex
    stateRoot: string;  // 32-byte hex
    timestamp: number;
    delta: StateDelta;         // Forward slot mutations: S_t -> S_{t+1}
    inverseDelta: StateDelta;  // Exact mathematical inverse: S_{t+1} -> S_t
    witness?: any;             // ZK proof / signature
}

export interface BlindNoteSagaState {
    sagaId: string;
    initiatorDid: string;
    counterpartyDid: string;
    targetSlot: number;
    depositAmount: bigint;
    depositCommitment: string;
    spendingNullifier: string;
    reclaimNullifier: string;
    reclaimSecret: string;
    decayEpoch: bigint;
    status: 'Superposition' | 'Claimed' | 'Reclaimed' | 'Compensated' | 'SlashingTriggered';
}

/// ----------------------------------------------------------------------------
/// State Object Model (SOM) Implementation
/// ----------------------------------------------------------------------------

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

    // Track A: Ephemeral Redo Stack for local in-memory undo/redo
    private redoStack: SomAction[] = [];

    // Track B: Monotonic Committed History DAG
    private committedHistory: StateBlock[] = [];
    private currentBlockHeight: bigint = 0n;

    // Track C: Distributed Sagas over Blind Notes
    private sagas: Map<string, BlindNoteSagaState> = new Map();

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

    /// Read-only observable projection: returns a frozen proxy of slot data.
    /// Attempting to mutate returned data directly throws TypeError.
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

    public getBlockHeight(): bigint {
        return this.currentBlockHeight;
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

    /// ------------------------------------------------------------------------
    /// Track A: Ephemeral Queue (Local Virtual Undo / Redo)
    /// ------------------------------------------------------------------------

    /// Stages an optimistic local action in memory without immediately sealing
    public stage(action: SomAction): void {
        if (!this.canMutate(action.callerDid, action.targetSlot)) {
            throw new Error(
                `[SOM Security Violation] Caller ${action.callerDid} lacks deReBAC capability "can_mutate" on Slot ${action.targetSlot}`
            );
        }

        const oldVal = this.getSlot(action.targetSlot);
        let newBytes: Uint8Array;
        if (action.payload.newCommitment instanceof Uint8Array) {
            newBytes = action.payload.newCommitment;
        } else if (typeof action.payload.newCommitment === 'string') {
            newBytes = ethers.getBytes(ethers.zeroPadValue(action.payload.newCommitment, 32));
        } else {
            newBytes = ethers.getBytes(ethers.id(JSON.stringify(action.payload)));
        }

        this.buffer.setSlot(action.targetSlot, newBytes);
        this.uncommittedActions.push(action);
        this.redoStack = []; // New action clears redo stack

        // Notify observers and bubble event for 60fps local view
        const slotPath = `slots[${action.targetSlot}]`;
        this.notifyObservers(slotPath, newBytes, oldVal);
        this.bubbleEvent({
            type: 'SLOT_MUTATED',
            slotId: action.targetSlot,
            path: slotPath,
            target: 'slot',
            timestamp: Date.now(),
            payload: { oldHex: ethers.hexlify(oldVal), newHex: ethers.hexlify(newBytes), optimistic: true },
        });
    }

    /// Pops the last uncommitted action off the virtual queue (Instant Local Undo)
    public undo(): boolean {
        if (this.uncommittedActions.length === 0) {
            return false;
        }

        const poppedAction = this.uncommittedActions.pop()!;
        this.redoStack.push(poppedAction);

        // Reconstruct buffer from committed base + remaining uncommitted actions
        const oldVal = this.getSlot(poppedAction.targetSlot);
        this.buffer = this.baseBuffer.clone();

        for (const act of this.uncommittedActions) {
            let b: Uint8Array;
            if (act.payload.newCommitment instanceof Uint8Array) {
                b = act.payload.newCommitment;
            } else if (typeof act.payload.newCommitment === 'string') {
                b = ethers.getBytes(ethers.zeroPadValue(act.payload.newCommitment, 32));
            } else {
                b = ethers.getBytes(ethers.id(JSON.stringify(act.payload)));
            }
            this.buffer.setSlot(act.targetSlot, b);
        }

        const newVal = this.getSlot(poppedAction.targetSlot);
        const slotPath = `slots[${poppedAction.targetSlot}]`;
        this.notifyObservers(slotPath, newVal, oldVal);
        this.bubbleEvent({
            type: 'SLOT_MUTATED',
            slotId: poppedAction.targetSlot,
            path: slotPath,
            target: 'slot',
            timestamp: Date.now(),
            payload: { oldHex: ethers.hexlify(oldVal), newHex: ethers.hexlify(newVal), undo: true },
        });

        return true;
    }

    /// Redoes the last undone uncommitted action
    public redo(): boolean {
        if (this.redoStack.length === 0) {
            return false;
        }

        const action = this.redoStack.pop()!;
        this.stage(action);
        return true;
    }

    public canUndo(): boolean {
        return this.uncommittedActions.length > 0;
    }

    public canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    public discardUncommitted(): void {
        this.buffer = this.baseBuffer.clone();
        this.uncommittedActions = [];
        this.redoStack = [];
    }

    public getUncommittedActions(): readonly SomAction[] {
        return [...this.uncommittedActions];
    }

    /// ------------------------------------------------------------------------
    /// Track B: Monotonic Committed History DAG & Forward Reverting
    /// ------------------------------------------------------------------------

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

        // Compute Forward Delta and Exact Mathematical Inverse Delta
        const forwardMutations = new Map<number, SlotPatch>();
        const inverseMutations = new Map<number, SlotPatch>();

        for (const [slot, newVal] of dirtyMap.entries()) {
            const oldVal = oldSlotValues.get(slot)!;
            forwardMutations.set(slot, { slotId: slot, prevValue: oldVal, nextValue: newVal });
            inverseMutations.set(slot, { slotId: slot, prevValue: newVal, nextValue: oldVal });
        }

        // Step 3: Pure State Transition Fold: S_{t+1} = f(S_t, delta S)
        const nextNonce = this.buffer.nonce + 1n;
        for (const [slot, val] of dirtyMap.entries()) {
            this.buffer.setSlot(slot, val);
        }
        this.buffer.nonce = nextNonce;

        // Persist durably to storage adapter
        await this.storage.commitAtomicBatch(nextNonce, dirtyMap);

        // Step 4: Record Block into Invertible Delta DAG
        this.currentBlockHeight += 1n;
        const parentHash = this.committedHistory.length > 0 
            ? this.committedHistory[this.committedHistory.length - 1].stateRoot 
            : ethers.ZeroHash;
        
        // Compute state root over 64 slots
        const stateRoot = ethers.keccak256(ethers.concat(this.buffer.slots));

        const block: StateBlock = {
            blockHeight: this.currentBlockHeight,
            nonce: nextNonce,
            parentHash,
            stateRoot,
            timestamp: Date.now(),
            delta: { slotMutations: forwardMutations },
            inverseDelta: { slotMutations: inverseMutations },
        };
        this.committedHistory.push(block);

        // Advance committed base and clear uncommitted/redo stacks
        this.baseBuffer = this.buffer.clone();
        this.uncommittedActions = [];
        this.redoStack = [];

        // Step 5: Fire Fine-Grained Path Observers & Bubble Events
        for (const [slot, newVal] of dirtyMap.entries()) {
            const oldVal = oldSlotValues.get(slot)!;
            const slotPath = `slots[${slot}]`;

            this.notifyObservers(slotPath, newVal, oldVal);

            this.bubbleEvent({
                type: 'SLOT_MUTATED',
                slotId: slot,
                path: slotPath,
                target: 'slot',
                timestamp: Date.now(),
                payload: { oldHex: ethers.hexlify(oldVal), newHex: ethers.hexlify(newVal) },
            });
        }

        return {
            phase: 'Staged',
            nonce: nextNonce,
        };
    }

    public getCommittedHistory(): readonly StateBlock[] {
        return [...this.committedHistory];
    }

    public getBlock(height: bigint): StateBlock | undefined {
        return this.committedHistory.find(b => b.blockHeight === height);
    }

    /// Git-Revert Style Forward Revert:
    /// Reverts state to targetBlockHeight by accumulating mathematical inverse patches
    /// and dispatching a brand new forward block with monotonic nonce bump (N+1).
    public async revert(targetBlockHeight: bigint): Promise<CommitPhase> {
        if (targetBlockHeight < 0n || targetBlockHeight >= this.currentBlockHeight) {
            throw new RangeError(
                `Invalid target block height ${targetBlockHeight}. Current height: ${this.currentBlockHeight}`
            );
        }

        // Accumulate inverse delta patches backwards from current head down to targetBlockHeight + 1
        const squashedInverseSlots = new Map<number, Uint8Array>();
        const targetBlock = targetBlockHeight === 0n ? null : this.getBlock(targetBlockHeight);

        for (let i = this.committedHistory.length - 1; i >= 0; i--) {
            const block = this.committedHistory[i];
            if (block.blockHeight <= targetBlockHeight) break;

            for (const [slot, invPatch] of block.inverseDelta.slotMutations.entries()) {
                // If not already set by a newer block walking backwards, set the target
                squashedInverseSlots.set(slot, invPatch.nextValue);
            }
        }

        // Apply squashed inverse patches as a new forward block
        const nextNonce = this.buffer.nonce + 1n;
        const forwardMutations = new Map<number, SlotPatch>();
        const inverseMutations = new Map<number, SlotPatch>();

        for (const [slot, targetVal] of squashedInverseSlots.entries()) {
            const oldVal = this.getSlot(slot);
            this.buffer.setSlot(slot, targetVal);

            forwardMutations.set(slot, { slotId: slot, prevValue: oldVal, nextValue: targetVal });
            inverseMutations.set(slot, { slotId: slot, prevValue: targetVal, nextValue: oldVal });

            const slotPath = `slots[${slot}]`;
            this.notifyObservers(slotPath, targetVal, oldVal);
            this.bubbleEvent({
                type: 'SLOT_MUTATED',
                slotId: slot,
                path: slotPath,
                target: 'slot',
                timestamp: Date.now(),
                payload: { oldHex: ethers.hexlify(oldVal), newHex: ethers.hexlify(targetVal), revertedFromHeight: this.currentBlockHeight },
            });
        }

        this.buffer.nonce = nextNonce;
        await this.storage.commitAtomicBatch(nextNonce, squashedInverseSlots);

        // Record the compensating revert block into the DAG
        this.currentBlockHeight += 1n;
        const parentHash = this.committedHistory[this.committedHistory.length - 1].stateRoot;
        const stateRoot = ethers.keccak256(ethers.concat(this.buffer.slots));

        const revertBlock: StateBlock = {
            blockHeight: this.currentBlockHeight,
            nonce: nextNonce,
            parentHash,
            stateRoot,
            timestamp: Date.now(),
            delta: { slotMutations: forwardMutations },
            inverseDelta: { slotMutations: inverseMutations },
        };
        this.committedHistory.push(revertBlock);
        this.baseBuffer = this.buffer.clone();

        return {
            phase: 'Staged',
            nonce: nextNonce,
        };
    }

    /// ------------------------------------------------------------------------
    /// Track C: Distributed Sagas over Blind Notes (Superposition vs. Compensation)
    /// ------------------------------------------------------------------------

    /// Initiates a multi-actor payment/capability saga with dual nullifier keys
    public initiateBlindNoteSaga(params: {
        sagaId: string;
        initiatorDid: string;
        counterpartyDid: string;
        targetSlot: number;
        depositAmount: bigint;
        decayEpoch: bigint;
        skReclaim?: string;
    }): BlindNoteSagaState {
        const reclaimSecret = params.skReclaim || ethers.hexlify(ethers.randomBytes(32));
        const spendingNullifier = ethers.keccak256(
            ethers.toUtf8Bytes(`${params.sagaId}:spend:${params.counterpartyDid}`)
        );
        const reclaimNullifier = ethers.keccak256(
            ethers.toUtf8Bytes(`${reclaimSecret}:reclaim:${params.sagaId}`)
        );
        const depositCommitment = ethers.keccak256(
            ethers.toUtf8Bytes(`${params.sagaId}:deposit:${params.depositAmount.toString()}`)
        );

        const saga: BlindNoteSagaState = {
            sagaId: params.sagaId,
            initiatorDid: params.initiatorDid,
            counterpartyDid: params.counterpartyDid,
            targetSlot: params.targetSlot,
            depositAmount: params.depositAmount,
            depositCommitment,
            spendingNullifier,
            reclaimNullifier,
            reclaimSecret,
            decayEpoch: params.decayEpoch,
            status: 'Superposition',
        };

        this.sagas.set(params.sagaId, saga);
        return saga;
    }

    public getSaga(sagaId: string): BlindNoteSagaState | undefined {
        return this.sagas.get(sagaId);
    }

    /// Option Alpha: Counterparty successfully claims note (Forward Path Finalized)
    public claimBlindNoteSaga(sagaId: string, counterpartyDid: string): BlindNoteSagaState {
        const saga = this.sagas.get(sagaId);
        if (!saga) throw new Error(`Saga ${sagaId} not found`);
        if (saga.status !== 'Superposition') {
            throw new Error(`Saga ${sagaId} is not in Superposition (current: ${saga.status})`);
        }
        if (saga.counterpartyDid.toLowerCase() !== counterpartyDid.toLowerCase()) {
            throw new Error(`Unauthorized counterparty ${counterpartyDid} for saga ${sagaId}`);
        }

        saga.status = 'Claimed';
        return saga;
    }

    /// Option Beta: Note timeout or aborted while unconsumed (Superposition Rollback)
    /// Account A emits reclamation nullifier and re-absorbs note locally without Account B
    public reclaimExpiredNote(sagaId: string, currentEpoch: bigint): { saga: BlindNoteSagaState; refundCommitment: string } {
        const saga = this.sagas.get(sagaId);
        if (!saga) throw new Error(`Saga ${sagaId} not found`);
        if (saga.status !== 'Superposition') {
            throw new Error(`Cannot reclaim note: saga ${sagaId} is already ${saga.status}`);
        }
        if (currentEpoch < saga.decayEpoch) {
            throw new Error(
                `Decay epoch ${saga.decayEpoch} not reached yet (current epoch: ${currentEpoch})`
            );
        }

        saga.status = 'Reclaimed';
        // Note is consumed in global nullifier set and re-credited to initiator
        return {
            saga,
            refundCommitment: saga.depositCommitment,
        };
    }

    /// Scenario 2: Active Compensation when note was already consumed into Account B
    public compensateConsumedNote(sagaId: string, refundCommitment: string): BlindNoteSagaState {
        const saga = this.sagas.get(sagaId);
        if (!saga) throw new Error(`Saga ${sagaId} not found`);
        if (saga.status !== 'Claimed') {
            throw new Error(`Cannot compensate: saga ${sagaId} is not Claimed (status: ${saga.status})`);
        }

        saga.status = 'Compensated';
        return saga;
    }

    /// Slashing backstop if counterparty refuses active compensation within dispute window
    public slashDefaultingCounterparty(sagaId: string, currentEpoch: bigint, disputeDeadline: bigint): {
        slashed: boolean;
        seizedAmount: bigint;
    } {
        const saga = this.sagas.get(sagaId);
        if (!saga) throw new Error(`Saga ${sagaId} not found`);
        if (saga.status !== 'Claimed') {
            throw new Error(`Slashing only applies to Claimed sagas that failed compensation`);
        }
        if (currentEpoch <= disputeDeadline) {
            throw new Error(`Dispute deadline epoch ${disputeDeadline} not expired yet`);
        }

        saga.status = 'SlashingTriggered';
        return {
            slashed: true,
            seizedAmount: saga.depositAmount * 2n, // Forfeits 2x bond
        };
    }

    /// ------------------------------------------------------------------------
    /// Observers, Bubbling & Sovereign Pure Rebase
    /// ------------------------------------------------------------------------

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

        for (let i = 0; i < 64; i++) {
            const slotVal = remoteHead.slots[i] || new Uint8Array(32);
            this.baseBuffer.slots[i] = new Uint8Array(slotVal);
            this.buffer.slots[i] = new Uint8Array(slotVal);
        }
        this.baseBuffer.nonce = remoteHead.nonce;
        this.buffer.nonce = remoteHead.nonce;

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
