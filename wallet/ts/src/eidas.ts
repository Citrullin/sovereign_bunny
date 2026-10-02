// eIDAS 2.0 Verifiable Credential and SD-JWT Store
// Provides client-side handling for Qualified Trust Service Provider (QTSP) credentials,
// Selective Disclosure (SD-JWT), and QSCD hardware/passkey binding.

import { Hex } from './envelopes.js';

export interface EidasSdJwtCredential {
    /// The raw SD-JWT compact serialization: <issuer_jwt>~<disclosure_1>~...~<disclosure_n>~<holder_binding_jwt>
    rawSdJwt: string;
    /// Merkle root of the official EU/jurisdiction LOTL (List of Trusted Lists)
    lotlMerkleRoot: Hex;
    /// Merkle inclusion proof proving issuing QTSP is in the LOTL
    qtspInclusionProof: Hex;
    /// Qualified Signature Creation Device (QSCD) level: e.g., 'QSCD_HARDWARE', 'QSCD_REMOTE_HSM'
    qscdLevel: 'QSCD_HARDWARE' | 'QSCD_REMOTE_HSM' | 'EIDAS_HIGH';
    /// Salted public key hash / commitment of the holder
    holderPubkeyCommitment: Hex;
    /// Credential expiration timestamp (unix seconds)
    expiresAt: bigint;
    /// Disclosed claims map (e.g., {"age_over_18": true, "nationality": "DE"})
    disclosedClaims: Record<string, unknown>;
}

export interface EidasPredicateProofSubmission {
    /// Predicate type identifier (e.g. 1 = AgeAbove18, 2 = IsEuResident, 3 = AccreditedInvestor)
    predicateId: number;
    /// Cryptographic nullifier scoped to the verifier's audience
    domainScopedNullifier: Hex;
    /// Noir zkProof verifying SD-JWT signature under trusted QTSP without revealing full identity
    zkProof: Hex;
    /// Active LOTL Merkle root used during proof generation
    lotlRoot: Hex;
}

export class EidasCredentialStore {
    private credentials: Map<string, EidasSdJwtCredential> = new Map();

    /// Stores a new SD-JWT verifiable credential
    storeCredential(id: string, credential: EidasSdJwtCredential): void {
        this.credentials.set(id, credential);
    }

    /// Retrieves credential by ID
    getCredential(id: string): EidasSdJwtCredential | undefined {
        return this.credentials.get(id);
    }

    /// Formats an eIDAS predicate proof payload for submission to Precompile 0x08 / SYSTEM_ZK_COMPLIANCE
    static formatPredicateSubmission(submission: EidasPredicateProofSubmission): Hex {
        const json = JSON.stringify({
            predicate_id: submission.predicateId,
            domain_scoped_nullifier: submission.domainScopedNullifier,
            zk_proof: submission.zkProof,
            lotl_root: submission.lotlRoot,
        });
        const encoder = new TextEncoder();
        const bytes = encoder.encode(json);
        let hex = '0x';
        for (const b of bytes) {
            hex += b.toString(16).padStart(2, '0');
        }
        return hex as Hex;
    }
}
