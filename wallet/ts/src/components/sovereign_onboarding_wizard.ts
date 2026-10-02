import { LitElement, html, css } from 'lit';
import { OnboardingActor, OnboardingContext, createOnboardingActor } from '../app/onboarding_machine.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<sovereign-onboarding-wizard>` Lit Component
 * Encapsulates the multi-step onboarding wizard into a reactive state-machine-driven component.
 * Adheres strictly to the Single Responsibility Principle (SRP).
 */
export class SovereignOnboardingWizard extends BaseElement {
    static properties = {
        isOpen: { type: Boolean },
        step: { type: Number },
        connectedAddress: { type: String },
        statusMessage: { type: String },
        error: { type: String },
        password: { type: String },
        isPasswordVisible: { type: Boolean },
        isSubmitting: { type: Boolean },
        existingKeystoreFound: { type: Boolean },
        storageMode: { type: String },
        directoryName: { type: String },
    };

    isOpen: boolean = false;
    step: 1 | 2 | 3 = 1;
    connectedAddress: string | null = null;
    statusMessage: string = 'No wallet linked';
    error: string | null = null;
    password: string = '';
    isPasswordVisible: boolean = false;
    isSubmitting: boolean = false;
    existingKeystoreFound: boolean = false;
    storageMode: string | null = null;
    directoryName: string | null = null;

    private _actor: OnboardingActor | null = null;
    private _sub: (() => void) | null = null;

    static styles = css`
        :host {
            display: block;
            font-family: inherit;
        }
        .wizard-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            backdrop-filter: blur(4px);
        }
        .wizard-card {
            width: 480px;
            max-width: 90vw;
            margin: auto;
            padding: 24px;
            background: #14141e;
            border: 2px solid #66fcf1;
            box-shadow: 0 0 25px rgba(102, 252, 241, 0.25);
            border-radius: 8px;
            color: #fff;
        }
        .wizard-title {
            font-size: 1.2rem;
            color: #ff0;
            text-align: center;
            margin-bottom: 20px;
            font-weight: bold;
        }
        .step-container {
            display: flex;
            flex-direction: column;
            gap: 14px;
        }
        .step-heading {
            font-size: 1rem;
            color: #66fcf1;
            margin-bottom: 4px;
        }
        .step-desc {
            font-size: 0.75rem;
            color: #aaa;
            line-height: 1.4;
        }
        .status-box {
            font-size: 0.7rem;
            padding: 8px;
            border-radius: 4px;
            background: #000;
            border: 1px solid #333;
            word-break: break-all;
        }
        .btn-group {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 10px;
        }
        .wizard-nav {
            display: flex;
            justify-content: space-between;
            margin-top: 24px;
            border-top: 1px solid #333;
            padding-top: 16px;
        }
        .error-message {
            color: #e76e55;
            font-size: 0.75rem;
            margin-top: 8px;
        }
    `;

    connectedCallback(): void {
        super.connectedCallback?.();
        if (!this._actor) {
            this.bindActor(createOnboardingActor());
        }
    }

    disconnectedCallback(): void {
        super.disconnectedCallback?.();
        if (this._sub) {
            this._sub();
            this._sub = null;
        }
    }

    bindActor(actor: OnboardingActor): void {
        if (this._sub) {
            this._sub();
        }
        this._actor = actor;
        this._updateFromSnapshot(actor.getSnapshot());
        const subscription = actor.subscribe((snapshot) => {
            this._updateFromSnapshot(snapshot);
        });
        this._sub = () => subscription.unsubscribe();
    }

    private _updateFromSnapshot(snapshot: any): void {
        const ctx: OnboardingContext = snapshot.context;
        this.step = ctx.step;
        this.connectedAddress = ctx.connectedAddress;
        this.statusMessage = ctx.statusMessage;
        this.error = ctx.error;
        this.password = ctx.password;
        this.isPasswordVisible = ctx.isPasswordVisible;
        this.isSubmitting = ctx.isSubmitting;
        this.existingKeystoreFound = !!ctx.existingKeystoreFound;
        this.storageMode = ctx.storageMode;
        this.directoryName = ctx.directoryName;
        this.requestUpdate();
    }

    get actor(): OnboardingActor | null {
        return this._actor;
    }

    open(): void {
        this.isOpen = true;
        this.requestUpdate();
    }

    close(): void {
        this.isOpen = false;
        this.requestUpdate();
    }

