// Polymorphic DAO Plugin System for Sovereign Account-Lattice & Virtual CAR
// Conforms to Phase 2 & Unternehmensregister HGB/GnR/VR statutory schemas.
// Enables polymorphic state representations across CAR slots R_0..R_63,
// while preserving zero-knowledge confidentiality via Shielded Blind Notes (Slot 2).

import { ethers } from 'ethers';
import { UnternehmensregisterPayload } from './unternehmensregister_schema.js';

/// ----------------------------------------------------------------------------
/// Canonical Polymorphic DAO Type Tags (Aligned with car-vstate crate)
/// ----------------------------------------------------------------------------

export enum DaoTypeTag {
    RAW = 0x0000,
    GMBH_CORPORATE = 0x0001,       // HRB (Handelsregister B) Corporate Entity
    GMBH_CORP = 0x0001,
    EG_COOPERATIVE = 0x0002,       // GnR (Genossenschaftsregister) Democratic Cooperative
    EG_COOP = 0x0002,
    EV_ASSOCIATION = 0x0003,       // VR (Vereinsregister) Non-Profit Association
    EV_ASSOC = 0x0003,
    SUPPLY_CONSORTIUM = 0x0004,    // Industrial B2B Supply-Chain Consortium
    MUTUAL_CREDIT_BANK = 0x0005,   // Sparkassen/Volksbanken CBMT Corridor
}

/// Magic identifier for Shielded Polymorphic Blind Note Envelopes ("SHLD" in ASCII)
export const SHIELDED_NOTE_MAGIC = new Uint8Array([0x53, 0x48, 0x4C, 0x44]);

/// ----------------------------------------------------------------------------
/// Core Polymorphic Plugin Interface
/// ----------------------------------------------------------------------------

export interface IDaoPlugin<TState = any, TShieldedPayload = any> {
    readonly typeTag: DaoTypeTag;
    readonly typeName: string;
    readonly schemaHash: string; // 32-byte hex hash (B256)
    readonly registerType?: 'HRB' | 'HRA' | 'GnR' | 'VR' | 'PR' | 'CONSORTIUM' | 'BANK';

    /// Ingest and adapt state directly from parsed Unternehmensregister disclosures
    fromUnternehmensregister?(ur: UnternehmensregisterPayload): TState;

    /// Encodes typed DAO state into 64-slot Virtual CAR slot commitments (R_0..R_63)
    encodeSlots(state: TState): Map<number, Uint8Array>;

    /// Decodes typed DAO state from active CAR slot buffers
    decodeSlots(slots: Map<number, Uint8Array>): Partial<TState>;

    /// Serializes a confidential shielded payload for encryption inside a Blind Note (Slot 2)
    encodeShieldedPayload(payload: TShieldedPayload): Uint8Array;

    /// Deserializes a confidential shielded payload decrypted from a Blind Note (Slot 2)
    decodeShieldedPayload(raw: Uint8Array): TShieldedPayload;

    /// Produces a human-readable diagnostic summary for inspectors, explorer, and Remix visualizers
    summarizeSlot(slotId: number, data: Uint8Array, state?: TState): string;
}

/// ----------------------------------------------------------------------------
/// Shielded Type Extractor & Envelope Wrappers
/// ----------------------------------------------------------------------------

export class ShieldedTypeExtractor {
    /// Wraps a polymorphic payload into an opaque shielded envelope:
    /// [4-byte MAGIC "SHLD"] + [2-byte typeTag] + [4-byte payload length] + [payload bytes]
    public static wrap(typeTag: DaoTypeTag, payloadBytes: Uint8Array): Uint8Array {
        const totalLen = 4 + 2 + 4 + payloadBytes.length;
        const envelope = new Uint8Array(totalLen);

        // Header: SHLD
        envelope.set(SHIELDED_NOTE_MAGIC, 0);

        // Type Tag (uint16 big-endian)
        const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
        view.setUint16(4, typeTag, false);

        // Length (uint32 big-endian)
        view.setUint32(6, payloadBytes.length, false);

        // Payload
        envelope.set(payloadBytes, 10);
        return envelope;
    }

