/**
 * Polymorphic SQL Schema Template Engine & Registry
 *
 * Provides dynamic schema generation, template selection, and user-defined
 * template creation for Sovereign Reth's polymorphic interpretation of
 * Slot 4 (ext.sqldigest) and Slot 7 (merit / verifiable query) commitments.
 *
 * Decoupled from any proprietary or private hosting setups: works dynamically
 * for any relational database, dialect, and data model.
 */

export type SqlDialect =
    | 'Space and Time SQL (Proof of SQL)'
    | 'PostgreSQL'
    | 'SQLite'
    | 'ClickHouse'
    | 'DuckDB'
    | 'MySQL';

export interface SqlRenderParams {
    entityLabel: string;
    entityDid?: string;
    entityAddress?: string;
    digest: string;
    slotId?: number | string;
    dialect?: SqlDialect | string;
}

export interface SqlSchemaTemplate {
    id: string;
    name: string;
    description: string;
    dialect: SqlDialect | string;
    generateDdl(params: SqlRenderParams): string;
}

export class SqlSchemaRegistry {
    private static _instance: SqlSchemaRegistry;
    private _templates: Map<string, SqlSchemaTemplate> = new Map();
    private _storageKey = 'sovereign_custom_sql_templates_v1';

    private constructor() {
        this._registerBuiltins();
        this._loadCustomTemplates();
    }

    public static getInstance(): SqlSchemaRegistry {
        if (!SqlSchemaRegistry._instance) {
            SqlSchemaRegistry._instance = new SqlSchemaRegistry();
        }
        return SqlSchemaRegistry._instance;
    }