    setConnectedAddress(address: string, signature?: string): void {
        this._actor?.send({ type: 'SET_CONNECTED_ADDRESS', address, signature });
    }

    setStorageMode(mode: 'native' | 'file_api', handle?: any, name?: string): void {
        this._actor?.send({ type: 'SET_STORAGE_MODE', mode, handle, name });
    }

    setKeystoreDetected(keystore: string, address?: string, doc?: any): void {
        this._actor?.send({ type: 'KEYSTORE_DETECTED', keystore, address, doc });
    }

    private _handleConnect(): void {
        this.dispatchEvent(new CustomEvent('connect-wallet-requested', { bubbles: true, composed: true }));
    }

    private _handleSelectDir(): void {
        this.dispatchEvent(new CustomEvent('select-directory-requested', { bubbles: true, composed: true }));
    }

    private _handleImportKeystore(): void {
        this.dispatchEvent(new CustomEvent('import-keystore-requested', { bubbles: true, composed: true }));
    }

    private _handleSandbox(): void {
        this._actor?.send({ type: 'SET_STORAGE_MODE', mode: 'file_api' });
        this.dispatchEvent(new CustomEvent('sandbox-mode-selected', { bubbles: true, composed: true }));
    }

    private _handlePrev(): void {
        this._actor?.send({ type: 'PREV_STEP' });
    }

    private _handleNext(): void {
        if (this.step === 3) {
            this._submit();
        } else {
            this._actor?.send({ type: 'NEXT_STEP' });
        }
    }

    private _handlePasswordInput(e: Event): void {
        const val = (e.target as HTMLInputElement).value;
        this._actor?.send({ type: 'SET_PASSWORD', password: val });
    }

    private _togglePasswordVisibility(): void {
        this._actor?.send({ type: 'TOGGLE_PASSWORD_VISIBILITY' });
    }

    private _submit(): void {
        this._actor?.send({ type: 'SUBMIT' });
        this.dispatchEvent(new CustomEvent('submit-onboarding', {
            bubbles: true,
            composed: true,
            detail: {
                password: this.password,
                existingKeystore: this.existingKeystoreFound,
                storageMode: this.storageMode,
                directoryHandle: this._actor?.getSnapshot().context.directoryHandle,
                directoryName: this.directoryName,
                address: this.connectedAddress,
                doc: this._actor?.getSnapshot().context.existingDoc,
            }
        }));
    }

    createRenderRoot(): HTMLElement {
        return this as unknown as HTMLElement;
    }