    /// Unwraps decrypted Blind Note plaintext, verifying MAGIC and extracting polymorphic type tag
    public static unwrap(decryptedBytes: Uint8Array): { typeTag: DaoTypeTag; payloadBytes: Uint8Array } {
        if (decryptedBytes.length < 10) {
            throw new Error(`Shielded note payload too small (${decryptedBytes.length} bytes < 10 byte header)`);
        }

        // Validate MAGIC header
        for (let i = 0; i < 4; i++) {
            if (decryptedBytes[i] !== SHIELDED_NOTE_MAGIC[i]) {
                throw new Error('Invalid shielded note magic header; expected SHLD');
            }
        }

        const view = new DataView(decryptedBytes.buffer, decryptedBytes.byteOffset, decryptedBytes.byteLength);
        const typeTag = view.getUint16(4, false) as DaoTypeTag;
        const payloadLen = view.getUint32(6, false);

        if (decryptedBytes.length < 10 + payloadLen) {
            throw new Error(`Shielded note payload truncated (expected ${payloadLen} bytes, got ${decryptedBytes.length - 10})`);
        }

        const payloadBytes = decryptedBytes.slice(10, 10 + payloadLen);
        return { typeTag, payloadBytes };
    }
}

/// ----------------------------------------------------------------------------
/// 1. GmbH Corporate DAO Plugin (HRB - Limited Liability Company)
/// ----------------------------------------------------------------------------

export interface GmbhShareholder {
    holderAddress: string;
    nominalCapitalEur: number;
    sharePercentage: number;
}

export interface GmbhCorporateState {
    companyName: string;
    registerCourt: string;
    registerNumber: string;
    subscribedCapitalEur: number;
    geschaeftsfuehrer: string[];
    shareholders: GmbhShareholder[];
    balanceSheetTotalEur: number;
    netIncomeEur: number;
    fiscalYearEnd: string;
    articlesOfAssociationGitCid: string; // Slot 3 Git DAG root
}

export interface GmbhShieldedDividendNote {
    recipientShareholder: string;
    dividendEur: number;
    fiscalYear: string;
    resolutionHash: string; // Gesellschafterbeschluss hash
    epoch: number;
}

export class GmbhCorporatePlugin implements IDaoPlugin<GmbhCorporateState, GmbhShieldedDividendNote> {
    public readonly typeTag = DaoTypeTag.GMBH_CORPORATE;
    public readonly typeName = 'GmbH Corporate DAO (HRB)';
    public readonly registerType = 'HRB';
    public readonly schemaHash = ethers.id('org.sovereign.dao.gmbh.v1');

    public fromUnternehmensregister(ur: UnternehmensregisterPayload): GmbhCorporateState {
        const meta = ur.metadata;
        const bs = ur.balanceSheet;
        const equity = bs.equityAndLiabilities.equity;

        const subscribedCapital = equity?.subscribedCapital?.currentPeriod ?? 25000;
        const totalAssets = bs.assets.totalAssets.currentPeriod ?? 0;
        const netIncome = equity?.netIncomeOrLoss?.currentPeriod ?? 0;

        const geschaeftsfuehrer = (ur.notes?.signatories || [])
            .filter(s => s.role.toLowerCase().includes('geschäftsführ') || s.role.toLowerCase().includes('director'))
            .map(s => s.name);

        return {
            companyName: meta.name,
            registerCourt: meta.register?.court || 'Amtsgericht',
            registerNumber: meta.register?.number || 'HRB 0',
            subscribedCapitalEur: subscribedCapital,
            geschaeftsfuehrer: geschaeftsfuehrer.length > 0 ? geschaeftsfuehrer : ['Geschäftsführer unbenannt'],
            shareholders: [
                {
                    holderAddress: ethers.keccak256(ethers.toUtf8Bytes(meta.name)).slice(0, 42),
                    nominalCapitalEur: subscribedCapital,
                    sharePercentage: 100,
                }
            ],
            balanceSheetTotalEur: totalAssets,
            netIncomeEur: netIncome,
            fiscalYearEnd: ur.period.fiscalYearEnd,
            articlesOfAssociationGitCid: ur.sourceHtmlSha256 || ethers.id(meta.name),
        };
    }

