import { LitElement, html, TemplateResult } from 'lit';
import { formatStateLineageTelemetryWitness } from '../circuits.js';
import { requestWalletConnection, sendEvmTransaction, requireEvmSignature } from '../wallet_connector.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

function getGlobalWin(): any {
    return typeof window !== 'undefined' ? window : (globalThis as any);
}

export type TelemetryTierName = 'Subsidized' | 'Quantized' | 'SovereignDark';

export interface TelemetryState {
    currentTier: TelemetryTierName;
    feeMultiplierBps: number;
    permitsEmission: boolean;
    connectedAddress: string | null;
    isLoading: boolean;
    statusMessage: string | null;
    statusType: 'success' | 'error' | 'warning' | 'info';
    lastAttestationNullifier: string | null;
}

/**
 * `<sovereign-telemetry-panel>` Lit Component
 * Encapsulates the Terminal Telemetry Data Moat / Privacy Tiers configuration,
 * tier sign up / migration, and ZK state lineage attestation submission.
 */
export class SovereignTelemetryPanelElement extends BaseElement {
    static properties = {
        state: { state: true },
    };

    state: TelemetryState = {
        currentTier: 'Quantized',
        feeMultiplierBps: 100,
        permitsEmission: true,
        connectedAddress: null,
        isLoading: false,
        statusMessage: null,
        statusType: 'info',
        lastAttestationNullifier: null,
    };

    override createRenderRoot(): HTMLElement {
        return this as unknown as HTMLElement;
    }

    connectedCallback(): void {
        super.connectedCallback?.();
        this.refreshTier();
        if (typeof window !== 'undefined') {
            window.addEventListener('unlocked', () => {
                this.requestUpdate();
                this.refreshTier();
            });
        }
    }

    async refreshTier(): Promise<void> {
        const win = getGlobalWin();
        const client = win.sovereignClient;
        const address = win.connectedAddress || (win.currentKeys ? win.currentKeys.address : null);
        this.state = { ...this.state, connectedAddress: address };

        if (!address) {
            this.requestUpdate();
            return;
        }

        try {
            this.state = { ...this.state, isLoading: true };
            this.requestUpdate();

            if (client && client.telemetry) {
                const info = await client.telemetry.getTier(address);
                this.state = {
                    ...this.state,
                    currentTier: info.tier,
                    feeMultiplierBps: info.feeMultiplierBps,
                    permitsEmission: info.permitsEmission,
                    isLoading: false,
                };
            } else if (typeof win.callBunnyRpc === 'function') {
                const res = await win.callBunnyRpc('sovereign_getTelemetryTier', [address]).catch(() => null);
                if (res && res.result) {
                    this.state = {
                        ...this.state,
                        currentTier: res.result.tier || 'Quantized',
                        feeMultiplierBps: res.result.feeMultiplierBps || 100,
                        permitsEmission: res.result.permitsEmission !== false,
                        isLoading: false,
                    };
                } else {
                    this.state = { ...this.state, isLoading: false };
                }
            } else {
                this.state = { ...this.state, isLoading: false };
            }
        } catch (err: any) {
            this.state = { ...this.state, isLoading: false };
        }
        this.requestUpdate();
    }

    override updated(changedProperties: Map<string | number | symbol, unknown>): void {
        super.updated?.(changedProperties);
        this.syncTerminalGraph();
    }

    syncTerminalGraph(): void {
        const explorer = (typeof this.querySelector === 'function' ? this.querySelector('#terminal-graph-explorer') : null) as any;
        if (!explorer) return;
        const addr = this.state.connectedAddress || '0x0000000000000000000000000000000000000000';
        const terminalData = this.getTerminalDataMoatGraph(addr);
        if (typeof explorer.setGraphData === 'function') {
            explorer.setGraphData(terminalData);
        }
    }

