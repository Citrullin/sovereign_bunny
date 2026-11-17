import { LitElement, html, css } from "lit";
import { UnternehmensregisterPayload } from "../unternehmensregister_schema.js";
import { UnternehmensregisterParser, computeContentAddressHash } from "../unternehmensregister_parser.js";
import { sendEvmTransaction, requestWalletConnection } from "../wallet_connector.js";

export class SovereignCorporateDisclosureViewer extends LitElement {
    static properties = {
        payload: { type: Object },
        rawInputText: { type: String },
        statusMessage: { type: String },
        statusType: { type: String },
        activeTab: { type: String },
        isVerifying: { type: Boolean },
        targetDaoAddress: { type: String }
    };

    payload: UnternehmensregisterPayload | null = null;
    rawInputText: string = "";
    statusMessage: string = "";
    statusType: string = "info";
    activeTab: "overview" | "balancesheet" | "incomestatement" | "disclosures" | "import" = "overview";
    isVerifying: boolean = false;
    targetDaoAddress: string = "";

    static styles = css`
        :host {
            display: block;
            font-family: 'Courier New', monospace;
            background: #11141c;
            color: #d1d5db;
            border: 2px solid #2a3447;
            padding: 16px;
            margin-bottom: 24px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #3b82f6;
            padding-bottom: 12px;
            margin-bottom: 16px;
        }

        .title {
            font-size: 1.15rem;
            font-weight: bold;
            color: #60a5fa;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .cid-badge {
            background: #1e293b;
            border: 1px solid #3b82f6;
            color: #93c5fd;
            padding: 4px 8px;
            font-size: 0.75rem;
            border-radius: 4px;
            word-break: break-all;
        }

        .tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
            border-bottom: 1px solid #334155;
            padding-bottom: 8px;
        }

        .tab-btn {
            background: #1e293b;
            color: #94a3b8;
            border: 1px solid #334155;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 0.8rem;
            transition: all 0.2s;
        }

        .tab-btn:hover {
            background: #334155;
            color: #f8fafc;
        }

        .tab-btn.active {
            background: #2563eb;
            color: #ffffff;
            border-color: #3b82f6;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 16px;
        }

        .card {
            background: #1a2234;
            border: 1px solid #2d3b55;
            padding: 12px;
        }

        .card-title {
            color: #38bdf8;
            font-size: 0.9rem;
            font-weight: bold;
            margin-bottom: 8px;
            border-bottom: 1px dashed #334155;
            padding-bottom: 4px;
        }

        .field {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 0.82rem;
            border-bottom: 1px solid #1e293b;
        }

        .field-label {
            color: #94a3b8;
        }

        .field-value {
            color: #f1f5f9;
            font-weight: bold;
        }

        .table-container {
            width: 100%;
            overflow-x: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
        }

        th, td {
            padding: 6px 8px;
            text-align: left;
            border-bottom: 1px solid #222f46;
        }

        th {
            background: #1e293b;
            color: #93c5fd;
        }

        .num-col {
            text-align: right;
        }

        .section-header {
            background: #1e293b;
            color: #38bdf8;
            font-weight: bold;
        }

        .total-row {
            background: #1e3a5f;
            color: #f8fafc;
            font-weight: bold;
        }

        textarea {
            width: 100%;
            height: 180px;
            background: #0f172a;
            color: #38bdf8;
            border: 1px solid #334155;
            font-family: monospace;
            padding: 8px;
            box-sizing: border-box;
            resize: vertical;
        }

        .action-btn {
            background: #2563eb;
            color: #ffffff;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            font-weight: bold;
            margin-top: 8px;
        }

        .action-btn:hover {
            background: #1d4ed8;
        }

        .status-box {
            padding: 8px;
            margin-top: 12px;
            font-size: 0.8rem;
            border-radius: 4px;
        }

        .status-info { background: #1e293b; color: #38bdf8; border: 1px solid #0284c7; }
        .status-success { background: #064e3b; color: #34d399; border: 1px solid #059669; }
        .status-error { background: #450a0a; color: #f87171; border: 1px solid #dc2626; }
    `;

