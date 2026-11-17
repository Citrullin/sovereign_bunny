import { LitElement, html, css } from 'lit';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

export interface CheckoutItem {
    tokenId: number;
    title?: string;
    description?: string;
    price_eure: string;
    image?: string;
}

/**
 * `<sovereign-checkout-modal>` Lit Component
 * Encapsulates the NFT Market checkout process and dynamic currency quote calculation.
 * Adheres strictly to the Single Responsibility Principle (SRP).
 */
export class SovereignCheckoutModal extends BaseElement {
    static properties = {
        isOpen: { type: Boolean },
        item: { type: Object },
        selectedAsset: { type: String },
        conversionQuote: { type: String },
        payAmount: { type: String },
        payAmountVal: { type: String },
        signedTxHex: { type: String },
        isSubmitting: { type: Boolean },
    };

    isOpen: boolean = false;
    item: CheckoutItem | null = null;
    selectedAsset: string = 'eure_gnosis';
    conversionQuote: string = '1 EURe = 1.00 EURe';
    payAmount: string = '';
    payAmountVal: string = '';
    signedTxHex: string = '';
    isSubmitting: boolean = false;

    static styles = css`
        :host {
            display: block;
            font-family: inherit;
        }
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10005;
            backdrop-filter: blur(3px);
        }
        .modal-card {
            width: 500px;
            max-width: 90vw;
            background: #14141e;
            border: 2px solid #209cee;
            box-shadow: 0 0 25px rgba(32, 156, 238, 0.25);
            border-radius: 8px;
            color: #fff;
            padding: 20px;
        }
        .title {
            color: #ff0;
            font-size: 1.1rem;
            margin-bottom: 15px;
            font-weight: bold;
        }
        .field {
            margin-bottom: 15px;
        }
        label {
            display: block;
            font-size: 0.75rem;
            color: #aaa;
            margin-bottom: 6px;
        }
        .quote-box {
            font-size: 0.75rem;
            color: #ff0;
            background: #000;
            padding: 8px 10px;
            border-radius: 4px;
            border: 1px solid #333;
        }
        .tx-textarea {
            width: 100%;
            height: 60px;
            font-size: 0.65rem;
            background: #000;
            color: #66fcf1;
            border: 1px solid #444;
            font-family: monospace;
            padding: 8px;
            box-sizing: border-box;
            resize: none;
        }
        .btn-actions {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            margin-top: 20px;
        }
    `;

    open(item: CheckoutItem): void {
        this.item = item;
        this.isOpen = true;
        this.selectedAsset = 'eure_gnosis';
        this.updateQuote();
        this.requestUpdate();
    }

    close(): void {
        this.isOpen = false;
        this.requestUpdate();
    }

    updateQuote(): void {
        if (!this.item) return;
        const priceEure = parseFloat(this.item.price_eure) || 0;
        const asset = this.selectedAsset;

        if (asset === 'eure_gnosis') {
            this.conversionQuote = '1 EURe = 1.00 EURe';
            this.payAmount = `${priceEure.toFixed(2)} EURe`;
            this.payAmountVal = priceEure.toFixed(2);
        } else if (asset === 'eth_arbitrum') {
            const rate = 2600.0;
            const amt = priceEure / rate;
            this.conversionQuote = '1 ETH = 2600.00 EURe (CoW Swap Rate)';
            this.payAmount = `${amt.toFixed(6)} ETH`;
            this.payAmountVal = amt.toFixed(6);
        } else if (asset === 'usdc_base') {
            const rate = 0.92;
            const amt = priceEure / rate;
            this.conversionQuote = '1 USDC = 0.92 EURe (1inch Swap Rate)';
            this.payAmount = `${amt.toFixed(2)} USDC`;
            this.payAmountVal = amt.toFixed(2);
        }

        this.signedTxHex = `Transaction: Pay ${this.payAmount} for NFT #${this.item.tokenId}`;
        this.requestUpdate();
    }