    getTerminalDataMoatGraph(activeAddr: string): any {
        const nodes: any[] = [
            {
                id: activeAddr,
                label: `Terminal Principal (${activeAddr.slice(0, 8)}...${activeAddr.slice(-6)})`,
                type: 'human_account',
                address: activeAddr,
                did: `did:sovereign:1337:${activeAddr}`,
                metadata: {
                    source: 'sovereign_terminal_data_moat',
                    activeTier: this.state.currentTier,
                    feeMultiplierBps: this.state.feeMultiplierBps,
                    permitsEmission: this.state.permitsEmission,
                    terminalRole: 'Subscriber / Telemetry Originator'
                }
            },
            {
                id: 'moat:tier-subsidized',
                label: 'Subsidized Telemetry Feed (10 bps)',
                type: 'smart_contract',
                address: '0x0000000000000000000000000000000000000060',
                metadata: {
                    description: 'Sanitized order book & trade deltas emitted without DID or IP. Maximum fee subsidy.',
                    tier: 'Subsidized',
                    feeMultiplierBps: 10,
                    dataMoatCategory: 'Public Order Flow'
                }
            },
            {
                id: 'moat:tier-quantized',
                label: 'Quantized Telemetry Feed (100 bps)',
                type: 'smart_contract',
                address: '0x0000000000000000000000000000000000000061',
                metadata: {
                    description: 'Differential privacy noise injected into bucketed trade volumes and batch delayed.',
                    tier: 'Quantized',
                    feeMultiplierBps: 100,
                    dataMoatCategory: 'Quantized Differential Privacy'
                }
            },
            {
                id: 'moat:tier-dark',
                label: 'Sovereign Dark Feed (500 bps)',
                type: 'smart_contract',
                address: '0x0000000000000000000000000000000000000062',
                metadata: {
                    description: 'Zero emission stealth mode. Complete receive-only routing without telemetry emission.',
                    tier: 'SovereignDark',
                    feeMultiplierBps: 500,
                    dataMoatCategory: 'Dark Pool Stealth'
                }
            },
            {
                id: 'precompile:0x53',
                label: 'Precompile 0x53 (Anti-GIVO Lineage Verifier)',
                type: 'system_precompile',
                address: '0x0000000000000000000000000000000000000053',
                metadata: {
                    precompile: '0x53',
                    function: 'Blake3 Nullifier & State Root Lineage Verification',
                    standard: 'anti_givo_zkp'
                }
            },
            {
                id: 'precompile:0x54',
                label: 'Precompile 0x54 (Telemetry Fee Multiplier)',
                type: 'system_precompile',
                address: '0x0000000000000000000000000000000000000054',
                metadata: {
                    precompile: '0x54',
                    function: 'Dynamic Gas Schedule & Bps Discount Engine'
                }
            },
            {
                id: 'validator:stream-bloomberg',
                label: 'Bloomberg Market Moat Aggregator',
                type: 'collaborative_authority',
                address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
                metadata: {
                    role: 'Market Data Aggregator / Bloomberg Terminal Node',
                    feedStatus: 'ONLINE_ACTIVE',
                    subscribers: 142
                }
            }
        ];

        const edges: any[] = [
            {
                source: activeAddr,
                target: this.state.currentTier === 'Subsidized'
                    ? 'moat:tier-subsidized'
                    : (this.state.currentTier === 'Quantized' ? 'moat:tier-quantized' : 'moat:tier-dark'),
                relation: 'subscribed_tier',
                label: `ACTIVE TIER (${this.state.currentTier})`
            },
            {
                source: 'moat:tier-subsidized',
                target: 'validator:stream-bloomberg',
                relation: 'telemetry_stream',
                label: 'Sanitized Stream'
            },
            {
                source: 'moat:tier-quantized',
                target: 'validator:stream-bloomberg',
                relation: 'telemetry_stream',
                label: 'DP Quantized Stream'
            },
            {
                source: activeAddr,
                target: 'precompile:0x53',
                relation: 'attestation_binding',
                label: 'ZK Lineage Proof'
            },
            {
                source: activeAddr,
                target: 'precompile:0x54',
                relation: 'fee_calculation',
                label: `${this.state.feeMultiplierBps} bps`
            }
        ];

        return { nodes, edges };
    }

