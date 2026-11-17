import { LitElement, html, css, TemplateResult } from 'lit';
import { callBunnyRpc } from '../app/network_machine.js';

export interface ActivityPubNote {
    id?: string;
    tx_hash?: string;
    actor_address?: string;
    actor?: string;
    content: string;
    timestamp?: number;
    epoch?: number;
    media_cid?: string;
}

const BaseElement = typeof LitElement !== 'undefined' ? LitElement : class {} as unknown as typeof LitElement;

/**
 * `<fediverse-panel>` Lit Component
 * Decentralized ActivityPub fediverse microblogging feed, Iroh media attachments, and post-quantum signing.
 */
export class FediversePanel extends BaseElement {
    static properties = {
        notes: { type: Array },
        loading: { type: Boolean },
        authorAddress: { type: String, attribute: 'author-address' },
        rpcUrl: { type: String, attribute: 'rpc-url' },
    };

    notes: ActivityPubNote[] = [];
    loading: boolean = false;
    authorAddress: string = '';
    rpcUrl: string = '/rpc';

    static styles = css`
        :host {
            display: block;
            font-family: inherit;
        }
        .feed-card {
            background: #10141c;
            border: 2px solid #1f2a37;
            border-radius: 8px;
            padding: 16px;
            color: #eee;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            border-bottom: 1px solid #1f2a37;
            padding-bottom: 8px;
        }
        .title {
            font-size: 0.9rem;
            color: #66fcf1;
            font-weight: bold;
        }
        .note-item {
            background: #182230;
            border: 1px solid #233549;
            border-radius: 6px;
            padding: 10px 12px;
            margin-bottom: 8px;
        }
        .note-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.7rem;
            margin-bottom: 4px;
        }
        .actor {
            color: #66fcf1;
            font-weight: bold;
            font-family: monospace;
        }
        .timestamp {
            color: #888;
            font-size: 0.65rem;
        }
        .content {
            font-size: 0.75rem;
            color: #fff;
            margin: 4px 0;
            line-height: 1.4;
        }
        .media-tag {
            font-size: 0.65rem;
            color: #facc15;
            background: rgba(250, 204, 21, 0.1);
            padding: 2px 6px;
            border-radius: 3px;
            display: inline-block;
            margin-top: 4px;
        }
        .btn {
            background: #1e293b;
            border: 1px solid #334155;
            color: #66fcf1;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.75rem;
        }
    `;

    connectedCallback(): void {
        super.connectedCallback?.();
        this.fetchFeed();
    }

    async fetchFeed(): Promise<void> {
        this.loading = true;
        this.requestUpdate();

        try {
            const resp = await callBunnyRpc<ActivityPubNote[]>('bunny_getActivityPubFeed', [30], this.rpcUrl);
            if (resp && resp.result) {
                this.notes = resp.result;
            }
        } catch (_) {
            // Keep current local notes
        } finally {
            this.loading = false;
            this.requestUpdate();
        }
    }

    render(): TemplateResult {
        return html`
            <div class="feed-card">
                <div class="header">
                    <span class="title">🌌 Sovereign Fediverse (ActivityPub Slot 0x05)</span>
                    <button class="btn" @click=${() => this.fetchFeed()}>
                        ${this.loading ? 'Refreshing...' : '🔄 Refresh Feed'}
                    </button>
                </div>

                ${this.notes.length === 0
                    ? html`<p style="font-size: 0.75rem; color: #888; text-align: center; padding: 12px;">No network activities published yet.</p>`
                    : html`
                          <div>
                              ${this.notes.map((item) => {
                                  const actor = item.actor_address
                                      ? `${item.actor_address.slice(0, 8)}...${item.actor_address.slice(-6)}`
                                      : item.actor || 'Anonymous';
                                  const timeStr = item.timestamp
                                      ? new Date(item.timestamp).toLocaleTimeString()
                                      : `Epoch ${item.epoch || 1}`;

                                  return html`
                                      <div class="note-item">
                                          <div class="note-header">
                                              <span class="actor">${actor}</span>
                                              <span class="timestamp">${timeStr}</span>
                                          </div>
                                          <div class="content">${item.content}</div>
                                          ${item.media_cid
                                              ? html`<div class="media-tag">📎 Iroh: ${item.media_cid.slice(0, 16)}...</div>`
                                              : ''}
                                      </div>
                                  `;
                              })}
                          </div>
                      `}
            </div>
        `;
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('fediverse-panel')) {
    customElements.define('fediverse-panel', FediversePanel);
}
