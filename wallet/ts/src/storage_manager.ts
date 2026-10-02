// Account-Scoped Folder Storage Manager for Sovereign Account-Lattice
// Organizes state per account address: accounts/<address>/{keys,contracts,zanzibar,traces}

export interface AccountKeyStorage {
    pqPrivateKey?: string;
    pqPublicKey?: string;
    didDocument?: string;
    keyTier?: string;
    allowLegacy?: boolean;
    keystore?: string | any;
}

export interface CustomContractEntry {
    name: string;
    targetAddress: string;
    abi: any[];
    uploadedAt: number;
}

export interface ZanzibarScopedTuple {
    namespace: number;
    objectId: string;
    relation: number;
    subject: string;
    timestamp: number;
}

export interface DebugTraceEntry {
    id: string;
    timestamp: number;
    input: string;
    targetAddress?: string;
    mode?: string;
    functionName?: string;
    status: 'success' | 'reverted' | 'error';
    summary: string;
}

export interface BlindNoteEntry {
    commitment: string;
    assetId: string;
    amount: string;
    sender: string;
    recipient: string;
    targetSlot?: number;
    payload?: string;
    isShielded: boolean;
    status: 'unspent' | 'absorbed' | 'clawback_pending' | 'evaporated';
    timestamp?: number;
}

export interface AccountViewingKeyStorage {
    publicKey?: string;
    secretKey?: string;
    gossipTopic?: string;
}

export interface ScopedActivityPubNote {
    id: string;
    actor_address: string;
    content: string;
    timestamp: number;
    signature?: string;
    [key: string]: any;
}

export interface ScopedTransactionHistoryEntry {
    hash: string;
    type: string;
    timestamp: number;
    from?: string;
    to?: string;
    amount?: string;
    [key: string]: any;
}

export interface StorageBackend {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    getAllKeys(): string[];
}

export class MemoryStorageBackend implements StorageBackend {
    private store: Map<string, string> = new Map();

    getItem(key: string): string | null {
        return this.store.get(key) || null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    getAllKeys(): string[] {
        return Array.from(this.store.keys());
    }
}

export class BrowserLocalStorageBackend implements StorageBackend {
    getItem(key: string): string | null {
        try {
            return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
        } catch (_) {
            return null;
        }
    }
    setItem(key: string, value: string): void {
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
        } catch (_) {}
    }
    removeItem(key: string): void {
        try {
            if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
        } catch (_) {}
    }
    getAllKeys(): string[] {
        try {
            return typeof localStorage !== 'undefined' ? Object.keys(localStorage) : [];
        } catch (_) {
            return [];
        }
    }
}

export class AccountScopedStorage {
    public readonly address: string;
    private readonly manager: AccountStorageManager;

    constructor(address: string, manager: AccountStorageManager) {
        this.address = address.toLowerCase();
        this.manager = manager;
    }

    // Keys category
    getKeys(): AccountKeyStorage {
        return this.manager.getAccountKeys(this.address);
    }
    saveKeys(keys: Partial<AccountKeyStorage>): void {
        this.manager.saveAccountKeys(this.address, keys);
    }

    // Contracts category
    getCustomContracts(): CustomContractEntry[] {
        return this.manager.getCustomContracts(this.address);
    }
    saveCustomContract(contract: CustomContractEntry): void {
        this.manager.saveCustomContract(this.address, contract);
    }

    // Zanzibar category
    getZanzibarTuples(): ZanzibarScopedTuple[] {
        return this.manager.getZanzibarTuples(this.address);
    }
    saveZanzibarTuple(tuple: ZanzibarScopedTuple): void {
        this.manager.saveZanzibarTuple(this.address, tuple);
    }

    // Traces category
    getDebugTraces(): DebugTraceEntry[] {
        return this.manager.getDebugTraces(this.address);
    }
    saveDebugTrace(trace: DebugTraceEntry): void {
        this.manager.saveDebugTrace(this.address, trace);
    }

    // Blind Notes category
    getBlindNotes(): BlindNoteEntry[] {
        return this.manager.getBlindNotes(this.address);
    }
    saveBlindNote(note: BlindNoteEntry): void {
        this.manager.saveBlindNote(this.address, note);
    }
    clearBlindNotes(): void {
        this.manager.clearBlindNotes(this.address);
    }

    // Viewing Keys category
    getViewingKeys(): AccountViewingKeyStorage {
        return this.manager.getViewingKeys(this.address);
    }
    saveViewingKeys(keys: Partial<AccountViewingKeyStorage>): void {
        this.manager.saveViewingKeys(this.address, keys);
    }

    // ActivityPub category
    getActivityPubNotes(): ScopedActivityPubNote[] {
        return this.manager.getActivityPubNotes(this.address);
    }
    saveActivityPubNote(note: ScopedActivityPubNote): void {
        this.manager.saveActivityPubNote(this.address, note);
    }