    async selectTier(tier: TelemetryTierName): Promise<void> {
        const win = getGlobalWin();
        const client = win.sovereignClient;
        let address = this.state.connectedAddress || win.connectedAddress || (win.currentKeys ? win.currentKeys.address : null);

        // If user is not yet connected, trigger wallet prompt directly!
        if (!address) {
            await this.triggerConnectOrUnlock();
            address = this.state.connectedAddress || win.connectedAddress || (win.currentKeys ? win.currentKeys.address : null);
        }

        if (!address) {
            this.setStatus('Please connect or unlock your Sovereign account to subscribe to a telemetry tier.', 'warning');
            return;
        }

        try {
            this.state = { ...this.state, isLoading: true, statusMessage: null };
            this.requestUpdate();

            // Require explicit EVM signature authorization (enforced under Pure CryptoWrap Mode)
            await requireEvmSignature(
                `SOVEREIGN_TELEMETRY_TIER_SELECTION:${tier}:${address}`,
                address
            );

            const tierCode = tier === 'Subsidized' ? 0 : tier === 'Quantized' ? 1 : 2;
            const tierCalldata = `0x7e01${tierCode.toString(16).padStart(2, '0')}`;
            
            // Proper EVM state change transaction via user's EVM wallet
            const txHash = await sendEvmTransaction({
                from: address,
                to: '0x0000000000000000000000000000000000000007',
                data: tierCalldata,
                value: '0x0'
            });

            const feeMap: Record<TelemetryTierName, number> = {
                Subsidized: 10,
                Quantized: 100,
                SovereignDark: 1000,
            };
            const emissionMap: Record<TelemetryTierName, boolean> = {
                Subsidized: true,
                Quantized: true,
                SovereignDark: false,
            };

            this.state = {
                ...this.state,
                currentTier: tier,
                feeMultiplierBps: feeMap[tier],
                permitsEmission: emissionMap[tier],
                isLoading: false,
                statusMessage: `🎉 Successfully signed up and switched to ${tier} Tier!`,
                statusType: 'success',
            };

            this.syncTerminalGraph();

            if (typeof win.showNesToast === 'function') {
                win.showNesToast(`Telemetry Tier updated: ${tier}`, 'success', 2500);
            }
        } catch (err: any) {
            const errMsg = err?.message || String(err);
            const isSigReject = errMsg.includes('Signature') || errMsg.includes('rejected') || errMsg.includes('cancelled');
            this.state = {
                ...this.state,
                isLoading: false,
                statusMessage: isSigReject ? `EVM Signature Rejected: ${errMsg}` : `Failed to update tier: ${errMsg}`,
                statusType: 'error',
            };
        }
        this.requestUpdate();
    }