    private _registerBuiltins(): void {
        // 1. Verifiable Relational Ledger
        this.register({
            id: 'relational_ledger',
            name: 'Verifiable Relational Ledger',
            description: 'Double-entry settlement ledger with cryptographic state roots, epoch heights, and ZK-proof seals.',
            dialect: 'PostgreSQL / Space and Time SQL',
            generateDdl(params: SqlRenderParams): string {
                const ident = sanitizeIdentifier(params.entityLabel);
                const tableName = `ledger_${ident}`;
                const cleanHash = (params.digest || '').trim();
                const slot = params.slotId ?? 4;

                return `-- =====================================================================
-- Sovereign Reth Polymorphic SQL Interpretation
-- Archetype: Verifiable Relational Ledger
-- Entity: ${params.entityLabel} ${params.entityDid ? `(${params.entityDid})` : ''}
-- Target Address: ${params.entityAddress || 'Unknown'}
-- Cryptographic Root Digest (Slot ${slot}): ${cleanHash}
-- Dialect: ${params.dialect || 'PostgreSQL / Space and Time Proof of SQL'}
-- =====================================================================

CREATE TABLE IF NOT EXISTS ${tableName}_accounts (
    account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    holder_did VARCHAR(128) NOT NULL,
    currency VARCHAR(16) NOT NULL DEFAULT 'SOV',
    current_balance NUMERIC(38, 18) NOT NULL DEFAULT 0,
    nonce BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ${tableName}_journal_entries (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_hash BYTEA NOT NULL,
    epoch_height BIGINT NOT NULL,
    debit_account UUID REFERENCES ${tableName}_accounts(account_id),
    credit_account UUID REFERENCES ${tableName}_accounts(account_id),
    amount NUMERIC(38, 18) NOT NULL,
    state_merkle_root BYTEA NOT NULL,
    zk_proof_digest BYTEA,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Cryptographic Slot Digest Verification Anchor Table
CREATE TABLE IF NOT EXISTS ${tableName}_anchors (
    anchor_id BIGSERIAL PRIMARY KEY,
    slot_id INT NOT NULL DEFAULT ${slot},
    schema_digest BYTEA NOT NULL, -- Matched to ${cleanHash}
    lattice_height BIGINT NOT NULL,
    verified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_${ident}_acc_did ON ${tableName}_accounts(holder_did);
CREATE INDEX IF NOT EXISTS idx_${ident}_journal_epoch ON ${tableName}_journal_entries(epoch_height);
CREATE INDEX IF NOT EXISTS idx_${ident}_journal_tx ON ${tableName}_journal_entries(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_${ident}_anchor_digest ON ${tableName}_anchors(schema_digest);
`;
            }
        });

        // 2. Decentralized Enterprise & Workflow Database
        this.register({
            id: 'enterprise_workflow',
            name: 'Enterprise Workflow & Relational Ops',
            description: 'Multi-tenant organizational schema with verifiable audit logs, roles, and resource management.',
            dialect: 'PostgreSQL',
            generateDdl(params: SqlRenderParams): string {
                const ident = sanitizeIdentifier(params.entityLabel);
                const prefix = `enterprise_${ident}`;
                const cleanHash = (params.digest || '').trim();
                const slot = params.slotId ?? 4;

                return `-- =====================================================================
-- Sovereign Reth Polymorphic SQL Interpretation
-- Archetype: Enterprise Workflow & Relational Ops
-- Entity: ${params.entityLabel}
-- Slot ${slot} Commitment Digest: ${cleanHash}
-- =====================================================================

CREATE TABLE IF NOT EXISTS ${prefix}_tenants (
    tenant_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    root_did VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ${prefix}_users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) REFERENCES ${prefix}_tenants(tenant_id),
    did VARCHAR(128) NOT NULL,
    evm_address VARCHAR(42) NOT NULL,
    role VARCHAR(64) NOT NULL DEFAULT 'member',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ${prefix}_resources (
    resource_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) REFERENCES ${prefix}_tenants(tenant_id),
    name VARCHAR(255) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    content_hash BYTEA,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ${prefix}_audit_log (
    log_id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) REFERENCES ${prefix}_tenants(tenant_id),
    actor_did VARCHAR(128) NOT NULL,
    action VARCHAR(128) NOT NULL,
    resource_id UUID,
    payload JSONB,
    state_commitment BYTEA NOT NULL, -- Target Slot ${slot}: ${cleanHash}
    epoch_height BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_${ident}_users_did ON ${prefix}_users(did);
CREATE INDEX IF NOT EXISTS idx_${ident}_audit_actor ON ${prefix}_audit_log(actor_did);
CREATE INDEX IF NOT EXISTS idx_${ident}_audit_epoch ON ${prefix}_audit_log(epoch_height);
`;
            }
        });

        // 3. Document & JSONB Object Store
        this.register({
            id: 'document_store',
            name: 'Content-Addressed Document Store',
            description: 'NoSQL-over-SQL document collections with BLAKE3 hash integrity, revision history, and schema validation.',
            dialect: 'PostgreSQL / JSONB',
            generateDdl(params: SqlRenderParams): string {
                const ident = sanitizeIdentifier(params.entityLabel);
                const cleanHash = (params.digest || '').trim();
                const slot = params.slotId ?? 4;

                return `-- =====================================================================
-- Sovereign Reth Polymorphic SQL Interpretation
-- Archetype: Content-Addressed Document Store
-- Entity: ${params.entityLabel}
-- Slot ${slot} Commitment Digest: ${cleanHash}
-- =====================================================================

CREATE TABLE IF NOT EXISTS docs_${ident}_collections (
    collection_id VARCHAR(64) PRIMARY KEY,
    schema_validator JSONB,
    owner_did VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS docs_${ident}_documents (
    document_id VARCHAR(128) PRIMARY KEY,
    collection_id VARCHAR(64) REFERENCES docs_${ident}_collections(collection_id),
    version BIGINT NOT NULL DEFAULT 1,
    content_blake3_hash BYTEA NOT NULL,
    document_data JSONB NOT NULL,
    encrypted_view_key_envelope BYTEA,
    last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS docs_${ident}_revisions (
    revision_id BIGSERIAL PRIMARY KEY,
    document_id VARCHAR(128) REFERENCES docs_${ident}_documents(document_id),
    version BIGINT NOT NULL,
    blake3_hash BYTEA NOT NULL,
    author_did VARCHAR(128) NOT NULL,
    diff_data JSONB,
    epoch_height BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_${ident}_doc_coll ON docs_${ident}_documents(collection_id);
CREATE INDEX IF NOT EXISTS idx_${ident}_doc_hash ON docs_${ident}_documents(content_blake3_hash);
CREATE INDEX IF NOT EXISTS idx_${ident}_doc_data ON docs_${ident}_documents USING GIN (document_data);
`;
            }
        });

        // 4. Zanzibar ReBAC Permission Engine
        this.register({
            id: 'auth_rebac',
            name: 'Fine-Grained ReBAC Access Control',
            description: 'Google Zanzibar-style namespace, relation tuples, subject sets, and ZK membership checkpoints.',
            dialect: 'Space and Time SQL / PostgreSQL',
            generateDdl(params: SqlRenderParams): string {
                const ident = sanitizeIdentifier(params.entityLabel);
                const cleanHash = (params.digest || '').trim();
                const slot = params.slotId ?? 1;

                return `-- =====================================================================
-- Sovereign Reth Polymorphic SQL Interpretation
-- Archetype: Fine-Grained ReBAC Access Control (Zanzibar Engine)
-- Entity: ${params.entityLabel}
-- Slot ${slot} Commitment: ${cleanHash}
-- =====================================================================

CREATE TABLE IF NOT EXISTS rebac_${ident}_namespaces (
    namespace_id SMALLINT PRIMARY KEY,
    name VARCHAR(64) UNIQUE NOT NULL,
    schema_definition TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rebac_${ident}_relation_tuples (
    tuple_id BIGSERIAL PRIMARY KEY,
    namespace_id SMALLINT REFERENCES rebac_${ident}_namespaces(namespace_id),
    object_id BYTEA NOT NULL,
    relation VARCHAR(64) NOT NULL,
    subject_namespace_id SMALLINT,
    subject_id BYTEA NOT NULL,
    subject_relation VARCHAR(64),
    zookie_token BYTEA,
    epoch_registered BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_${ident}_tuple ON rebac_${ident}_relation_tuples(
    namespace_id, object_id, relation, subject_id
);
CREATE INDEX IF NOT EXISTS idx_${ident}_subject ON rebac_${ident}_relation_tuples(subject_id);
`;
            }
        });

        // 5. Time-Series Telemetry & Rollup Logs
        this.register({
            id: 'timeseries_telemetry',
            name: 'Time-Series Telemetry & Rollups',
            description: 'High-throughput telemetry logs with epoch aggregation windows and cryptographic rollup roots.',
            dialect: 'ClickHouse / TimeScaleDB',
            generateDdl(params: SqlRenderParams): string {
                const ident = sanitizeIdentifier(params.entityLabel);
                const cleanHash = (params.digest || '').trim();
                const slot = params.slotId ?? 4;

                return `-- =====================================================================
-- Sovereign Reth Polymorphic SQL Interpretation
-- Archetype: Time-Series Telemetry & Rollups
-- Entity: ${params.entityLabel}
-- Slot ${slot} Commitment: ${cleanHash}
-- =====================================================================

CREATE TABLE IF NOT EXISTS telemetry_${ident}_readings (
    device_id VARCHAR(64) NOT NULL,
    metric_name VARCHAR(64) NOT NULL,
    metric_value DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    epoch_height BIGINT NOT NULL,
    signature BYTEA,
    PRIMARY KEY (device_id, metric_name, recorded_at)
);

CREATE TABLE IF NOT EXISTS telemetry_${ident}_rollup_checkpoints (
    checkpoint_id BIGSERIAL PRIMARY KEY,
    epoch_window_start BIGINT NOT NULL,
    epoch_window_end BIGINT NOT NULL,
    records_count BIGINT NOT NULL,
    merkle_rollup_root BYTEA NOT NULL, -- Target Slot ${slot}: ${cleanHash}
    settled_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_${ident}_ts_recorded ON telemetry_${ident}_readings(recorded_at);
CREATE INDEX IF NOT EXISTS idx_${ident}_ts_epoch ON telemetry_${ident}_readings(epoch_height);
`;
            }
        });
    }