    public encodeSlots(state: GmbhCorporateState): Map<number, Uint8Array> {
        const slots = new Map<number, Uint8Array>();

        // Slot 0: W3C DID Document Poseidon Root
        const didUri = `did:sov:hrb:${encodeURIComponent(state.registerCourt)}:${state.registerNumber}`;
        slots.set(0, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(didUri))));

        // Slot 1: Google Zanzibar ReBAC Tuples Accumulator
        // Tuples: [company, 'has_geschaeftsfuehrer', gf], [company, 'has_shareholder', sh]
        const rebacContent = JSON.stringify({
            namespace: 'gmbh',
            court: state.registerCourt,
            gf: state.geschaeftsfuehrer,
            sh: state.shareholders.map(s => s.holderAddress),
        });
        slots.set(1, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(rebacContent))));

        // Slot 3: Articles of Association Git DAG Root
        slots.set(3, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(state.articlesOfAssociationGitCid))));

        // Slot 4: Proof of SQL Balance Sheet Table Anchor (§ 266 HGB)
        const sqlContent = JSON.stringify({
            hgb_266_aktiva: state.balanceSheetTotalEur,
            hgb_266_passiva: state.balanceSheetTotalEur,
            stammkapital: state.subscribedCapitalEur,
            jahresueberschuss: state.netIncomeEur,
            stichtag: state.fiscalYearEnd,
        });
        slots.set(4, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(sqlContent))));

        // Slot 6: Share-Weighted Governance Matrix
        const govContent = JSON.stringify({
            votingMechanism: 'CAPITAL_SHARE_WEIGHTED',
            totalShares: state.subscribedCapitalEur,
            shareholders: state.shareholders,
        });
        slots.set(6, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(govContent))));

        return slots;
    }

    public decodeSlots(slots: Map<number, Uint8Array>): Partial<GmbhCorporateState> {
        const slot4 = slots.get(4);
        if (!slot4) return {};
        const hex = ethers.hexlify(slot4);
        return {
            balanceSheetTotalEur: Number(BigInt(hex.slice(0, 18)) % 10000000n),
        };
    }

    public encodeShieldedPayload(payload: GmbhShieldedDividendNote): Uint8Array {
        return ethers.toUtf8Bytes(JSON.stringify(payload));
    }

    public decodeShieldedPayload(raw: Uint8Array): GmbhShieldedDividendNote {
        const text = ethers.toUtf8String(raw);
        return JSON.parse(text);
    }

    public summarizeSlot(slotId: number, data: Uint8Array, state?: GmbhCorporateState): string {
        const hex = ethers.hexlify(data);
        if (slotId === 0) return `GmbH DID Root [${state?.companyName || 'Corporate'}] (${hex.slice(0, 10)}...)`;
        if (slotId === 1) return `Zanzibar ReBAC: Geschäftsführer (${state?.geschaeftsfuehrer.join(', ') || 'N/A'})`;
        if (slotId === 2) return `Blind Note SMT: Private Dividend & Share Allocation Register`;
        if (slotId === 3) return `Git Satzung DAG Root (${hex.slice(0, 10)}...)`;
        if (slotId === 4) return `§ 266 HGB Balance Sheet Anchor: Bilanzsumme €${state?.balanceSheetTotalEur.toLocaleString() ?? 'N/A'}`;
        if (slotId === 6) return `Shareholder Voting Matrix: Stammkapital €${state?.subscribedCapitalEur.toLocaleString() ?? 'N/A'}`;
        return `Slot ${slotId}: ${hex.slice(0, 10)}...`;
    }
}