    // Transactions category
    getTransactionHistory(): ScopedTransactionHistoryEntry[] {
        return this.manager.getTransactionHistory(this.address);
    }
    saveTransaction(tx: ScopedTransactionHistoryEntry): void {
        this.manager.saveTransaction(this.address, tx);
    }
}

export class AccountStorageManager {
    private backend: StorageBackend;

    constructor(backend?: StorageBackend) {
        if (backend) {
            this.backend = backend;
        } else if (typeof localStorage !== 'undefined') {
            this.backend = new BrowserLocalStorageBackend();
        } else {
            this.backend = new MemoryStorageBackend();
        }
    }

    private _key(address: string, category: string, subkey?: string): string {
        const normAddr = address.toLowerCase();
        return subkey 
            ? `accounts/${normAddr}/${category}/${subkey}`
            : `accounts/${normAddr}/${category}`;
    }

    public forAccount(address: string): AccountScopedStorage {
        return new AccountScopedStorage(address, this);
    }

    public listAccounts(): string[] {
        const keys = this.backend.getAllKeys();
        const accounts = new Set<string>();
        for (const k of keys) {
            if (k.startsWith('accounts/')) {
                const parts = k.split('/');
                if (parts[1]) accounts.add(parts[1]);
            }
        }
        return Array.from(accounts);
    }

    // Keys
    public getAccountKeys(address: string): AccountKeyStorage {
        const raw = this.backend.getItem(this._key(address, 'keys'));
        if (!raw) return {};
        try {
            return JSON.parse(raw);
        } catch (_) {
            return {};
        }
    }

    public saveAccountKeys(address: string, updates: Partial<AccountKeyStorage>): void {
        const current = this.getAccountKeys(address);
        const merged = { ...current, ...updates };
        this.backend.setItem(this._key(address, 'keys'), JSON.stringify(merged));
    }

    // Custom Contracts
    public getCustomContracts(address: string): CustomContractEntry[] {
        const raw = this.backend.getItem(this._key(address, 'contracts'));
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch (_) {
            return [];
        }
    }

    public saveCustomContract(address: string, contract: CustomContractEntry): void {
        const contracts = this.getCustomContracts(address);
        const idx = contracts.findIndex(c => 
            c.targetAddress.toLowerCase() === contract.targetAddress.toLowerCase() || 
            c.name.toLowerCase() === contract.name.toLowerCase()
        );
        if (idx >= 0) {
            contracts[idx] = contract;
        } else {
            contracts.push(contract);
        }
        this.backend.setItem(this._key(address, 'contracts'), JSON.stringify(contracts));
    }

    // Zanzibar
    public getZanzibarTuples(address: string): ZanzibarScopedTuple[] {
        const raw = this.backend.getItem(this._key(address, 'zanzibar', 'tuples'));
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch (_) {
            return [];
        }
    }

    public saveZanzibarTuple(address: string, tuple: ZanzibarScopedTuple): void {
        const tuples = this.getZanzibarTuples(address);
        tuples.push(tuple);
        this.backend.setItem(this._key(address, 'zanzibar', 'tuples'), JSON.stringify(tuples));
    }

    // Debug Traces
    public getDebugTraces(address: string): DebugTraceEntry[] {
        const raw = this.backend.getItem(this._key(address, 'traces'));
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch (_) {
            return [];
        }
    }

    public saveDebugTrace(address: string, trace: DebugTraceEntry): void {
        const traces = this.getDebugTraces(address);
        traces.unshift(trace);
        if (traces.length > 50) traces.length = 50; // Keep last 50
        this.backend.setItem(this._key(address, 'traces'), JSON.stringify(traces));
    }

    // Blind Notes
    public getBlindNotes(address: string): BlindNoteEntry[] {
        const raw = this.backend.getItem(this._key(address, 'notes'));
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch (_) {
            return [];
        }
    }

    public saveBlindNote(address: string, note: BlindNoteEntry): void {
        const notes = this.getBlindNotes(address);
        const idx = notes.findIndex(n => n.commitment.toLowerCase() === note.commitment.toLowerCase());
        if (idx >= 0) {
            notes[idx] = note;
        } else {
            notes.push(note);
        }
        this.backend.setItem(this._key(address, 'notes'), JSON.stringify(notes));
    }

    public clearBlindNotes(address: string): void {
        this.backend.removeItem(this._key(address, 'notes'));
    }

    // Viewing Keys
    public getViewingKeys(address: string): AccountViewingKeyStorage {
        const raw = this.backend.getItem(this._key(address, 'viewing_keys'));
        if (!raw) return {};
        try {
            return JSON.parse(raw);
        } catch (_) {
            return {};
        }
    }