    formatCurrency(val: any): string {
        if (val === null || val === undefined) return "-";
        const num = typeof val === "number" ? val : (val.currentPeriod ?? null);
        if (num === null || isNaN(num)) return "-";
        return new Intl.NumberFormat("de-DE", { style: "currency", currency: this.payload?.currency || "EUR" }).format(num);
    }

    async handleParseRaw(): Promise<void> {
        if (!this.rawInputText.trim()) {
            this.statusMessage = "Please paste corporate filing JSON or text.";
            this.statusType = "error";
            return;
        }

        try {
            this.isVerifying = true;
            this.statusMessage = "Parsing and validating filing against § 266/275 HGB taxonomy...";
            this.statusType = "info";

            const parsed = await UnternehmensregisterParser.parseFiling(this.rawInputText);
            this.payload = parsed;
            this.activeTab = "overview";
            this.statusMessage = `✅ Successfully parsed filing for ${parsed.metadata.name} (${parsed.period.fiscalYearEnd})`;
            this.statusType = "success";
        } catch (err: any) {
            this.statusMessage = `Parse error: ${err.message || err}`;
            this.statusType = "error";
        } finally {
            this.isVerifying = false;
        }
    }

    async handleAnchorFiling(): Promise<void> {
        if (!this.payload) {
            this.statusMessage = "No validated filing loaded to anchor.";
            this.statusType = "error";
            return;
        }

        try {
            const connected = await requestWalletConnection();
            if (!connected) {
                this.statusMessage = "Please connect wallet to anchor filing.";
                this.statusType = "error";
                return;
            }

            this.statusMessage = "Requesting EVM state change in wallet...";
            this.statusType = "info";

            const anchorPayload = {
                type: "unternehmensregister_hgb_disclosure",
                cid: this.payload.sourceHtmlSha256,
                entity: this.payload.metadata.name,
                stichtag: this.payload.period.fiscalYearEnd,
                timestamp: Date.now()
            };

            const dataHex = "0x53" + Array.from(new TextEncoder().encode(JSON.stringify(anchorPayload)))
                .map(b => b.toString(16).padStart(2, "0")).join("");

            const txHash = await sendEvmTransaction({
                from: connected,
                to: this.targetDaoAddress || "0x0000000000000000000000000000000000000101",
                data: dataHex,
                value: "0x0"
            });

            this.statusMessage = `🔗 Filing anchored on-chain via EVM tx: ${txHash}`;
            this.statusType = "success";
        } catch (err: any) {
            this.statusMessage = `Anchor rejected: ${err.message || err}`;
            this.statusType = "error";
        }
    }