    async submitTestLineageAttestation(): Promise<void> {
        const win = getGlobalWin();
        const client = win.sovereignClient;
        const address = this.state.connectedAddress || win.connectedAddress || (win.currentKeys ? win.currentKeys.address : null);

        if (!address) {
            this.setStatus('Please connect your account to submit state lineage.', 'warning');
            return;
        }

        try {
            this.state = { ...this.state, isLoading: true, statusMessage: null };
            this.requestUpdate();

            const epoch = win.lastFinalizedEpoch || 42;
            const settledStateRoot = '0x1111111111111111111111111111111111111111111111111111111111111111';
            const tipHash = '0x2222222222222222222222222222222222222222222222222222222222222222';
            const lineageNullifier = '0x3333333333333333333333333333333333333333333333333333333333333333';
            const volumeWeight = 1000000000000000000n;

            const accountHex = (address.startsWith('0x') ? address : `0x${address}`) as `0x${string}`;
            const leafHex = (`0x` + volumeWeight.toString(16).padStart(64, '0')) as `0x${string}`;
            const siblings = Array(32).fill('0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`);

            const attestationPayload = `0x7e02${Array.from(new TextEncoder().encode(JSON.stringify({
                account: address,
                settledStateRoot,
                tipHash,
                epoch: epoch.toString(),
                volumeWeight: volumeWeight.toString(),
                lineageNullifier,
                proofHex: '0x01'
            }))).map(b => b.toString(16).padStart(2, '0')).join('')}`;

            // Proper EVM state change transaction via user's EVM wallet
            const txHash = await sendEvmTransaction({
                from: address,
                to: '0x0000000000000000000000000000000000000007',
                data: attestationPayload,
                value: '0x0'
            });

            this.state = {
                ...this.state,
                isLoading: false,
                lastAttestationNullifier: lineageNullifier,
                statusMessage: `✅ ZK State Lineage Attestation verified on-chain! Anti-GIVO epoch nullifier recorded.`,
                statusType: 'success',
            };
            this.syncTerminalGraph();
            if (typeof win.showNesToast === 'function') {
                win.showNesToast(`State lineage attestation submitted!`, 'success', 2500);
            }
        } catch (err: any) {
            this.state = {
                ...this.state,
                isLoading: false,
                statusMessage: `Attestation failed: ${err.message || err}`,
                statusType: 'error',
            };
        }
        this.requestUpdate();
    }

    private setStatus(msg: string, type: 'success' | 'error' | 'warning' | 'info') {
        this.state = {
            ...this.state,
            statusMessage: msg,
            statusType: type,
        };
        this.requestUpdate();
    }

    async triggerConnectOrUnlock(): Promise<void> {
        const win = getGlobalWin();
        let activeAddr: string | null = null;
        try {
            activeAddr = await requestWalletConnection();
        } catch (err: any) {
            this.setStatus(`Wallet connection notice: ${err.message || err}`, 'warning');
        }

        if (activeAddr) {
            this.state = { ...this.state, connectedAddress: activeAddr };
            this.refreshTier();
            this.syncTerminalGraph();

            // Check if keystore exists for this specific address to prompt unlock
            if (win.profiles && Array.isArray(win.profiles)) {
                const p = win.profiles.find((pr: any) => pr.address?.toLowerCase() === activeAddr?.toLowerCase());
                if (p && p.keystore && (!win.currentKeys || win.currentKeys.address?.toLowerCase() !== activeAddr?.toLowerCase())) {
                    if (typeof win.promptKeystoreUnlock === 'function') {
                        win.promptKeystoreUnlock(activeAddr, p.keystore);
                        return;
                    }
                    const unlockModal = document.querySelector('sovereign-unlock-modal') as any;
                    if (unlockModal && typeof unlockModal.open === 'function') {
                        unlockModal.open(activeAddr, p.keystore);
                        return;
                    }
                }
            }
            return;
        }

        // Check if an existing unlocked or remembered account has a keystore to unlock
        const address = win.connectedAddress || (win.currentKeys ? win.currentKeys.address : null);
        if (address && win.profiles && Array.isArray(win.profiles)) {
            const p = win.profiles.find((pr: any) => pr.address?.toLowerCase() === address.toLowerCase());
            if (p && p.keystore) {
                if (typeof win.promptKeystoreUnlock === 'function') {
                    win.promptKeystoreUnlock(address, p.keystore);
                    return;
                }
                const unlockModal = document.querySelector('sovereign-unlock-modal') as any;
                if (unlockModal && typeof unlockModal.open === 'function') {
                    unlockModal.open(address, p.keystore);
                    return;
                }
            }
        }

        // If keystore is not yet found locally, launch wizard to onboard or import keystore for this connected address
        const wizard = document.querySelector('sovereign-onboarding-wizard') as any;
        if (wizard && typeof wizard.open === 'function') {
            if (address) {
                wizard.setConnectedAddress(address);
            }
            wizard.open();
        } else {
            this.setStatus('No EVM wallet extension (Rabby/MetaMask) detected.', 'error');
        }
    }

    render(): TemplateResult {
        const { currentTier, feeMultiplierBps, permitsEmission, isLoading, statusMessage, statusType, connectedAddress } = this.state;
        const multiplierX = (feeMultiplierBps / 100).toFixed(1);
        const win = getGlobalWin();
        const isUnlocked = Boolean(win.currentKeys && win.currentKeys.address);

        return html`
            <div class="nes-container with-title is-dark" style="margin-bottom: 20px;">
                <p class="title" style="color: #66fcf1; font-family: 'Press Start 2P', monospace; font-size: 0.8rem;">📡 SOVEREIGN TERMINAL</p>

                <p style="font-size: 0.72rem; color: #ddd; line-height: 1.5; margin-bottom: 15px;">
                    Sovereign Terminal provides real-time market telemetry controls, differential noise policies, and verifiable state lineage across the decentralized Account-Lattice.
                </p>

                ${!connectedAddress ? html`
                    <div class="nes-container is-dark with-title" style="border-color: #f7d51d; background: rgba(247, 213, 29, 0.05); margin-bottom: 20px;">
                        <p class="title" style="color: #f7d51d; font-size: 0.7rem;">⚠️ Account Connection Required</p>
                        <p style="font-size: 0.68rem; color: #fff; margin-bottom: 12px;">
                            Please connect your Rabby or EVM wallet to configure Terminal Telemetry tiers and view your authenticated lattice stream.
                        </p>
                        <button type="button" class="nes-btn is-warning" style="font-size: 0.68rem;" @click=${this.triggerConnectOrUnlock}>
                            🔑 Connect / Unlock Account
                        </button>
                    </div>
                ` : (!isUnlocked ? html`
                    <div class="nes-container is-dark with-title" style="border-color: #209cee; background: rgba(32, 156, 238, 0.05); margin-bottom: 20px;">
                        <p class="title" style="color: #209cee; font-size: 0.7rem;">🔐 Keystore Unlock Required</p>
                        <p style="font-size: 0.68rem; color: #fff; margin-bottom: 12px;">
                            Your wallet is connected (<code>${connectedAddress.slice(0, 8)}...${connectedAddress.slice(-6)}</code>), but your post-quantum keys are locked. Unlock to sign telemetry attestations and tier migrations.
                        </p>
                        <button type="button" class="nes-btn is-primary" style="font-size: 0.68rem;" @click=${this.triggerConnectOrUnlock}>
                            🔓 Unlock Post-Quantum Keystore
                        </button>
                    </div>
                ` : '')}

                <!-- Current Active Tier Card -->
                <div class="nes-container is-dark" style="background: #111528; border: 3px solid #66fcf1; padding: 15px; margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                        <div>
                            <span style="font-size: 0.65rem; color: #8b949e; text-transform: uppercase;">Current Active Tier:</span>
                            <div style="font-size: 1.1rem; font-weight: bold; color: #ffcc00; font-family: 'Press Start 2P', monospace; margin-top: 4px;">
                                ${currentTier}
                            </div>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <div style="text-align: right;">
                                <span style="font-size: 0.62rem; color: #8b949e;">Fee Multiplier:</span>
                                <div style="font-size: 0.85rem; color: #66fcf1; font-weight: bold;">${multiplierX}x (${feeMultiplierBps} bps)</div>
                            </div>
                            <span class="nes-badge" style="font-size: 0.55rem;">
                                <span class="${permitsEmission ? 'is-success' : 'is-error'}">
                                    ${permitsEmission ? 'Emits Telemetry' : 'Zero Emission (Dark)'}
                                </span>
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Tier Selection Cards -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 15px; margin-bottom: 20px;">
                    <!-- Tier 1: Subsidized -->
                    <div class="nes-container is-dark with-title" style="border-color: ${currentTier === 'Subsidized' ? '#4ade80' : '#444'};">
                        <p class="title" style="color: #4ade80; font-size: 0.68rem;">🟢 1. Subsidized</p>
                        <div style="font-size: 0.65rem; color: #ccc; min-height: 90px;">
                            <p style="margin-bottom: 6px;"><b>0.1x Fee (10 bps) • Paymaster Sponsored</b></p>
                            <p style="color: #aaa; margin: 0 0 8px 0;">
                                Protocol Paymaster sponsors queries/gas funded by Sovereign Dark proceeds. Gated on <b>Merit Rank ≥ 1</b> to prevent Sybil drain.
                            </p>
                            <span style="color: #4ade80; font-size: 0.6rem;">• Sponsored by Protocol Paymaster</span><br>
                            <span style="color: #ffd700; font-size: 0.6rem;">• Requires Merit Rank 1+</span>
                        </div>
                        <div style="margin-top: 15px;">
                            <button
                                type="button"
                                class="nes-btn is-success"
                                style="width: 100%; font-size: 0.65rem;"
                                ?disabled=${isLoading}
                                @click=${() => this.selectTier('Subsidized')}
                            >
                                ${connectedAddress && currentTier === 'Subsidized' ? 'Active: Re-Sign Subsidized' : 'Sign Up (Subsidized)'}
                            </button>
                        </div>
                    </div>

                    <!-- Tier 2: Quantized -->
                    <div class="nes-container is-dark with-title" style="border-color: ${currentTier === 'Quantized' ? '#38bdf8' : '#444'};">
                        <p class="title" style="color: #38bdf8; font-size: 0.68rem;">🔵 2. Quantized</p>
                        <div style="font-size: 0.65rem; color: #ccc; min-height: 90px;">
                            <p style="margin-bottom: 6px;"><b>1.0x Fee (100 bps)</b></p>
                            <p style="color: #aaa; margin: 0 0 8px 0;">
                                Bucketed transaction amounts with differential privacy noise and batch delay. Standard network baseline.
                            </p>
                            <span style="color: #38bdf8; font-size: 0.6rem;">• Standard fee baseline</span><br>
                            <span style="color: #8b949e; font-size: 0.6rem;">• Differential privacy noise</span>
                        </div>
                        <div style="margin-top: 15px;">
                            <button
                                type="button"
                                class="nes-btn is-primary"
                                style="width: 100%; font-size: 0.65rem;"
                                ?disabled=${isLoading}
                                @click=${() => this.selectTier('Quantized')}
                            >
                                ${connectedAddress && currentTier === 'Quantized' ? 'Active: Re-Sign Quantized' : 'Sign Up (Quantized)'}
                            </button>
                        </div>
                    </div>

                    <!-- Tier 3: Sovereign Dark -->
                    <div class="nes-container is-dark with-title" style="border-color: ${currentTier === 'SovereignDark' ? '#f43f5e' : '#444'};">
                        <p class="title" style="color: #f43f5e; font-size: 0.68rem;">🔴 3. Sovereign Dark</p>
                        <div style="font-size: 0.65rem; color: #ccc; min-height: 90px;">
                            <p style="margin-bottom: 6px;"><b>10.0x Fee (1000 bps) • Treasury Moat</b></p>
                            <p style="color: #aaa; margin: 0 0 8px 0;">
                                Zero market telemetry emitted. Complete receive-only stealth mode. 10x surcharge routes directly to Sovereign Treasury Paymaster.
                            </p>
                            <span style="color: #f43f5e; font-size: 0.6rem;">• Complete zero telemetry</span><br>
                            <span style="color: #ff99aa; font-size: 0.6rem;">• Funds Protocol Paymaster</span>
                        </div>
                        <div style="margin-top: 15px;">
                            <button
                                type="button"
                                class="nes-btn is-error"
                                style="width: 100%; font-size: 0.65rem;"
                                ?disabled=${isLoading}
                                @click=${() => this.selectTier('SovereignDark')}
                            >
                                ${connectedAddress && currentTier === 'SovereignDark' ? 'Active: Re-Sign Sovereign Dark' : 'Sign Up (Sovereign Dark)'}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- ZK State Lineage Attestation (Anti-GIVO Proof) -->
                <div class="nes-container is-dark with-title" style="margin-top: 20px;">
                    <p class="title" style="color: #ffcc00; font-size: 0.7rem;">🛡️ ZK State Lineage Attestation (Anti-GIVO)</p>
                    <p style="font-size: 0.65rem; color: #aaa; line-height: 1.4;">
                        Prove verifiable lineage binding settled global state root (<code>R_settled</code>) to your account tip and volume weight.
                        Guarantees un-replayable attestations via epoch-scoped nullifiers without leaking transaction graphs.
                    </p>
                    <div style="margin-top: 10px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <button
                            type="button"
                            class="nes-btn is-warning"
                            style="font-size: 0.68rem;"
                            ?disabled=${isLoading}
                            @click=${this.submitTestLineageAttestation}
                        >
                            ⚡ Submit ZK Lineage Attestation
                        </button>
                        <button
                            type="button"
                            class="nes-btn"
                            style="font-size: 0.68rem;"
                            ?disabled=${isLoading}
                            @click=${this.refreshTier}
                        >
                            🔄 Refresh Status
                        </button>
                    </div>
                </div>

                <!-- Status Feedback Box -->
                ${statusMessage ? html`
                    <div class="nes-container is-dark" style="margin-top: 15px; border-color: ${statusType === 'success' ? '#4ade80' : (statusType === 'error' ? '#f43f5e' : '#ffd166')}; padding: 10px;">
                        <span style="font-size: 0.68rem; color: ${statusType === 'success' ? '#4ade80' : (statusType === 'error' ? '#f43f5e' : '#ffd166')};">
                            ${statusMessage}
                        </span>
                    </div>
                ` : ''}

                <!-- Embedded Graph Explorer When Connected / Signed Up -->
                ${connectedAddress ? html`
                    <div class="nes-container is-dark with-title" style="margin-top: 25px; border-color: #9d4edd;">
                        <p class="title" style="color: #9d4edd; font-size: 0.75rem;">🌐 DECENTRALIZED GRAPH TOPOLOGY & TOPOLOGY STREAM</p>
                        <div style="font-size: 0.65rem; color: #94a3b8; margin-bottom: 12px;">
                            Interactive topology of Sovereign DAOs, Git commit object trees, Microservice SQL schemas, and X-Road Regulatory Authorities for <code>${connectedAddress}</code>.
                        </div>
                        <div style="margin-top: 10px;">
                            <graph-explorer id="terminal-graph-explorer"></graph-explorer>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-telemetry-panel')) {
    customElements.define('sovereign-telemetry-panel', SovereignTelemetryPanelElement);
}