/// ----------------------------------------------------------------------------
/// 2. eG Cooperative DAO Plugin (GnR - Registered Cooperative / Genossenschaft)
/// ----------------------------------------------------------------------------

export interface CoopMember {
    memberDid: string;
    membershipNumber: string;
    cooperativeSharesEur: number;
    hasVoice: boolean; // 1 member = 1 vote
}

export interface GenossenschaftCooperativeState {
    cooperativeName: string;
    registerCourt: string;
    registerNumber: string;
    vorstand: string[];
    aufsichtsrat: string[];
    pruefungsverband: string;
    totalMembers: number;
    members: CoopMember[];
    businessCreditsEur: number;
    statutoryPurpose: string;
}

export interface CoopShieldedPatronageNote {
    memberDid: string;
    patronageRefundEur: number; // Rückvergütung (§ 19 GenG)
    businessTurnoverEur: number;
    fiscalPeriod: string;
    auditVerificationHash: string;
}

export class GenossenschaftCooperativePlugin implements IDaoPlugin<GenossenschaftCooperativeState, CoopShieldedPatronageNote> {
    public readonly typeTag = DaoTypeTag.EG_COOP;
    public readonly typeName = 'eG Cooperative DAO (GnR)';
    public readonly registerType = 'GnR';
    public readonly schemaHash = ethers.id('org.sovereign.dao.eg_cooperative.v1');

    public fromUnternehmensregister(ur: UnternehmensregisterPayload): GenossenschaftCooperativeState {
        const meta = ur.metadata;
        const vorstand = (ur.notes?.signatories || [])
            .filter(s => s.role.toLowerCase().includes('vorstand'))
            .map(s => s.name);

        return {
            cooperativeName: meta.name,
            registerCourt: meta.register?.court || 'Amtsgericht',
            registerNumber: meta.register?.number || 'GnR 0',
            vorstand: vorstand.length > 0 ? vorstand : ['Vorstand unbenannt'],
            aufsichtsrat: ['Aufsichtsrat Gremium'],
            pruefungsverband: 'Deutscher Genossenschafts- und Raiffeisenverband e.V. (DGRV)',
            totalMembers: ur.notes?.averageEmployees ? ur.notes.averageEmployees * 5 : 42,
            members: [
                {
                    memberDid: `did:sov:gnr:${encodeURIComponent(meta.name)}:001`,
                    membershipNumber: 'M-001',
                    cooperativeSharesEur: 500,
                    hasVoice: true, // One-member-one-vote
                }
            ],
            businessCreditsEur: ur.balanceSheet.assets.currentAssets?.receivables?.currentPeriod ?? 100000,
            statutoryPurpose: 'Förderung des Erwerbs oder der Wirtschaft der Mitglieder (§ 1 GenG)',
        };
    }