    private _handleAssetChange(e: Event): void {
        this.selectedAsset = (e.target as HTMLSelectElement).value;
        this.updateQuote();
    }

    private _handleConfirm(): void {
        if (!this.item) return;
        this.dispatchEvent(new CustomEvent('confirm-purchase', {
            bubbles: true,
            composed: true,
            detail: {
                item: this.item,
                asset: this.selectedAsset,
                payAmount: this.payAmount,
                payAmountVal: this.payAmountVal,
            }
        }));
    }

    createRenderRoot(): HTMLElement {
        return this as unknown as HTMLElement;
    }

    render(): any {
        if (!this.isOpen || !this.item) {
            this.innerHTML = '';
            return typeof html !== 'undefined' ? html`` : undefined;
        }

        const htmlStr = `
            <div id="checkout-modal" class="wizard-overlay" style="display: flex; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); align-items: center; justify-content: center; z-index: 10005;">
                <div class="nes-container is-dark with-title" style="width: 480px; max-width: 90vw;">
                    <p class="title" style="color: #ff0;">Checkout NFT #${this.item.tokenId}</p>
                    <div class="nes-field" style="margin-bottom: 15px;">
                        <label for="payment-asset-select">Select Payment Token:</label>
                        <div class="nes-select is-dark">
                            <select id="payment-asset-select">
                                <option value="eure_gnosis" ${this.selectedAsset === 'eure_gnosis' ? 'selected' : ''}>EURe (Gnosis Chain)</option>
                                <option value="eth_arbitrum" ${this.selectedAsset === 'eth_arbitrum' ? 'selected' : ''}>ETH (Arbitrum Chain -> Auto-Swap)</option>
                                <option value="usdc_base" ${this.selectedAsset === 'usdc_base' ? 'selected' : ''}>USDC (Base Chain -> Auto-Swap)</option>
                            </select>
                        </div>
                    </div>
                    <div class="nes-field" style="margin-bottom: 15px;">
                        <label>Dynamic Exchange Rate / Quote:</label>
                        <div id="conversion-display" style="font-size: 0.8rem; color: #ff0; margin-bottom: 10px;">${this.conversionQuote}</div>
                    </div>
                    <div class="nes-field" style="margin-bottom: 20px;">
                        <label>Signed Raw Transaction Hex:</label>
                        <textarea id="signed-tx-hex" class="nes-textarea is-dark" style="font-size: 0.65rem;" readonly>${this.signedTxHex}</textarea>
                    </div>
                    <div style="display: flex; gap: 15px; justify-content: flex-end;">
                        <button class="nes-btn is-error" id="checkout-cancel-btn" type="button">Cancel</button>
                        <button class="nes-btn is-success" id="confirm-purchase-btn" type="button" ${this.isSubmitting ? 'disabled' : ''}>${this.isSubmitting ? 'Broadcasting...' : 'Sign & Broadcast'}</button>
                    </div>
                </div>
            </div>
        `;

        this.innerHTML = htmlStr;

        if (typeof this.querySelector === 'function') {
            const select = this.querySelector('#payment-asset-select') as HTMLSelectElement | null;
            if (select) {
                select.onchange = (e) => this._handleAssetChange(e);
            }
            const cancelBtn = this.querySelector('#checkout-cancel-btn') as HTMLElement | null;
            if (cancelBtn) {
                cancelBtn.onclick = () => this.close();
            }
            const confirmBtn = this.querySelector('#confirm-purchase-btn') as HTMLElement | null;
            if (confirmBtn) {
                confirmBtn.onclick = () => this._handleConfirm();
            }
        }

        return typeof html !== 'undefined' ? html`<div .innerHTML="${htmlStr}"></div>` : undefined;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-checkout-modal')) {
    customElements.define('sovereign-checkout-modal', SovereignCheckoutModal);
}
