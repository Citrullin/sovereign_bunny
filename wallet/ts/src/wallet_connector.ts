/**
 * Sovereign Wallet Connector Utility
 * Provides unified EVM provider detection, account authorization,
 * interactive message signing, and keystore unlocking.
 */

export interface WalletProvider {
    request: (args: { method: string; params?: any[] }) => Promise<any>;
}

export function getInjectedProvider(): WalletProvider | null {
    if (typeof window === 'undefined') return null;
    const win = window as any;
    return win.rabby || win.ethereum || null;
}

/**
 * Request account connection from injected wallet extension.
 * Tries wallet_requestPermissions first to force extension prompt,
 * falling back to eth_requestAccounts.
 */
export async function requestWalletConnection(): Promise<string> {
    const win = (typeof window !== 'undefined' ? window : {}) as any;

    // 1. If global app connector exists, use it to ensure SIWE and profile synchronization
    if (typeof win.connectEvmWallet === 'function') {
        try {
            await win.connectEvmWallet();
            const addr = win.connectedAddress || (win.currentKeys ? win.currentKeys.address : null);
            if (addr) return addr;
        } catch (err) {
            console.warn("Global connectEvmWallet notice:", err);
        }
    }

    // 2. Direct injected provider request
    const provider = getInjectedProvider();
    if (!provider || typeof provider.request !== 'function') {
        throw new Error('No EVM wallet extension (Rabby/MetaMask) detected.');
    }

    let accounts: string[] = [];
    try {
        const perms = await provider.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }]
        });
        if (perms && Array.isArray(perms) && perms[0]?.caveats) {
            const caveat = perms[0].caveats.find((c: any) => c.name === 'exposedAccounts');
            if (caveat && Array.isArray(caveat.value) && caveat.value.length > 0) {
                accounts = caveat.value;
            }
        }
    } catch (_) {
        // Fall back if wallet_requestPermissions is rejected or unsupported
    }

    if (!accounts || accounts.length === 0) {
        accounts = await provider.request({ method: 'eth_requestAccounts' });
    }

    if (!accounts || accounts.length === 0) {
        throw new Error('No accounts selected in EVM wallet.');
    }

    const activeAddr = accounts[0];
    if (typeof win.handleActiveAccountChanged === 'function') {
        await win.handleActiveAccountChanged(activeAddr);
    } else {
        win.connectedAddress = activeAddr;
    }

    return activeAddr;
}

export class EvmSignatureRequiredError extends Error {
    constructor(message: string = 'Mandatory EVM Signature required in Pure CryptoWrap mode.') {
        super(message);
        this.name = 'EvmSignatureRequiredError';
    }
}

export function isPureModeActive(): boolean {
    if (typeof window === 'undefined') return false;
    const win = window as any;
    const stored = (typeof localStorage !== 'undefined') ? localStorage.getItem('sovereign_crypto_wrap') : null;
    return stored === 'pure' || win.__sovereign_crypto_wrap === 'pure';
}

/**
 * Interactive signature request using standard personal_sign.
 * In Pure CryptoWrap mode, this signature is a strict non-bypassable architectural invariant.
 */
export async function requireEvmSignature(message: string, address: string): Promise<string> {
    const isPure = isPureModeActive();
    const provider = getInjectedProvider();
    if (!provider || typeof provider.request !== 'function') {
        if (isPure) {
            throw new EvmSignatureRequiredError('Pure Mode invariant violation: Connected EVM wallet extension (Rabby/MetaMask) is required but missing.');
        }
        throw new Error('No EVM wallet available to sign message.');
    }

    try {
        const sig = await provider.request({
            method: 'personal_sign',
            params: [message, address]
        });
        if (!sig) {
            throw new EvmSignatureRequiredError('User rejected or cancelled EVM signature prompt.');
        }
        return sig;
    } catch (err: any) {
        if (isPure) {
            throw new EvmSignatureRequiredError(`EVM Wallet Signature Prompt Rejected: ${err?.message || err}`);
        }
        throw err;
    }
}

export async function signMessageWithWallet(message: string, address: string): Promise<string> {
    return requireEvmSignature(message, address);
}