    public encodeSlots(state: GenossenschaftCooperativeState): Map<number, Uint8Array> {
        const slots = new Map<number, Uint8Array>();

        // Slot 0: W3C DID of Cooperative
        const didUri = `did:sov:gnr:${encodeURIComponent(state.registerCourt)}:${state.registerNumber}`;
        slots.set(0, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(didUri))));

        // Slot 1: Zanzibar ReBAC: Democratic Genosse, Vorstand, Aufsichtsrat, Prüfungsverband
        const rebacContent = JSON.stringify({
            namespace: 'cooperative_gnr',
            vorstand: state.vorstand,
            aufsichtsrat: state.aufsichtsrat,
            pruefungsverband: state.pruefungsverband,
            membersCount: state.totalMembers,
        });
        slots.set(1, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(rebacContent))));

        // Slot 4: Proof of SQL Member Registry & Cooperative Credit Ledger
        const sqlContent = JSON.stringify({
            genossenschaftsregister: state.registerNumber,
            geschaeftsguthaben: state.members.reduce((acc, m) => acc + m.cooperativeSharesEur, 0),
            business_credits: state.businessCreditsEur,
        });
        slots.set(4, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(sqlContent))));

        // Slot 6: DEMOCRATIC ONE-MEMBER-ONE-VOTE MATRIX (GenG § 43 Abs. 3)
        // Strictly invariant: Every member has weight = 1 regardless of capital share!
        const govContent = JSON.stringify({
            rule: 'DEMOCRATIC_ONE_MEMBER_ONE_VOTE',
            statute: 'GenG_§43_Abs3',
            votesPerMember: 1,
            quorumPercentage: 50,
            totalVotingMembers: state.totalMembers,
        });
        slots.set(6, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(govContent))));

        return slots;
    }

    public decodeSlots(_slots: Map<number, Uint8Array>): Partial<GenossenschaftCooperativeState> {
        return {};
    }

    public encodeShieldedPayload(payload: CoopShieldedPatronageNote): Uint8Array {
        return ethers.toUtf8Bytes(JSON.stringify(payload));
    }

    public decodeShieldedPayload(raw: Uint8Array): CoopShieldedPatronageNote {
        const text = ethers.toUtf8String(raw);
        return JSON.parse(text);
    }

    public summarizeSlot(slotId: number, data: Uint8Array, state?: GenossenschaftCooperativeState): string {
        const hex = ethers.hexlify(data);
        if (slotId === 0) return `eG Cooperative DID Root [${state?.cooperativeName || 'Genossenschaft'}]`;
        if (slotId === 1) return `Coop ReBAC: Vorstand (${state?.vorstand.join(', ')}) & Prüfungsverband`;
        if (slotId === 2) return `Blind Note SMT: Private Patronage Refunds (§ 19 GenG Rückvergütungen)`;
        if (slotId === 4) return `Member Registry & Credit Channel (${state?.totalMembers ?? 0} Genossen)`;
        if (slotId === 6) return `Democratic 1-Member-1-Vote Matrix (GenG § 43) [Equal Weight]`;
        return `Slot ${slotId}: ${hex.slice(0, 10)}...`;
    }
}

/// ----------------------------------------------------------------------------
/// 3. e.V. Association DAO Plugin (VR - Registered Non-Profit Association)
/// ----------------------------------------------------------------------------

export interface VereinAssociationState {
    associationName: string;
    registerCourt: string;
    registerNumber: string;
    vorstand: string[];
    kassenwart: string;
    gemeinnuetzig: boolean;
    purpose: string;
    meritRankingEnabled: boolean;
}

export interface VereinShieldedMeritNote {
    recipientMemberDid: string;
    meritPoints: number; // Busy Bee token / merit score
    contributionHash: string; // Proof of hack/talk/contribution
    epoch: number;
    attestationSignature: string;
}

export class VereinAssociationPlugin implements IDaoPlugin<VereinAssociationState, VereinShieldedMeritNote> {
    public readonly typeTag = DaoTypeTag.EV_ASSOC;
    public readonly typeName = 'e.V. Association DAO (VR)';
    public readonly registerType = 'VR';
    public readonly schemaHash = ethers.id('org.sovereign.dao.ev_association.v1');

    public fromUnternehmensregister(ur: UnternehmensregisterPayload): VereinAssociationState {
        const meta = ur.metadata;
        const vorstand = (ur.notes?.signatories || [])
            .map(s => s.name);

        return {
            associationName: meta.name,
            registerCourt: meta.register?.court || 'Amtsgericht',
            registerNumber: meta.register?.number || 'VR 0',
            vorstand: vorstand.length > 0 ? vorstand : ['Vorstandvorsitzende(r)'],
            kassenwart: 'Kassenwart(in)',
            gemeinnuetzig: true,
            purpose: 'Förderung von Wissenschaft, Kunst und dezentraler Softwareentwicklung',
            meritRankingEnabled: true,
        };
    }