    renderOverview() {
        if (!this.payload) {
            return html`<div style="padding: 24px; text-align: center; color: #94a3b8;">
                No filing loaded. Use the <strong>Import & Parse</strong> tab to paste arbitrary disclosures.
            </div>`;
        }

        const meta = this.payload.metadata;
        const period = this.payload.period;
        const assets = this.payload.balanceSheet.assets;
        const passiva = this.payload.balanceSheet.equityAndLiabilities;

        return html`
            <div class="grid">
                <div class="card">
                    <div class="card-title">🏢 Legal Entity Metadata</div>
                    <div class="field"><span class="field-label">Firma:</span><span class="field-value">${meta.name}</span></div>
                    ${meta.formerName ? html`<div class="field"><span class="field-label">Vormals:</span><span class="field-value">${meta.formerName}</span></div>` : ''}
                    <div class="field"><span class="field-label">Rechtsform:</span><span class="field-value">${meta.legalForm}</span></div>
                    <div class="field"><span class="field-label">Sitz:</span><span class="field-value">${meta.registeredSeat}</span></div>
                    ${meta.register ? html`
                        <div class="field"><span class="field-label">Registergericht:</span><span class="field-value">${meta.register.court}</span></div>
                        <div class="field"><span class="field-label">Registernummer:</span><span class="field-value">${meta.register.type} ${meta.register.number}</span></div>
                    ` : ''}
                </div>

                <div class="card">
                    <div class="card-title">📅 Period & Scope</div>
                    <div class="field"><span class="field-label">Stichtag:</span><span class="field-value">${period.fiscalYearEnd}</span></div>
                    ${period.fiscalYearStart ? html`<div class="field"><span class="field-label">Beginn:</span><span class="field-value">${period.fiscalYearStart}</span></div>` : ''}
                    ${period.publishedAt ? html`<div class="field"><span class="field-label">Bekanntmachung:</span><span class="field-value">${period.publishedAt}</span></div>` : ''}
                    <div class="field"><span class="field-label">Währung:</span><span class="field-value">${this.payload.currency}</span></div>
                    <div class="field"><span class="field-label">Rumpfgeschäftsjahr:</span><span class="field-value">${period.isRumpfgeschaeftsjahr ? 'Ja' : 'Nein'}</span></div>
                </div>

                <div class="card">
                    <div class="card-title">📊 Key Metrics (HGB § 266)</div>
                    <div class="field"><span class="field-label">Bilanzsumme:</span><span class="field-value">${this.formatCurrency(assets.totalAssets)}</span></div>
                    <div class="field"><span class="field-label">Eigenkapital:</span><span class="field-value">${this.formatCurrency(passiva.equity?.total)}</span></div>
                    <div class="field"><span class="field-label">Verbindlichkeiten:</span><span class="field-value">${this.formatCurrency(passiva.liabilities?.total)}</span></div>
                    <div class="field"><span class="field-label">Flüssige Mittel:</span><span class="field-value">${this.formatCurrency(assets.currentAssets?.cashAndBank)}</span></div>
                </div>
            </div>

            <div style="margin-top: 16px; display: flex; gap: 8px;">
                <button class="action-btn" @click=${this.handleAnchorFiling}>🔗 Anchor to On-Chain DAO via EVM Tx</button>
            </div>
        `;
    }