    public register(template: SqlSchemaTemplate): void {
        this._templates.set(template.id, template);
    }

    public get(id: string): SqlSchemaTemplate | undefined {
        return this._templates.get(id);
    }

    public getAll(): SqlSchemaTemplate[] {
        return Array.from(this._templates.values());
    }

    /**
     * Define a user-supplied custom template dynamically
     */
    public defineCustomTemplate(template: SqlSchemaTemplate): void {
        this.register(template);
        this._persistCustomTemplates();
    }

    /**
     * Remove a custom template
     */
    public removeCustomTemplate(id: string): boolean {
        const deleted = this._templates.delete(id);
        if (deleted) {
            this._persistCustomTemplates();
        }
        return deleted;
    }

    /**
     * Render DDL using the best-matching or requested template
     */
    public renderDdl(templateId: string | undefined, params: SqlRenderParams): { ddl: string; template: SqlSchemaTemplate } {
        let tpl = templateId ? this.get(templateId) : undefined;
        if (!tpl) {
            tpl = this.get('relational_ledger') || this.getAll()[0];
        }
        return {
            ddl: tpl.generateDdl(params),
            template: tpl
        };
    }

    private _persistCustomTemplates(): void {
        if (typeof window === 'undefined' || !window.localStorage) return;
        try {
            const customList: Array<{ id: string; name: string; description: string; dialect: string; ddlTemplate: string }> = [];
            for (const t of this._templates.values()) {
                if (t.id.startsWith('custom_')) {
                    customList.push({
                        id: t.id,
                        name: t.name,
                        description: t.description,
                        dialect: t.dialect,
                        ddlTemplate: t.generateDdl({ entityLabel: 'EXAMPLE', digest: '0x0000', slotId: 4 })
                    });
                }
            }
            window.localStorage.setItem(this._storageKey, JSON.stringify(customList));
        } catch (e) {
            console.warn('Failed to persist custom SQL templates:', e);
        }
    }

    private _loadCustomTemplates(): void {
        if (typeof window === 'undefined' || !window.localStorage) return;
        try {
            const raw = window.localStorage.getItem(this._storageKey);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (item.id && item.name && item.ddlTemplate) {
                        this.register({
                            id: item.id,
                            name: item.name,
                            description: item.description || 'User-defined custom SQL template',
                            dialect: item.dialect || 'SQL',
                            generateDdl: (params: SqlRenderParams) => {
                                return item.ddlTemplate
                                    .replace(/EXAMPLE/g, sanitizeIdentifier(params.entityLabel))
                                    .replace(/0x0000/g, params.digest);
                            }
                        });
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to load custom SQL templates:', e);
        }
    }
}

function sanitizeIdentifier(name: string): string {
    return (name || 'service')
        .toLowerCase()
        .replace(/\s*sql\s*ddl\s*schema\s*/gi, '')
        .replace(/did:sovereign:[0-9]+:/gi, '')
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || 'service_state';
}