    public encodeSlots(state: VereinAssociationState): Map<number, Uint8Array> {
        const slots = new Map<number, Uint8Array>();

        // Slot 0: W3C DID of e.V.
        const didUri = `did:sov:vr:${encodeURIComponent(state.registerCourt)}:${state.registerNumber}`;
        slots.set(0, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(didUri))));

        // Slot 1: Zanzibar ReBAC: [mitglied, vorstand, kassenwart]
        const rebacContent = JSON.stringify({
            namespace: 'verein_vr',
            vorstand: state.vorstand,
            kassenwart: state.kassenwart,
            gemeinnuetzig: state.gemeinnuetzig,
        });
        slots.set(1, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(rebacContent))));

        // Slot 6: MeritRank & Quadratic Funding Governance Matrix
        const govContent = JSON.stringify({
            type: 'OSTROM_COMMONS_MERITRANK',
            quadraticFunding: true,
            meritDecayRatePerEpoch: 0.05,
        });
        slots.set(6, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(govContent))));

        return slots;
    }

    public decodeSlots(_slots: Map<number, Uint8Array>): Partial<VereinAssociationState> {
        return {};
    }

    public encodeShieldedPayload(payload: VereinShieldedMeritNote): Uint8Array {
        return ethers.toUtf8Bytes(JSON.stringify(payload));
    }

    public decodeShieldedPayload(raw: Uint8Array): VereinShieldedMeritNote {
        return JSON.parse(ethers.toUtf8String(raw));
    }

    public summarizeSlot(slotId: number, data: Uint8Array, state?: VereinAssociationState): string {
        const hex = ethers.hexlify(data);
        if (slotId === 0) return `e.V. Association DID Root [${state?.associationName || 'Verein'}]`;
        if (slotId === 1) return `Association ReBAC: Vorstand & Kassenwart (${state?.vorstand.join(', ') || 'N/A'})`;
        if (slotId === 2) return `Blind Note SMT: Confidential Merit / Busy Bee Reward Distribution`;
        if (slotId === 6) return `MeritRank & Quadratic Commons Allocation Matrix`;
        return `Slot ${slotId}: ${hex.slice(0, 10)}...`;
    }
}

/// ----------------------------------------------------------------------------
/// 4. Industrial B2B Supply-Chain Consortium DAO Plugin
/// ----------------------------------------------------------------------------

export interface SupplyChainConsortiumState {
    consortiumName: string;
    cycloneDxSbomRoot: string; // CycloneDX Software/Hardware BOM root CID
    participants: { companyDid: string; role: 'OEM' | 'TIER1' | 'TIER2' | 'CARRIER' | 'AUDITOR' }[];
    cyclicNettingCyclesCount: number;
}

export interface SupplyChainShieldedNote {
    invoiceId: string;
    nettingCycleId: string;
    grossAmountEur: number;
    settledAmountEur: number;
    bolHash: string; // Bill of Lading hash
    timestamp: number;
}

export class SupplyChainConsortiumPlugin implements IDaoPlugin<SupplyChainConsortiumState, SupplyChainShieldedNote> {
    public readonly typeTag = DaoTypeTag.SUPPLY_CONSORTIUM;
    public readonly typeName = 'Industrial Supply-Chain Consortium DAO';
    public readonly registerType = 'CONSORTIUM';
    public readonly schemaHash = ethers.id('org.sovereign.dao.supply_consortium.v1');