    renderBalanceSheet() {
        if (!this.payload) return html`<div>No filing loaded.</div>`;
        const a = this.payload.balanceSheet.assets;
        const p = this.payload.balanceSheet.equityAndLiabilities;

        return html`
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Position (§ 266 HGB)</th>
                            <th class="num-col">Geschäftsjahr</th>
                            <th class="num-col">Vorjahr</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="section-header"><td colspan="3">AKTIVA (Assets)</td></tr>
                        <tr><td>A. Anlagevermögen</td><td class="num-col">${this.formatCurrency(a.fixedAssets?.total)}</td><td class="num-col">${this.formatCurrency(a.fixedAssets?.total?.previousPeriod)}</td></tr>
                        <tr><td style="padding-left: 20px;">I. Immaterielle Vermögensgegenstände</td><td class="num-col">${this.formatCurrency(a.fixedAssets?.intangibleAssets)}</td><td class="num-col">${this.formatCurrency(a.fixedAssets?.intangibleAssets?.previousPeriod)}</td></tr>
                        <tr><td style="padding-left: 20px;">II. Sachanlagen</td><td class="num-col">${this.formatCurrency(a.fixedAssets?.tangibleAssets)}</td><td class="num-col">${this.formatCurrency(a.fixedAssets?.tangibleAssets?.previousPeriod)}</td></tr>
                        <tr><td style="padding-left: 20px;">III. Finanzanlagen</td><td class="num-col">${this.formatCurrency(a.fixedAssets?.financialAssets)}</td><td class="num-col">${this.formatCurrency(a.fixedAssets?.financialAssets?.previousPeriod)}</td></tr>
                        <tr><td>B. Umlaufvermögen</td><td class="num-col">${this.formatCurrency(a.currentAssets?.total)}</td><td class="num-col">${this.formatCurrency(a.currentAssets?.total?.previousPeriod)}</td></tr>
                        <tr><td style="padding-left: 20px;">I. Forderungen und sonstige Vermögensgegenstände</td><td class="num-col">${this.formatCurrency(a.currentAssets?.receivables)}</td><td class="num-col">${this.formatCurrency(a.currentAssets?.receivables?.previousPeriod)}</td></tr>
                        <tr><td style="padding-left: 20px;">II. Kassenbestand, Guthaben bei Kreditinstituten</td><td class="num-col">${this.formatCurrency(a.currentAssets?.cashAndBank)}</td><td class="num-col">${this.formatCurrency(a.currentAssets?.cashAndBank?.previousPeriod)}</td></tr>
                        ${a.deficitNotCoveredByEquity ? html`<tr><td>C. Nicht durch Eigenkapital gedeckter Fehlbetrag</td><td class="num-col">${this.formatCurrency(a.deficitNotCoveredByEquity)}</td><td class="num-col">-</td></tr>` : ''}
                        <tr class="total-row"><td>Bilanzsumme Aktiva</td><td class="num-col">${this.formatCurrency(a.totalAssets)}</td><td class="num-col">${this.formatCurrency(a.totalAssets?.previousPeriod)}</td></tr>

                        <tr class="section-header"><td colspan="3">PASSIVA (Equity & Liabilities)</td></tr>
                        <tr><td>A. Eigenkapital</td><td class="num-col">${this.formatCurrency(p.equity?.total)}</td><td class="num-col">${this.formatCurrency(p.equity?.total?.previousPeriod)}</td></tr>
                        <tr><td style="padding-left: 20px;">I. Gezeichnetes Kapital</td><td class="num-col">${this.formatCurrency(p.equity?.subscribedCapital)}</td><td class="num-col">${this.formatCurrency(p.equity?.subscribedCapital?.previousPeriod)}</td></tr>
                        <tr><td style="padding-left: 20px;">II. Kapitalrücklage</td><td class="num-col">${this.formatCurrency(p.equity?.capitalReserves)}</td><td class="num-col">${this.formatCurrency(p.equity?.capitalReserves?.previousPeriod)}</td></tr>
                        <tr><td style="padding-left: 20px;">III. Bilanzgewinn / Bilanzverlust</td><td class="num-col">${this.formatCurrency(p.equity?.balanceSheetProfitOrLoss || p.equity?.netIncomeOrLoss)}</td><td class="num-col">${this.formatCurrency((p.equity?.balanceSheetProfitOrLoss || p.equity?.netIncomeOrLoss)?.previousPeriod)}</td></tr>
                        <tr><td>B. Rückstellungen</td><td class="num-col">${this.formatCurrency(p.provisions?.total)}</td><td class="num-col">${this.formatCurrency(p.provisions?.total?.previousPeriod)}</td></tr>
                        <tr><td>C. Verbindlichkeiten</td><td class="num-col">${this.formatCurrency(p.liabilities?.total)}</td><td class="num-col">${this.formatCurrency(p.liabilities?.total?.previousPeriod)}</td></tr>
                        ${p.liabilities?.dueWithinOneYear ? html`<tr><td style="padding-left: 20px;">- davon mit Restlaufzeit bis zu 1 Jahr</td><td class="num-col">${this.formatCurrency(p.liabilities.dueWithinOneYear)}</td><td class="num-col">-</td></tr>` : ''}
                        ${p.liabilities?.toShareholders ? html`<tr><td style="padding-left: 20px;">- davon gegenüber Gesellschaftern</td><td class="num-col">${this.formatCurrency(p.liabilities.toShareholders)}</td><td class="num-col">-</td></tr>` : ''}
                        <tr class="total-row"><td>Bilanzsumme Passiva</td><td class="num-col">${this.formatCurrency(p.totalEquityAndLiabilities)}</td><td class="num-col">${this.formatCurrency(p.totalEquityAndLiabilities?.previousPeriod)}</td></tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    renderDisclosures() {
        if (!this.payload) return html`<div>No filing loaded.</div>`;
        const notes = this.payload.notes;

        return html`
            <div class="grid">
                <div class="card">
                    <div class="card-title">✍️ Executive Signatories (Geschäftsführung)</div>
                    ${notes?.signatories && notes.signatories.length > 0 ? notes.signatories.map((s: any) => html`
                        <div class="field">
                            <span class="field-label">${s.name} (${s.role}):</span>
                            <span class="field-value">${s.signingDate || 'Vorliegend'}</span>
                        </div>
                    `) : html`<div style="color: #94a3b8;">Keine namentlichen Unterzeichner hinterlegt.</div>`}
                </div>

                <div class="card">
                    <div class="card-title">📖 Notes & Disclosures (Anhang)</div>
                    ${notes?.sizeClassification ? html`<div class="field"><span class="field-label">Größenklasse:</span><span class="field-value">${notes.sizeClassification}</span></div>` : ''}
                    ${typeof notes?.averageEmployees === 'number' ? html`<div class="field"><span class="field-label">Mitarbeiteranzahl:</span><span class="field-value">${notes.averageEmployees}</span></div>` : ''}
                    ${notes?.cryptoHoldingsPolicy ? html`<div class="field"><span class="field-label">Crypto Policy:</span><span class="field-value">${notes.cryptoHoldingsPolicy}</span></div>` : ''}
                    ${notes?.notesText ? html`<div style="margin-top: 8px; font-size: 0.78rem; color: #cbd5e1; white-space: pre-wrap;">${notes.notesText}</div>` : ''}
                </div>
            </div>
        `;
    }

    renderImport() {
        return html`
            <div>
                <p style="font-size: 0.85rem; color: #94a3b8; margin-top: 0;">
                    Paste raw German commercial register disclosures (JSON conforming to taxonomy or unstructured Bundesanzeiger text):
                </p>
                <textarea
                    placeholder='{"metadata": {"name": "Any Corporate Entity GmbH", "legalForm": "GmbH"}, "period": {"fiscalYearEnd": "2024-12-31"}, "balanceSheet": { ... }}'
                    .value=${this.rawInputText}
                    @input=${(e: any) => this.rawInputText = e.target.value}
                ></textarea>
                <div style="margin-top: 8px; display: flex; gap: 8px;">
                    <button class="action-btn" ?disabled=${this.isVerifying} @click=${this.handleParseRaw}>
                        ${this.isVerifying ? 'Validating...' : '🚀 Parse & Normalize Filing'}
                    </button>
                </div>
            </div>
        `;
    }

    render() {
        return html`
            <div class="header">
                <div class="title">
                    🏛️ German Unternehmensregister & Bundesanzeiger Disclosures
                </div>
                ${this.payload?.sourceHtmlSha256 ? html`
                    <div class="cid-badge" title="Content Hash for Iroh Storage">
                        BLAKE3/SHA256: ${this.payload.sourceHtmlSha256.slice(0, 16)}...
                    </div>
                ` : ''}
            </div>

            <div class="tabs">
                <button class="tab-btn ${this.activeTab === 'overview' ? 'active' : ''}" @click=${() => this.activeTab = 'overview'}>Overview</button>
                <button class="tab-btn ${this.activeTab === 'balancesheet' ? 'active' : ''}" @click=${() => this.activeTab = 'balancesheet'}>Bilanz (§ 266 HGB)</button>
                <button class="tab-btn ${this.activeTab === 'disclosures' ? 'active' : ''}" @click=${() => this.activeTab = 'disclosures'}>Anhang & Vorstand</button>
                <button class="tab-btn ${this.activeTab === 'import' ? 'active' : ''}" @click=${() => this.activeTab = 'import'}>Import & Parse</button>
            </div>

            ${this.activeTab === 'overview' ? this.renderOverview() : ''}
            ${this.activeTab === 'balancesheet' ? this.renderBalanceSheet() : ''}
            ${this.activeTab === 'disclosures' ? this.renderDisclosures() : ''}
            ${this.activeTab === 'import' ? this.renderImport() : ''}

            ${this.statusMessage ? html`
                <div class="status-box status-${this.statusType}">
                    ${this.statusMessage}
                </div>
            ` : ''}
        `;
    }
}

if (typeof customElements !== "undefined" && !customElements.get("sovereign-corporate-disclosure-viewer")) {
    customElements.define("sovereign-corporate-disclosure-viewer", SovereignCorporateDisclosureViewer);
}