    public saveViewingKeys(address: string, updates: Partial<AccountViewingKeyStorage>): void {
        const current = this.getViewingKeys(address);
        const merged = { ...current, ...updates };
        this.backend.setItem(this._key(address, 'viewing_keys'), JSON.stringify(merged));
    }

    // ActivityPub
    public getActivityPubNotes(address: string): ScopedActivityPubNote[] {
        const raw = this.backend.getItem(this._key(address, 'activitypub'));
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch (_) {
            return [];
        }
    }

    public saveActivityPubNote(address: string, note: ScopedActivityPubNote): void {
        const notes = this.getActivityPubNotes(address);
        const isDup = notes.some(n => n.id === note.id || (n.content === note.content && Math.abs((n.timestamp || 0) - (note.timestamp || 0)) < 30000));
        if (!isDup) {
            notes.unshift(note);
            if (notes.length > 100) notes.length = 100;
            this.backend.setItem(this._key(address, 'activitypub'), JSON.stringify(notes));
        }
    }

    // Transactions
    public getTransactionHistory(address: string): ScopedTransactionHistoryEntry[] {
        const raw = this.backend.getItem(this._key(address, 'txs'));
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch (_) {
            return [];
        }
    }

    public saveTransaction(address: string, tx: ScopedTransactionHistoryEntry): void {
        const txs = this.getTransactionHistory(address);
        if (!txs.some(t => t.hash && t.hash.toLowerCase() === tx.hash.toLowerCase())) {
            txs.unshift(tx);
            if (txs.length > 100) txs.length = 100;
            this.backend.setItem(this._key(address, 'txs'), JSON.stringify(txs));
        }
    }

    // Blobs / Content Addressing
    public saveBlob(cid: string, data: Uint8Array | string): void {
        const str = typeof data === 'string' ? data : Array.from(data).map(b => String.fromCharCode(b)).join('');
        this.backend.setItem(`blobs/${cid}`, typeof btoa !== 'undefined' ? btoa(str) : str);
    }

    public getBlob(cid: string): string | null {
        return this.backend.getItem(`blobs/${cid}`);
    }
}

/**
 * Universal Decryption Helper (PBKDF2 + AES-GCM)
 * Works in both browser and headless Node.js testing environments.
 */
export async function decryptData(encryptedBase64: any, password: string): Promise<string> {
    if (!encryptedBase64) {
        throw new Error("No keystore payload provided.");
    }
    if (typeof encryptedBase64 === 'object') {
        if (encryptedBase64.auxiliary_seed) {
            return JSON.stringify(encryptedBase64);
        }
        if (encryptedBase64.ciphertext) {
            encryptedBase64 = encryptedBase64.ciphertext;
        } else if (encryptedBase64.keystore) {
            encryptedBase64 = encryptedBase64.keystore;
        } else {
            return JSON.stringify(encryptedBase64);
        }
    }
    if (typeof encryptedBase64 === 'string' && (encryptedBase64.trim().startsWith('{') || encryptedBase64.trim().startsWith('['))) {
        try {
            const parsed = JSON.parse(encryptedBase64);
            if (parsed.auxiliary_seed) return encryptedBase64;
            if (parsed.ciphertext) encryptedBase64 = parsed.ciphertext;
            else if (parsed.keystore) encryptedBase64 = parsed.keystore;
        } catch (_) {}
    }
    if (typeof encryptedBase64 !== 'string') {
        throw new Error("Keystore payload must be a string or JSON object.");
    }

    const cleanB64 = encryptedBase64.trim().replace(/\s/g, '');
    let rawBinary: string;
    try {
        rawBinary = typeof atob !== 'undefined'
            ? atob(cleanB64)
            : Buffer.from(cleanB64, 'base64').toString('binary');
    } catch (e) {
        throw new Error("Keystore data is not valid base64 encoded text.");
    }

    const buffer = new Uint8Array(rawBinary.length);
    for (let i = 0; i < rawBinary.length; i++) {
        buffer[i] = rawBinary.charCodeAt(i);
    }
    if (buffer.length < 28) {
        throw new Error("Keystore buffer is too short to contain valid salt and IV.");
    }
    const salt = buffer.slice(0, 16);
    const iv = buffer.slice(16, 28);
    const ciphertext = buffer.slice(28);

    const subtle = (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle)
        ? globalThis.crypto.subtle
        : ((typeof window !== 'undefined' && window.crypto?.subtle) ? window.crypto.subtle : null);

    if (!subtle) {
        throw new Error("Web Cryptography API (crypto.subtle) is unavailable in current environment.");
    }

    const encoder = new TextEncoder();
    const passwordKey = await subtle.importKey(
        "raw",
        encoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    const key = await subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        passwordKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
    );
    const decrypted = await subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        ciphertext
    );
    return new TextDecoder().decode(decrypted);
}