    public encodeSlots(state: SupplyChainConsortiumState): Map<number, Uint8Array> {
        const slots = new Map<number, Uint8Array>();

        // Slot 0: Consortium Federated DID Root
        slots.set(0, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(`did:sov:consortium:${state.consortiumName}`))));

        // Slot 1: B2B Multi-Party Zanzibar Federation
        const rebacContent = JSON.stringify({
            namespace: 'supply_consortium',
            participants: state.participants,
        });
        slots.set(1, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(rebacContent))));

        // Slot 3: CycloneDX SBOM & Signed Delivery Manifest Git DAG Root
        slots.set(3, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(state.cycloneDxSbomRoot))));

        // Slot 4: Multilateral Cyclic Netting Engine Anchor
        const nettingContent = JSON.stringify({
            engine: 'MULTILATERAL_CYCLE_CANCELLATION',
            cyclesCount: state.cyclicNettingCyclesCount,
        });
        slots.set(4, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(nettingContent))));

        return slots;
    }

    public decodeSlots(_slots: Map<number, Uint8Array>): Partial<SupplyChainConsortiumState> {
        return {};
    }

    public encodeShieldedPayload(payload: SupplyChainShieldedNote): Uint8Array {
        return ethers.toUtf8Bytes(JSON.stringify(payload));
    }

    public decodeShieldedPayload(raw: Uint8Array): SupplyChainShieldedNote {
        return JSON.parse(ethers.toUtf8String(raw));
    }

    public summarizeSlot(slotId: number, data: Uint8Array, state?: SupplyChainConsortiumState): string {
        const hex = ethers.hexlify(data);
        if (slotId === 0) return `Consortium Federation DID [${state?.consortiumName || 'B2B'}]`;
        if (slotId === 1) return `B2B Zanzibar Federation: ${state?.participants.length || 0} Industrial Partners`;
        if (slotId === 2) return `Blind Note SMT: Private Netting & Bill-of-Lading Tokens`;
        if (slotId === 3) return `CycloneDX SBOM / Manifest DAG Root (${hex.slice(0, 10)}...)`;
        if (slotId === 4) return `Proof of SQL: Cyclic Debt Netting Matrix (${state?.cyclicNettingCyclesCount || 0} cycles)`;
        return `Slot ${slotId}: ${hex.slice(0, 10)}...`;
    }
}

/// ----------------------------------------------------------------------------
/// 5. Mutual Credit Bank DAO Plugin (Regional Sparkassen / Volksbanken Corridor)
/// ----------------------------------------------------------------------------

export interface MutualCreditBankState {
    bankBic: string;
    institutionName: string;
    cbmtReserveAmountEur: number; // Commercial Bank Money Token reserves
    pontesTarget2ChannelHash: string; // TARGET2 interbank gateway
    clearingMembersCount: number;
}

export interface MutualBankShieldedNote {
    cbmtAmountEur: number;
    sourceBic: string;
    targetBic: string;
    interbankPaymentRef: string;
    pontesSettlementHash: string;
}

export class MutualCreditBankPlugin implements IDaoPlugin<MutualCreditBankState, MutualBankShieldedNote> {
    public readonly typeTag = DaoTypeTag.MUTUAL_CREDIT_BANK;
    public readonly typeName = 'Mutual Credit Bank DAO (CBMT / TARGET2)';
    public readonly registerType = 'BANK';
    public readonly schemaHash = ethers.id('org.sovereign.dao.mutual_bank.v1');

