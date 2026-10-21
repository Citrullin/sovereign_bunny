// Sovereign Reference Client & Reconciler
// Conforms to Phase 2 & docs/booklet/bunny-stack.tex (Listing 1 & Section 3).
// Implements the four framework-neutral client invariants:
// 1. Pure local transition over Virtual CAR.
// 2. Owned (single-writer) versus Contended (multi-party saga) separation.
// 3. Three-stage reactive lifecycle: Staged -> Sealed -> Anchored | Rejected.
// 4. Canonical SSZ byte boundary with fixed-point bigint numerics.

import { Hex } from './envelopes.js';

/// ----------------------------------------------------------------------------
/// Layer 1: Storage Adapter Interfaces & Implementations
/// ----------------------------------------------------------------------------

export interface LocalStoreAdapter {
    readSlot(slot: number): Promise<Uint8Array>;
    commitAtomicBatch(nonce: bigint, dirty: Map<number, Uint8Array>): Promise<void>;
    getLatestNonce(): Promise<bigint>;
    getStagedBatch(): Promise<{ nonce: bigint; dirty: Map<number, Uint8Array> } | null>;
    clearStagedBatch(nonce: bigint): Promise<void>;
}

/// In-memory local storage adapter for testing and headless runtimes.
export class MemoryLocalStoreAdapter implements LocalStoreAdapter {
    private slots: Map<number, Uint8Array> = new Map();
    private latestNonce: bigint = 0n;
    private stagedBatch: { nonce: bigint; dirty: Map<number, Uint8Array> } | null = null;

    async readSlot(slot: number): Promise<Uint8Array> {
        return this.slots.get(slot) || new Uint8Array(32);
    }

    async commitAtomicBatch(nonce: bigint, dirty: Map<number, Uint8Array>): Promise<void> {
        // Durably record as staged first
        this.stagedBatch = { nonce, dirty: new Map(dirty) };
        for (const [slot, val] of dirty.entries()) {
            this.slots.set(slot, new Uint8Array(val));
        }
        this.latestNonce = nonce;
    }

    async getLatestNonce(): Promise<bigint> {
        return this.latestNonce;
    }

    async getStagedBatch(): Promise<{ nonce: bigint; dirty: Map<number, Uint8Array> } | null> {
        return this.stagedBatch;
    }

    async clearStagedBatch(nonce: bigint): Promise<void> {
        if (this.stagedBatch && this.stagedBatch.nonce === nonce) {
            this.stagedBatch = null;
        }
    }
}

/// Browser IndexedDB storage adapter ensuring durable recovery across tab closes.
export class IndexedDbStorage implements LocalStoreAdapter {
    private dbName: string;
    private dbPromise: Promise<IDBDatabase> | null = null;

    constructor(dbName: string = 'sovereign_actor_store') {
        this.dbName = dbName;
    }

    private getDB(): Promise<IDBDatabase> {
        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                if (typeof indexedDB === 'undefined') {
                    reject(new Error('IndexedDB is not supported in this environment'));
                    return;
                }
                const request = indexedDB.open(this.dbName, 1);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains('slots')) {
                        db.createObjectStore('slots', { keyPath: 'slot' });
                    }
                    if (!db.objectStoreNames.contains('meta')) {
                        db.createObjectStore('meta', { keyPath: 'key' });
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        return this.dbPromise;
    }

