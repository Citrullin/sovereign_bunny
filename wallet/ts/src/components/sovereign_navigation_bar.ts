import { LitElement, html, css } from 'lit';
import { NavigationActor, AppTab, createNavigationActor } from '../app/navigation_machine.js';

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<sovereign-navigation-bar>` Lit Component
 * Encapsulates the main horizontal navigation deck and reacts to NavigationActor state changes.
 * Adheres strictly to the Single Responsibility Principle (SRP).
 */
export class SovereignNavigationBar extends BaseElement {
    static properties = {
        activeTab: { type: String },
        devMode: { type: Boolean },
    };

    activeTab: AppTab = 'profile';
    devMode: boolean = false;

    private _actor: NavigationActor | null = null;
    private _sub: (() => void) | null = null;

    static styles = css`
        :host {
            display: block;
            width: 100%;
            margin-bottom: 20px;
            font-family: inherit;
        }
        .main-nav-container {
            display: flex;
            width: 100%;
        }
        .main-nav-tabs {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            width: 100%;
            border-bottom: 2px solid #333;
            padding-bottom: 8px;
        }
        .tab-btn {
            background: #111;
            color: #888;
            border: 2px solid #333;
            padding: 8px 14px;
            cursor: pointer;
            font-family: inherit;
            font-size: 0.75rem;
            border-radius: 4px;
            transition: all 0.15s ease;
        }
        .tab-btn:hover {
            color: #fff;
            border-color: #666;
        }
        .tab-btn.active {
            background: #209cee;
            color: #fff;
            border-color: #66fcf1;
            box-shadow: 0 0 10px rgba(102, 252, 241, 0.4);
            font-weight: bold;
        }
    `;

    connectedCallback(): void {
        super.connectedCallback?.();
        if (!this._actor) {
            this.bindActor(createNavigationActor(this.devMode));
        }
    }

    disconnectedCallback(): void {
        super.disconnectedCallback?.();
        if (this._sub) {
            this._sub();
            this._sub = null;
        }
    }

    bindActor(actor: NavigationActor): void {
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
        this.activeTab = snapshot.context.activeTab;
        this.devMode = snapshot.context.devMode;
        this.requestUpdate();
    }

    get actor(): NavigationActor | null {
        return this._actor;
    }

    selectTab(tab: AppTab): void {
        this._actor?.send({ type: 'SWITCH_TAB', tab });
        this.dispatchEvent(new CustomEvent('tab-selected', {
            bubbles: true,
            composed: true,
            detail: { tab }
        }));
    }

    setDevMode(devMode: boolean): void {
        this._actor?.send({ type: 'SET_DEV_MODE', devMode });
    }

    routeHash(hash: string): void {
        this._actor?.send({ type: 'ROUTE_HASH', hash });
    }

    createRenderRoot(): HTMLElement {
        return this as unknown as HTMLElement;
    }

    render(): any {
        const tabs: { id: AppTab; label: string; devOnly?: boolean }[] = [
            { id: 'profile', label: '👤 Identity' },
            { id: 'activitypub', label: '🌌 Fediverse' },
            { id: 'explorer', label: '⛓️ Explorer' },
            { id: 'market', label: '🖼️ Market' },
            { id: 'storage', label: '💾 Storage', devOnly: true },
            { id: 'debugger', label: '🐞 Debugger', devOnly: true },
        ];

        const visibleTabs = tabs.filter(t => !t.devOnly || this.devMode);

        const htmlStr = `
            <div class="main-nav-container">
                <nav class="main-nav-tabs" id="main-nav-tabs">
                    ${visibleTabs.map(t => `
                        <button
                            type="button"
                            class="tab-btn ${this.activeTab === t.id ? 'active' : ''}"
                            data-tab="tab-${t.id}"
                            id="nav-tab-${t.id}"
                        >
                            ${t.label}
                        </button>
                    `).join('')}
                </nav>
            </div>
        `;

        this.innerHTML = htmlStr;

        if (typeof this.querySelectorAll === 'function') {
            const buttons = this.querySelectorAll('.tab-btn');
            buttons.forEach((btn) => {
                const tabAttr = btn.getAttribute('data-tab')?.replace('tab-', '') as AppTab;
                if (tabAttr) {
                    (btn as HTMLElement).onclick = () => this.selectTab(tabAttr);
                }
            });
        }

        return typeof html !== 'undefined' ? html`<div .innerHTML="${htmlStr}"></div>` : undefined;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('sovereign-navigation-bar')) {
    customElements.define('sovereign-navigation-bar', SovereignNavigationBar);
}