    public encodeSlots(state: MutualCreditBankState): Map<number, Uint8Array> {
        const slots = new Map<number, Uint8Array>();

        // Slot 0: Bank Institution DID Root
        slots.set(0, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(`did:sov:bic:${state.bankBic}`))));

        // Slot 1: Banking Syndicate Zanzibar Access Control
        const rebacContent = JSON.stringify({
            namespace: 'banking_syndicate',
            bic: state.bankBic,
            clearingMembers: state.clearingMembersCount,
        });
        slots.set(1, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(rebacContent))));

        // Slot 4: TARGET2 / Pontes Clearing Gateway Anchor
        slots.set(4, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(state.pontesTarget2ChannelHash))));

        // Slot 8: Operational Surety / CBMT Reserve Backing
        const suretyContent = JSON.stringify({
            asset: 'EUR_CBMT',
            reserves: state.cbmtReserveAmountEur,
        });
        slots.set(8, ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(suretyContent))));

        return slots;
    }

    public decodeSlots(_slots: Map<number, Uint8Array>): Partial<MutualCreditBankState> {
        return {};
    }

    public encodeShieldedPayload(payload: MutualBankShieldedNote): Uint8Array {
        return ethers.toUtf8Bytes(JSON.stringify(payload));
    }

    public decodeShieldedPayload(raw: Uint8Array): MutualBankShieldedNote {
        return JSON.parse(ethers.toUtf8String(raw));
    }

    public summarizeSlot(slotId: number, data: Uint8Array, state?: MutualCreditBankState): string {
        const hex = ethers.hexlify(data);
        if (slotId === 0) return `Mutual Bank DID [${state?.institutionName || state?.bankBic || 'Bank'}]`;
        if (slotId === 1) return `Banking Syndicate ReBAC (BIC: ${state?.bankBic || 'N/A'})`;
        if (slotId === 2) return `Blind Note SMT: Shielded CBMT Interbank Liquidity Notes`;
        if (slotId === 4) return `Pontes DvP / TARGET2 Clearing Channel Anchor`;
        if (slotId === 8) return `Operational Surety: €${state?.cbmtReserveAmountEur.toLocaleString() ?? 'N/A'} CBMT Reserve`;
        return `Slot ${slotId}: ${hex.slice(0, 10)}...`;
    }
}

/// ----------------------------------------------------------------------------
/// Central DAO Plugin Registry & Polymorphic Resolver
/// ----------------------------------------------------------------------------

export class DaoPluginRegistry {
    private static plugins: Map<DaoTypeTag, IDaoPlugin> = new Map();

    static {
        // Register canonical standard plugins
        this.register(new GmbhCorporatePlugin());
        this.register(new GenossenschaftCooperativePlugin());
        this.register(new VereinAssociationPlugin());
        this.register(new SupplyChainConsortiumPlugin());
        this.register(new MutualCreditBankPlugin());
    }

    public static register(plugin: IDaoPlugin) {
        this.plugins.set(plugin.typeTag, plugin);
    }

    public static get<T extends IDaoPlugin = IDaoPlugin>(typeTag: DaoTypeTag): T | undefined {
        return this.plugins.get(typeTag) as T | undefined;
    }

    public static getAll(): IDaoPlugin[] {
        return Array.from(this.plugins.values());
    }

    /// Dynamically resolves the appropriate statutory DAO plugin from parsed Unternehmensregister metadata
    public static resolveFromUnternehmensregister(ur: UnternehmensregisterPayload): IDaoPlugin {
        const regType = ur.metadata.register?.type;
        const legalForm = (ur.metadata.legalForm || '').toLowerCase();

        if (regType === 'GnR' || legalForm.includes('genossenschaft') || legalForm.includes('e.g.')) {
            return this.get(DaoTypeTag.EG_COOP)!;
        }

        if (regType === 'VR' || legalForm.includes('verein') || legalForm.includes('e.v.')) {
            return this.get(DaoTypeTag.EV_ASSOC)!;
        }

        // Default commercial register is GmbH / HRB corporate entity
        return this.get(DaoTypeTag.GMBH_CORP)!;
    }

    /// Polymorphic Decryption & Deserialization:
    /// Takes raw plaintext decrypted from a Blind Note (Slot 2), extracts the confidential type tag,
    /// looks up the corresponding DAO plugin, and unwraps the typed payload.
    public static unwrapDecryptedNote(decryptedBytes: Uint8Array): {
        typeTag: DaoTypeTag;
        plugin: IDaoPlugin;
        payload: any;
    } {
        const { typeTag, payloadBytes } = ShieldedTypeExtractor.unwrap(decryptedBytes);
        const plugin = this.get(typeTag);
        if (!plugin) {
            throw new Error(`No registered DAO plugin found for type tag 0x${typeTag.toString(16).padStart(4, '0')}`);
        }
        const payload = plugin.decodeShieldedPayload(payloadBytes);
        return { typeTag, plugin, payload };
    }
}