    async readSlot(slot: number): Promise<Uint8Array> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('slots', 'readonly');
            const store = tx.objectStore('slots');
            const req = store.get(slot);
            req.onsuccess = () => {
                if (req.result && req.result.data) {
                    resolve(new Uint8Array(req.result.data));
                } else {
                    resolve(new Uint8Array(32));
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    async commitAtomicBatch(nonce: bigint, dirty: Map<number, Uint8Array>): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['slots', 'meta'], 'readwrite');
            const slotStore = tx.objectStore('slots');
            const metaStore = tx.objectStore('meta');

            // Record as staged
            const dirtyObj: Record<number, number[]> = {};
            for (const [s, data] of dirty.entries()) {
                dirtyObj[s] = Array.from(data);
                slotStore.put({ slot: s, data: Array.from(data) });
            }

            metaStore.put({ key: 'stagedBatch', nonce: nonce.toString(), dirty: dirtyObj });
            metaStore.put({ key: 'latestNonce', nonce: nonce.toString() });

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getLatestNonce(): Promise<bigint> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('meta', 'readonly');
            const store = tx.objectStore('meta');
            const req = store.get('latestNonce');
            req.onsuccess = () => {
                if (req.result && req.result.nonce) {
                    resolve(BigInt(req.result.nonce));
                } else {
                    resolve(0n);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    async getStagedBatch(): Promise<{ nonce: bigint; dirty: Map<number, Uint8Array> } | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('meta', 'readonly');
            const store = tx.objectStore('meta');
            const req = store.get('stagedBatch');
            req.onsuccess = () => {
                if (req.result && req.result.nonce && req.result.dirty) {
                    const dirtyMap = new Map<number, Uint8Array>();
                    for (const [k, v] of Object.entries(req.result.dirty)) {
                        dirtyMap.set(Number(k), new Uint8Array(v as number[]));
                    }
                    resolve({ nonce: BigInt(req.result.nonce), dirty: dirtyMap });
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    async clearStagedBatch(nonce: bigint): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('meta', 'readwrite');
            const store = tx.objectStore('meta');
            const req = store.get('stagedBatch');
            req.onsuccess = () => {
                if (req.result && BigInt(req.result.nonce) === nonce) {
                    store.delete('stagedBatch');
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

/// ----------------------------------------------------------------------------
/// Layer 4: Transport Adapter Interfaces & BNY\x01 Envelope Dispatcher
/// ----------------------------------------------------------------------------

export interface EpochReceipt {
    epoch: bigint;
    txHash: string;
    status: 'anchored' | 'rejected';
    timestamp: number;
}

export interface SyncTransportAdapter {
    dispatchFrame(frame: Uint8Array, lane: 'urgent' | 'background'): Promise<EpochReceipt>;
}

/// Iroh / Peer-to-peer sync adapter packing BNY\x01 SSZ envelopes.
export class IrohSyncAdapter implements SyncTransportAdapter {
    private lane: 'urgent' | 'background';
    private currentEpoch: bigint = 1n;

    constructor(options: { lane?: 'urgent' | 'background' } = {}) {
        this.lane = options.lane || 'urgent';
    }

    async dispatchFrame(frame: Uint8Array, lane: 'urgent' | 'background' = this.lane): Promise<EpochReceipt> {
        // Enforce BNY\x01 magic framing (0x42, 0x4E, 0x59, 0x01)
        if (frame.length < 4 || frame[0] !== 0x42 || frame[1] !== 0x4E || frame[2] !== 0x59 || frame[3] !== 0x01) {
            throw new Error("Invalid envelope: missing BNY\\x01 SSZ header");
        }

        // Advance simulated epoch receipt
        this.currentEpoch += 1n;
        const txHash = '0x' + Array.from(frame.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join('');

        return {
            epoch: this.currentEpoch,
            txHash,
            status: 'anchored',
            timestamp: Date.now(),
        };
    }
}

/// ----------------------------------------------------------------------------
/// Layer 2 & 3: Reactive CommitPhase Lifecycle & Reconciler
/// ----------------------------------------------------------------------------

export type CommitPhase =
    | { phase: 'Staged'; nonce: bigint }
    | { phase: 'Sealed'; nonce: bigint; frame: Uint8Array }
    | { phase: 'Anchored'; nonce: bigint; epoch: bigint }
    | { phase: 'Rejected'; nonce: bigint; reason: string; rolledBackFrom: bigint };

export interface CrossActorIntent {
    intentId: string;
    initiator: string;
    counterparties: string[];
    targetSlots: number[];
    payload: Uint8Array;
    deadlineEpoch: bigint;
}

export interface SagaState {
    state: 'Pending' | 'Locked' | 'Settled' | 'Compensated' | 'Failed';
    intentId: string;
    step: number;
    error?: string;
}

/// In-memory Virtual CAR state representation for JavaScript/WASM boundary
export class VirtualCarBuffer {
    public slots: Uint8Array[] = [];
    public nonces: bigint[] = [];
    public dirtyMask: bigint = 0n;

    constructor() {
        for (let i = 0; i < 64; i++) {
            this.slots.push(new Uint8Array(32));
            this.nonces.push(0n);
        }
    }

    setSlot(index: number, data: Uint8Array) {
        if (index < 0 || index >= 64) throw new Error(`Invalid slot index ${index}`);
        this.slots[index] = new Uint8Array(data);
        this.nonces[index] += 1n;
        this.dirtyMask |= (1n << BigInt(index));
    }

    getSlot(index: number): Uint8Array {
        return this.slots[index];
    }

    clearDirty() {
        this.dirtyMask = 0n;
    }

    /// Packs frame into canonical BNY\x01 SSZ envelope
    packFrame(nonce: bigint): Uint8Array {
        const dirtySlots: number[] = [];
        for (let i = 0; i < 64; i++) {
            if ((this.dirtyMask & (1n << BigInt(i))) !== 0n) {
                dirtySlots.push(i);
            }
        }

        // Header: BNY\x01 (4 bytes) + Nonce (8 bytes big-endian) + dirty count (1 byte)
        const header = new Uint8Array(4 + 8 + 1);
        header[0] = 0x42; // 'B'
        header[1] = 0x4E; // 'N'
        header[2] = 0x59; // 'Y'
        header[3] = 0x01; // version 1

        const view = new DataView(header.buffer, 4, 8);
        view.setBigUint64(0, nonce, false);
        header[12] = dirtySlots.length;

        // Concatenate slot payloads
        const chunks: Uint8Array[] = [header];
        for (const slotIdx of dirtySlots) {
            chunks.push(new Uint8Array([slotIdx]));
            chunks.push(new Uint8Array(this.slots[slotIdx].buffer, this.slots[slotIdx].byteOffset, this.slots[slotIdx].byteLength));
        }

        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }
}

export interface SovereignActorClientOptions {
    storage?: LocalStoreAdapter;
    sync?: SyncTransportAdapter;
    did?: string;
}

export class SovereignActorClient<TSchema = any> {
    public readonly storage: LocalStoreAdapter;
    public readonly sync: SyncTransportAdapter;
    public readonly did: string;
    private vcar: VirtualCarBuffer;
    private currentNonce: bigint = 0n;
    private isInitialized: boolean = false;

    constructor(options: SovereignActorClientOptions = {}) {
        this.storage = options.storage || new MemoryLocalStoreAdapter();
        this.sync = options.sync || new IrohSyncAdapter();
        this.did = options.did || 'did:rad:local:sovereign_actor';
        this.vcar = new VirtualCarBuffer();
    }

    async init(): Promise<void> {
        if (this.isInitialized) return;
        this.currentNonce = await this.storage.getLatestNonce();

        // Load persisted slots
        for (let i = 0; i < 64; i++) {
            const data = await this.storage.readSlot(i);
            this.vcar.slots[i] = data;
        }

        // Crash recovery: check for any unfinished Staged batches from prior session
        const staged = await this.storage.getStagedBatch();
        if (staged) {
            console.warn(`[SovereignActorClient] Recovering unfinished staged batch for nonce ${staged.nonce}`);
            try {
                // Replay into vcar
                for (const [slot, data] of staged.dirty.entries()) {
                    this.vcar.setSlot(slot, data);
                }
                const frame = this.vcar.packFrame(staged.nonce);
                const receipt = await this.sync.dispatchFrame(frame, 'urgent');
                if (receipt.status === 'anchored') {
                    await this.storage.clearStagedBatch(staged.nonce);
                    this.currentNonce = staged.nonce;
                    this.vcar.clearDirty();
                }
            } catch (err) {
                console.error('[SovereignActorClient] Failed to auto-seal recovered staged batch:', err);
            }
        }

        this.isInitialized = true;
    }

    /// Single-writer owned slot mutation with 4-phase reactive lifecycle.
    async reconcile(
        mutator: (draft: VirtualCarBuffer) => void,
        onPhase?: (s: CommitPhase) => void
    ): Promise<CommitPhase> {
        if (!this.isInitialized) await this.init();

        const priorNonce = this.currentNonce;
        const proposedNonce = priorNonce + 1n;

        // 1. Snapshot for rollback
        const priorSlots = this.vcar.slots.map(s => new Uint8Array(s));
        const priorMask = this.vcar.dirtyMask;

        try {
            // 2. Pure local transition
            this.vcar.clearDirty();
            mutator(this.vcar);

            if (this.vcar.dirtyMask === 0n) {
                return { phase: 'Anchored', nonce: priorNonce, epoch: 0n };
            }

            // Extract dirty map
            const dirty = new Map<number, Uint8Array>();
            for (let i = 0; i < 64; i++) {
                if ((this.vcar.dirtyMask & (1n << BigInt(i))) !== 0n) {
                    dirty.set(i, this.vcar.getSlot(i));
                }
            }

            // 3. Staged phase (DURABLE: must persist to local storage before proceeding)
            await this.storage.commitAtomicBatch(proposedNonce, dirty);
            const stagedPhase: CommitPhase = { phase: 'Staged', nonce: proposedNonce };
            onPhase?.(stagedPhase);

            // 4. Sealed phase (generate proof and envelope)
            const frame = this.vcar.packFrame(proposedNonce);
            const sealedPhase: CommitPhase = { phase: 'Sealed', nonce: proposedNonce, frame };
            onPhase?.(sealedPhase);

            // 5. Anchored phase (dispatch onto sync transport)
            const receipt = await this.sync.dispatchFrame(frame, 'urgent');
            if (receipt.status !== 'anchored') {
                throw new Error(`Consensus rejected frame in epoch ${receipt.epoch}`);
            }

            // Successfully anchored: clear durable staged record and bump nonce
            await this.storage.clearStagedBatch(proposedNonce);
            this.currentNonce = proposedNonce;
            this.vcar.clearDirty();

            const anchoredPhase: CommitPhase = { phase: 'Anchored', nonce: proposedNonce, epoch: receipt.epoch };
            onPhase?.(anchoredPhase);
            return anchoredPhase;
        } catch (err: any) {
            // Rollback local memory
            this.vcar.slots = priorSlots;
            this.vcar.dirtyMask = priorMask;

            const rejectedPhase: CommitPhase = {
                phase: 'Rejected',
                nonce: proposedNonce,
                reason: err?.message || String(err),
                rolledBackFrom: priorNonce,
            };
            onPhase?.(rejectedPhase);
            return rejectedPhase;
        }
    }

    /// Contended cross-actor multi-party saga: returns an explicit reactive stream.
    proposeIntent(intent: CrossActorIntent): ReadableStream<SagaState> {
        return new ReadableStream<SagaState>({
            start(controller) {
                controller.enqueue({ state: 'Pending', intentId: intent.intentId, step: 0 });

                // Step 1: Simulate slot lock lease
                setTimeout(() => {
                    controller.enqueue({ state: 'Locked', intentId: intent.intentId, step: 1 });

                    // Step 2: Finalize settlement
                    setTimeout(() => {
                        controller.enqueue({ state: 'Settled', intentId: intent.intentId, step: 2 });
                        controller.close();
                    }, 50);
                }, 50);
            }
        });
    }

    getNonce(): bigint {
        return this.currentNonce;
    }

    getSlot(index: number): Uint8Array {
        return this.vcar.getSlot(index);
    }
}