    render(): any {
        if (!this.isOpen) {
            this.innerHTML = '';
            return typeof html !== 'undefined' ? html`` : undefined;
        }

        const canProceed = this.step === 1 ? !!this.connectedAddress
            : this.step === 2 ? (!!this.storageMode || !!this.directoryName)
            : this.password.length > 0 && !this.isSubmitting;

        const nextLabel = this.step === 3
            ? (this.existingKeystoreFound ? (this.isSubmitting ? 'Unlocking...' : 'Unlock Keystore') : (this.isSubmitting ? 'Creating...' : 'Finish Setup'))
            : 'Next';

        const step1Html = `
            <div id="step-1" class="wizard-step ${this.step === 1 ? 'active' : ''}">
                <h3 class="step-heading">Step 1: Connect Wallet</h3>
                <p class="step-desc">Connect your standard EVM wallet (Rabby/MetaMask) to serve as your primary key identity.</p>
                <div class="btn-group">
                    <button class="nes-btn is-success" id="connect-evm-wallet-btn" type="button">🔌 Connect & Sign</button>
                    <div id="siwe-status" class="status-box" style="color: #ff0;">${this.statusMessage || 'No wallet linked'}</div>
                </div>
            </div>
        `;

        const step2Html = `
            <div id="step-2" class="wizard-step ${this.step === 2 ? 'active' : ''}">
                <h3 class="step-heading">Step 2: Storage Method</h3>
                <p class="step-desc">Select local storage folder for your keystore and DID profile, or restore an existing backup.</p>
                <div class="btn-group">
                    <button class="nes-btn is-primary" id="select-dir-btn" type="button">📁 Choose Storage Folder</button>
                    <button class="nes-btn is-warning" id="wizard-import-btn" type="button">📥 Import Keystore Backup</button>
                    <button class="nes-btn is-error" id="use-virtual-btn" type="button">🌐 Sandbox Mode (File API)</button>
                </div>
                <div id="dir-status" class="status-box" style="margin-top: 10px; color: #66fcf1;">
                    ${this.directoryName ? `📁 Root Storage Active: ${this.directoryName}` : (this.statusMessage || '')}
                </div>
            </div>
        `;

        const step3Html = `
            <div id="step-3" class="wizard-step ${this.step === 3 ? 'active' : ''}">
                <h3 class="step-heading">Step 3: Setup Password</h3>
                <p class="step-desc">${this.existingKeystoreFound
                    ? 'Enter your password to unlock the detected post-quantum keystore.'
                    : 'Set a password to encrypt your local post-quantum & auxiliary DID keys inside the keystore backup file.'}</p>
                <div class="nes-field" style="margin-top: 15px;">
                    <label for="wizard-password-input">Keystore Password:</label>
                    <div style="display: flex; gap: 8px;">
                        <input
                            type="${this.isPasswordVisible ? 'text' : 'password'}"
                            id="wizard-password-input"
                            class="nes-input is-dark"
                            placeholder="${this.existingKeystoreFound ? 'Enter Password to Unlock' : 'Password'}"
                            value="${this.password || ''}"
                        >
                        <button class="nes-btn" id="wizard-reveal-password-btn" type="button">${this.isPasswordVisible ? '🔒' : '👁️'}</button>
                    </div>
                </div>
            </div>
        `;

        const htmlStr = `
            <div id="onboarding-wizard" class="wizard-overlay" style="display: flex;">
                <div class="nes-container is-rounded is-dark wizard-card" style="width: 480px; margin: auto; padding: 20px;">
                    <h2 class="wizard-title">🌱 Sovereign Setup</h2>

                    ${this.step === 1 ? step1Html : ''}
                    ${this.step === 2 ? step2Html : ''}
                    ${this.step === 3 ? step3Html : ''}

                    ${this.error ? `<div class="error-message">⚠️ ${this.error}</div>` : ''}

                    <div class="wizard-nav">
                        <button class="nes-btn is-error" id="prev-step-btn" type="button" ${this.step === 1 || this.isSubmitting ? 'disabled' : ''}>Back</button>
                        <button class="nes-btn is-primary" id="next-step-btn" type="button" ${!canProceed ? 'disabled' : ''}>${nextLabel}</button>
                    </div>
                </div>
            </div>
        `;

        this.innerHTML = htmlStr;

        // Attach listeners directly to component elements without global document searches
        if (typeof this.querySelector === 'function') {
            const connectBtn = this.querySelector('#connect-evm-wallet-btn') as HTMLElement | null;
            if (connectBtn) connectBtn.onclick = () => this._handleConnect();

            const selectDirBtn = this.querySelector('#select-dir-btn') as HTMLElement | null;
            if (selectDirBtn) selectDirBtn.onclick = () => this._handleSelectDir();

            const importBtn = this.querySelector('#wizard-import-btn') as HTMLElement | null;
            if (importBtn) importBtn.onclick = () => this._handleImportKeystore();

            const sandboxBtn = this.querySelector('#use-virtual-btn') as HTMLElement | null;
            if (sandboxBtn) sandboxBtn.onclick = () => this._handleSandbox();

            const prevBtn = this.querySelector('#prev-step-btn') as HTMLElement | null;
            if (prevBtn) prevBtn.onclick = () => this._handlePrev();

            const nextBtn = this.querySelector('#next-step-btn') as HTMLElement | null;
            if (nextBtn) nextBtn.onclick = () => this._handleNext();

            const pwdInput = this.querySelector('#wizard-password-input') as HTMLInputElement | null;
            if (pwdInput) {
                pwdInput.oninput = (e) => this._handlePasswordInput(e);
                pwdInput.onkeydown = (e) => {
                    if (e.key === 'Enter' && canProceed) {
                        this._handleNext();
                    }
                };
            }

            const revealBtn = this.querySelector('#wizard-reveal-password-btn') as HTMLElement | null;
            if (revealBtn) revealBtn.onclick = () => this._togglePasswordVisibility();
        }

        return typeof html !== 'undefined' ? html`<div .innerHTML="${htmlStr}"></div>` : undefined;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-onboarding-wizard')) {
    customElements.define('sovereign-onboarding-wizard', SovereignOnboardingWizard);
}