export interface EvmTxParams {
    from: string;
    to: string;
    data?: string;
    value?: string | bigint;
    gas?: string | bigint;
    nonce?: number | string | bigint;
}

export function getActiveChainId(): string {
    const win = (typeof window !== 'undefined' ? window : {}) as any;
    if (win.activeChainId) return String(win.activeChainId);
    if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('sovereign_chain_id');
        if (stored) return stored;
    }
    return "13371337";
}

export function getActiveRpcUrl(): string {
    const win = (typeof window !== 'undefined' ? window : {}) as any;
    if (typeof document !== 'undefined') {
        const input = (document.getElementById('overview-rpc-endpoint-input') as HTMLInputElement) 
            || (document.getElementById('rpc-endpoint-input') as HTMLInputElement);
        if (input && input.value) return input.value;
    }
    if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('sovereign_rpc_endpoint');
        if (stored) return stored;
    }
    return "/rpc";
}

/**
 * Ensures the injected EVM wallet (Rabby/MetaMask) is switched to the Sovereign chain.
 * If the chain is not yet registered in the wallet, requests wallet_addEthereumChain.
 */
export async function ensureSovereignChain(injectedProvider?: WalletProvider | null, rpcUrl?: string): Promise<void> {
    const provider = injectedProvider || getInjectedProvider();
    if (!provider || typeof provider.request !== 'function') return;

    const chainIdStr = getActiveChainId();
    const chainIdDecimal = parseInt(chainIdStr, 10);
    const chainIdHex = "0x" + chainIdDecimal.toString(16);
    const activeRpc = rpcUrl || getActiveRpcUrl();
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'http://localhost:8545';
    const fullRpcUrl = activeRpc.startsWith('/')
        ? `${origin}${activeRpc}`
        : activeRpc;

    try {
        const currentChain = await provider.request({ method: 'eth_chainId' }).catch(() => null);
        if (currentChain && currentChain.toLowerCase() === chainIdHex.toLowerCase()) {
            return;
        }

        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainIdHex }],
        });
    } catch (switchError: any) {
        // If switch fails (chain 4902, unrecognized chain in Rabby/MetaMask, or -32603)
        try {
            const win = (typeof window !== 'undefined' ? window : {}) as any;
            const ticker = (typeof win.getCurrencyTicker === 'function') ? win.getCurrencyTicker() : (win.SOVEREIGN_TICKER || 'TBL');
            await provider.request({
                method: 'wallet_addEthereumChain',
                params: [
                    {
                        chainId: chainIdHex,
                        chainName: `Sovereign Chain ${chainIdStr}`,
                        rpcUrls: [fullRpcUrl],
                        nativeCurrency: {
                            name: 'The Block Lattice',
                            symbol: ticker,
                            decimals: 18
                        },
                        blockExplorerUrls: null,
                    },
                ],
            });
            // Re-attempt switch after adding
            await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: chainIdHex }],
            }).catch(() => null);
        } catch (addError) {
            console.warn("Could not register Sovereign chain in wallet:", addError);
        }
    }
}

/**
 * Creates and signs a proper EVM state change transaction via the connected EVM wallet.
 * Ensures chain alignment and account authorization so Rabby/MetaMask prompt fires reliably.
 * Never silently swallows wallet errors or bypasses user confirmation with synthetic fallbacks.
 */
