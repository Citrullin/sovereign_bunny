// Ambient type declarations for browser extensions, inlined WASM, and SDK globals

import type { ethers as EthersType } from 'ethers';
import type { SovereignClient } from '../client.js';
import type { SovereignDebugger } from '../debugger.js';
import type { AccountStorageManager } from '../storage_manager.js';
import type { W3cDidDocument } from '../types.js';
import type { GenesisVoucherItem } from '../circuits.js';

export interface WalletProfile {
    address: string;
    did: string;
    did_document?: W3cDidDocument;
    keystore?: string | any;
    registered?: boolean;
    [key: string]: any;
}

export interface DecryptedAccountKeys {
    address: string;
    did: string;
    did_document?: W3cDidDocument;
    keystore?: string | any;
    registered?: boolean;
    auxiliary_seed?: string;
    signing_key?: string;
    private_key?: string;
    [key: string]: any;
}

declare global {
    const ethers: typeof EthersType;
    const wasmBytes: Uint8Array;
    function wasm_bindgen(bytes: Uint8Array): Promise<any>;

    interface Window {
        ethereum?: any;
        rabby?: any;
        sovereignClient?: SovereignClient;
        wasm_bindgen?: (bytes: Uint8Array) => Promise<any>;
        promptPqSignature?: (reqOrTarget: any, summary?: string, calldata?: string) => Promise<boolean>;
        showNesToast?: (message: string, type?: string, duration?: number) => void;
        getCurrencyTicker?: () => string;
        setCurrencyTicker?: (ticker: string) => void;
        updateCurrencyDisplays?: () => void;
        absorbBlindNote?: () => Promise<void>;
        handleGenesisVoucherFile?: (event: any) => Promise<void>;
        populateVoucherForm?: (idx: number) => void;
        claimGenesisVoucher?: (idx: number) => Promise<void>;
        lastAnalyzedCalldata?: string;
        lastAnalyzedTarget?: string;
        lastExecutedResult?: string;
        lastDecodedFields?: any[];
        lastAnalyzedSelector?: string;
        executeAnalyzedPayload?: () => Promise<void>;
        SOVEREIGN_TICKER?: string;
        [key: string]: any;
    }
}
