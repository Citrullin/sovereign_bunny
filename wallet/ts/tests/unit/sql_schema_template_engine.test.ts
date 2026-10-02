import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import {
    SqlSchemaRegistry,
    SqlSchemaTemplate,
    SqlRenderParams
} from '../../src/components/sql_schema_template_engine.js';

describe('SqlSchemaRegistry & Polymorphic SQL Template Engine', () => {
    const registry = SqlSchemaRegistry.getInstance();

    it('initializes with standard built-in dynamic archetypes', () => {
        const templates = registry.getAll();
        assert.ok(templates.length >= 5, 'Should have at least 5 built-in archetypes');

        const ids = templates.map(t => t.id);
        assert.ok(ids.includes('relational_ledger'), 'Includes relational_ledger');
        assert.ok(ids.includes('enterprise_workflow'), 'Includes enterprise_workflow');
        assert.ok(ids.includes('document_store'), 'Includes document_store');
        assert.ok(ids.includes('auth_rebac'), 'Includes auth_rebac');
        assert.ok(ids.includes('timeseries_telemetry'), 'Includes timeseries_telemetry');
    });

    it('renders verifiable relational ledger DDL dynamically without hardcoded names', () => {
        const params: SqlRenderParams = {
            entityLabel: 'Global Settlement Core',
            entityDid: 'did:sovereign:1337:settlement-core',
            entityAddress: '0x1234567890123456789012345678901234567890',
            digest: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
            slotId: 4
        };

        const { ddl, template } = registry.renderDdl('relational_ledger', params);
        assert.strictEqual(template.id, 'relational_ledger');
        assert.ok(ddl.includes('CREATE TABLE IF NOT EXISTS ledger_global_settlement_core_accounts'), 'Generates dynamic table name');
        assert.ok(ddl.includes('0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'), 'Embeds target digest');
        assert.ok(ddl.includes('Slot 4'), 'Includes target Slot ID');
        assert.ok(ddl.includes('holder_did VARCHAR(128)'), 'Includes holder DID column');
        assert.ok(!ddl.toLowerCase().includes('nexterp'), 'Contains NO hardcoded NextERP slop');
    });

    it('renders enterprise workflow archetype dynamically', () => {
        const params: SqlRenderParams = {
            entityLabel: 'Decentralized Logistics Hub',
            digest: '0x1111222233334444555566667777888899990000111122223333444455556666',
            slotId: 4
        };

        const { ddl, template } = registry.renderDdl('enterprise_workflow', params);
        assert.strictEqual(template.id, 'enterprise_workflow');
        assert.ok(ddl.includes('enterprise_decentralized_logistics_hub_tenants'), 'Generates dynamic multi-tenant table');
        assert.ok(ddl.includes('enterprise_decentralized_logistics_hub_audit_log'), 'Generates dynamic audit log');
        assert.ok(ddl.includes('0x1111222233334444555566667777888899990000111122223333444455556666'), 'Embeds target digest');
    });

    it('renders content-addressed document store archetype dynamically', () => {
        const params: SqlRenderParams = {
            entityLabel: 'Regulatory Filings',
            digest: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
            slotId: 7
        };

        const { ddl, template } = registry.renderDdl('document_store', params);
        assert.strictEqual(template.id, 'document_store');
        assert.ok(ddl.includes('docs_regulatory_filings_collections'), 'Generates dynamic collection table');
        assert.ok(ddl.includes('docs_regulatory_filings_documents'), 'Generates dynamic documents table');
        assert.ok(ddl.includes('content_blake3_hash BYTEA NOT NULL'), 'Includes BLAKE3 hash integrity column');
    });

    it('renders Zanzibar ReBAC access control archetype dynamically', () => {
        const params: SqlRenderParams = {
            entityLabel: 'Microservice Access Gateway',
            digest: '0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface',
            slotId: 1
        };

        const { ddl, template } = registry.renderDdl('auth_rebac', params);
        assert.strictEqual(template.id, 'auth_rebac');
        assert.ok(ddl.includes('rebac_microservice_access_gateway_namespaces'), 'Generates dynamic namespace table');
        assert.ok(ddl.includes('rebac_microservice_access_gateway_relation_tuples'), 'Generates dynamic relation tuple table');
    });

    it('allows dynamic registration and usage of user-defined custom SQL templates', () => {
        const customId = `custom_analytics_${Date.now()}`;
        const customTemplate: SqlSchemaTemplate = {
            id: customId,
            name: 'High-Volume Financial Orderbook',
            description: 'Orderbook depth and execution tape',
            dialect: 'DuckDB / ClickHouse',
            generateDdl: (p) => {
                return `-- Custom Orderbook Schema for ${p.entityLabel}\nCREATE TABLE orderbook_${p.digest.slice(0, 10)} (id UUID, price NUMERIC);`;
            }
        };

        registry.defineCustomTemplate(customTemplate);

        const fetched = registry.get(customId);
        assert.ok(fetched, 'Custom template was registered');
        assert.strictEqual(fetched?.name, 'High-Volume Financial Orderbook');

        const { ddl } = registry.renderDdl(customId, {
            entityLabel: 'Exchange Engine',
            digest: '0x9988776655443322110099887766554433221100998877665544332211009988'
        });

        assert.ok(ddl.includes('Custom Orderbook Schema for Exchange Engine'));
        assert.ok(ddl.includes('CREATE TABLE orderbook_0x99887766'));

        // Clean up
        const removed = registry.removeCustomTemplate(customId);
        assert.strictEqual(removed, true, 'Custom template removed');
        assert.strictEqual(registry.get(customId), undefined, 'Custom template no longer in registry');
    });

    it('gracefully falls back to relational_ledger if requested template does not exist', () => {
        const { ddl, template } = registry.renderDdl('non_existent_archetype_xyz', {
            entityLabel: 'Fallback Test',
            digest: '0x0000000000000000000000000000000000000000000000000000000000000000'
        });

        assert.strictEqual(template.id, 'relational_ledger');
        assert.ok(ddl.includes('ledger_fallback_test_accounts'));
    });
});