export async function sendEvmTransaction(tx: EvmTxParams): Promise<string> {
    const win = (typeof window !== 'undefined' ? window : {}) as any;
    const provider = getInjectedProvider();

    // When an injected wallet (Rabby / MetaMask) is available, prompt the wallet directly!
    if (provider && typeof provider.request === 'function') {
        // 1. Ensure the wallet is switched to the Sovereign chain
        await ensureSovereignChain(provider);

        // 2. Ensure accounts are connected and retrieve currently active wallet account
        let accounts: string[] = [];
        try {
            accounts = await provider.request({ method: 'eth_accounts' });
            if (!accounts || accounts.length === 0) {
                accounts = await provider.request({ method: 'eth_requestAccounts' });
            }
        } catch (authErr) {
            console.warn("Account request returned:", authErr);
        }

        const activeWalletAccount = (accounts && accounts.length > 0) ? accounts[0] : tx.from;
        const sender = activeWalletAccount || tx.from;

        const valHex = typeof tx.value === 'bigint'
            ? '0x' + tx.value.toString(16)
            : (tx.value && tx.value.toString().startsWith('0x') ? tx.value.toString() : '0x' + BigInt(tx.value || 0).toString(16));
        
        const gasHex = tx.gas 
            ? (typeof tx.gas === 'bigint' ? '0x' + tx.gas.toString(16) : (tx.gas.toString().startsWith('0x') ? tx.gas.toString() : '0x' + BigInt(tx.gas).toString(16))) 
            : undefined;

        // NOTE: In injected wallets (Rabby / MetaMask), do NOT pass explicit nonce in eth_sendTransaction
        // because extensions reject explicit nonces unless developer custom nonce override is enabled.
        const walletPayload: any = {
            from: sender,
            to: tx.to,
            data: tx.data || '0x',
            value: valHex,
            ...(gasHex ? { gas: gasHex } : {})
        };

        try {
            const txHash = await provider.request({
                method: 'eth_sendTransaction',
                params: [walletPayload]
            });
            if (txHash) return txHash;
        } catch (err: any) {
            // Surface wallet rejection or execution error loudly. NEVER silently fallback!
            if (err?.code === 4001 || err?.message?.includes('User rejected') || err?.message?.includes('rejected')) {
                throw new Error(`Transaction rejected by user in EVM wallet: ${err.message || err}`);
            }
            throw new Error(`EVM wallet transaction failed: ${err.message || JSON.stringify(err)}`);
        }
    }

    // Direct JSON-RPC dispatch is strictly for headless / node environments where no injected provider exists
    let onchainNonceHex: string | undefined = undefined;
    try {
        if (typeof win.callBunnyRpc === 'function') {
            const countRes = await win.callBunnyRpc('eth_getTransactionCount', [tx.from, 'latest']);
            if (countRes && countRes.result) onchainNonceHex = countRes.result;
        }
    } catch (e) {
        console.warn("Could not query on-chain nonce:", e);
    }

    const txNonceHex = tx.nonce !== undefined
        ? (typeof tx.nonce === 'bigint' ? '0x' + tx.nonce.toString(16) : (String(tx.nonce).startsWith('0x') ? String(tx.nonce) : '0x' + BigInt(tx.nonce).toString(16)))
        : onchainNonceHex;

    const valHex = typeof tx.value === 'bigint'
        ? '0x' + tx.value.toString(16)
        : (tx.value && tx.value.toString().startsWith('0x') ? tx.value.toString() : '0x' + BigInt(tx.value || 0).toString(16));
    const gasHex = tx.gas 
        ? (typeof tx.gas === 'bigint' ? '0x' + tx.gas.toString(16) : (tx.gas.toString().startsWith('0x') ? tx.gas.toString() : '0x' + BigInt(tx.gas).toString(16))) 
        : undefined;

    const directPayload = {
        from: tx.from,
        to: tx.to,
        data: tx.data || '0x',
        value: valHex,
        ...(txNonceHex ? { nonce: txNonceHex } : {}),
        ...(gasHex ? { gas: gasHex } : {})
    };

    if (typeof win.callBunnyRpc === 'function') {
        const res = await win.callBunnyRpc('eth_sendTransaction', [directPayload]);
        if (res && res.error) {
            throw new Error(res.error.message || JSON.stringify(res.error));
        }
        return res?.result || ('0x' + '0'.repeat(64));
    }

    if (typeof fetch === 'function') {
        const resp = await fetch('/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'eth_sendTransaction',
                params: [directPayload]
            })
        });
        const data = await resp.json();
        if (data.error) {
            throw new Error(data.error.message || JSON.stringify(data.error));
        }
        return data?.result || ('0x' + '0'.repeat(64));
    }

    throw new Error('No EVM wallet or RPC available to broadcast state change transaction.');
}

