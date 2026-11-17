//! # Phase 11: Terminal & Telemetry Data Tiers
//!
//! Provides consensus data tier classification and verification structures for the Terminal:
//! - [`TelemetryTier`]: Subsidized (~0 fee, sanitized deltas), Quantized (bucketed values + noise), Sovereign Dark (zero emission, max fee).
//! - [`StateLineageAttestation`]: Verifiable lineage proof binding settled state root R_settled -> account tip -> state root -> leaf.
//! - Anti-GIVO replay prevention via epoch-scoped nullifiers `Poseidon(sk, epoch, tip_hash)`.

use alloy_primitives::{Address, B256, Bytes, U256};
use serde::{Deserialize, Serialize};

use crate::governance::jurisdiction::MeritRank;

/// Telemetry and market data emission tier selected by terminal accounts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TelemetryTier {
    /// Subsidized: Verified, sanitized deltas without DID, IP, or head commitment. Minimal fee (~0), sponsored by Protocol Paymaster.
    Subsidized,
    /// Quantized: Bucketed values with privacy noise and batch delay. Moderate fee.
    Quantized,
    /// Sovereign Dark: Zero data emitted, receive-only. Maximum protocol fee (10x). Proceeds fund Protocol Paymaster.
    SovereignDark,
}

impl TelemetryTier {
    /// Returns the fee multiplier basis points (e.g. 10 bps = 0.1x, 100 bps = 1.0x, 1000 bps = 10.0x).
    #[must_use]
    pub fn fee_multiplier_bps(&self) -> u64 {
        match self {
            Self::Subsidized => 10,       // 0.1x (subsidized)
            Self::Quantized => 100,      // 1.0x (standard baseline)
            Self::SovereignDark => 1000, // 10.0x (maximum fee for dark routing, proceeds fund Paymaster)
        }
    }

    /// Returns true if this tier permits network telemetry broadcast.
    #[must_use]
    pub fn permits_telemetry_emission(&self) -> bool {
        match self {
            Self::Subsidized | Self::Quantized => true,
            Self::SovereignDark => false,
        }
    }

    /// Minimum Merit Rank required to subscribe to this tier.
    /// Subsidized tier requires MeritRank >= Rank1 to prevent Sybil exhaustion of Paymaster funds.
    #[must_use]
    pub fn min_required_merit(&self) -> MeritRank {
        match self {
            Self::Subsidized => MeritRank::Rank1,
            Self::Quantized | Self::SovereignDark => MeritRank::Rank0,
        }
    }

    /// Returns true if gas/query costs for this tier are sponsored by the Sovereign Protocol Paymaster.
    #[must_use]
    pub fn is_paymaster_sponsored(&self) -> bool {
        match self {
            Self::Subsidized => true,
            Self::Quantized | Self::SovereignDark => false,
        }
    }
}

/// Verifiable state lineage attestation for Terminal market data (anti-GIVO).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateLineageAttestation {
    /// Settled global state root (R_settled) from an epoch checkpoint
    pub settled_state_root: B256,
    /// Account head tip hash
    pub tip_hash: B256,
    /// Account address originating the data
    pub account: Address,
    /// Logical epoch of attestation
    pub epoch: u64,
    /// Volume weight proven on-ledger
    pub verified_volume_weight: U256,
    /// Nullifier preventing multiple telemetry submissions per epoch:
    /// `Nullifier = Blake3("sovereign:telemetry_nullifier:v1:", account, epoch, tip_hash)`
    pub lineage_nullifier: B256,
    /// Cryptographic proof data (UltraHonk or Spartan witness)
    pub zk_proof: Bytes,
}

impl StateLineageAttestation {
    /// Derives deterministic lineage nullifier preventing replay within an epoch:
    /// `Nullifier = Blake3("sovereign:telemetry_nullifier:v1:", account, epoch, tip_hash)`.
    #[must_use]
    pub fn derive_nullifier(account: &Address, epoch: u64, tip_hash: &B256) -> B256 {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"sovereign:telemetry_nullifier:v1:");
        hasher.update(account.as_slice());
        hasher.update(&epoch.to_le_bytes());
        hasher.update(tip_hash.as_slice());
        B256::from_slice(hasher.finalize().as_bytes())
    }

    /// Verifies the structural invariants of the lineage attestation.
    pub fn verify_structure(&self) -> Result<(), &'static str> {
        let expected_nullifier = Self::derive_nullifier(&self.account, self.epoch, &self.tip_hash);
        if self.lineage_nullifier != expected_nullifier {
            return Err("State lineage nullifier mismatch with derived hash");
        }
        if self.settled_state_root == B256::ZERO {
            return Err("State lineage requires non-zero settled state root");
        }
        if self.tip_hash == B256::ZERO {
            return Err("State lineage requires non-zero tip hash");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_telemetry_tier_fee_and_emission_invariants() {
        assert_eq!(TelemetryTier::Subsidized.fee_multiplier_bps(), 10);
        assert!(TelemetryTier::Subsidized.permits_telemetry_emission());

        assert_eq!(TelemetryTier::Quantized.fee_multiplier_bps(), 100);
        assert!(TelemetryTier::Quantized.permits_telemetry_emission());

        assert_eq!(TelemetryTier::SovereignDark.fee_multiplier_bps(), 1000);
        assert!(!TelemetryTier::SovereignDark.permits_telemetry_emission(), "Sovereign Dark must never permit telemetry emission");
    }

    #[test]
    fn test_state_lineage_nullifier_derivation_and_verification() {
        let account = Address::repeat_byte(0x12);
        let tip_hash = B256::repeat_byte(0x34);
        let epoch = 42u64;

        let nullifier1 = StateLineageAttestation::derive_nullifier(&account, epoch, &tip_hash);
        let nullifier2 = StateLineageAttestation::derive_nullifier(&account, epoch, &tip_hash);
        assert_eq!(nullifier1, nullifier2, "Lineage nullifier must be deterministic");

        // Different epoch yields distinct nullifier
        let nullifier_epoch2 = StateLineageAttestation::derive_nullifier(&account, epoch + 1, &tip_hash);
        assert_ne!(nullifier1, nullifier_epoch2);

        let attestation = StateLineageAttestation {
            settled_state_root: B256::repeat_byte(0x56),
            tip_hash,
            account,
            epoch,
            verified_volume_weight: U256::from(100_000u64),
            lineage_nullifier: nullifier1,
            zk_proof: Bytes::from(vec![0xde, 0xad, 0xbe, 0xef]),
        };

        assert!(attestation.verify_structure().is_ok());

        // Corrupted nullifier fails verification
        let mut corrupted = attestation.clone();
        corrupted.lineage_nullifier = B256::repeat_byte(0xff);
        assert!(corrupted.verify_structure().is_err());
    }
}
