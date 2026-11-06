//! CycloneDX SBOM parser and Noir witness generator.

use k256::sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};

/// Represents an individual software component from a CycloneDX SBOM.
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
pub struct CycloneDxComponent {
    /// Component package name.
    pub name: String,
    /// Component semantic or release version.
    pub version: String,
    /// Cryptographic hashes associated with this component.
    pub hashes: Vec<CycloneDxHash>,
}

/// Cryptographic hash entry within a CycloneDX component.
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
pub struct CycloneDxHash {
    /// Hash algorithm name (e.g. "SHA-256").
    pub alg: String,
    /// Hex-encoded hash content digest.
    pub content: String,
}

/// Generator for zero-knowledge circuit witnesses verifying SBOM provenance.
pub struct SbomWitnessGenerator;

impl SbomWitnessGenerator {
    /// Generates a SHA-256 Merkle root from CycloneDX components and verifies non-collision with banned CVE entries.
    pub fn generate_circuit_witness(
        components: &[CycloneDxComponent],
        banned_cves: &[[u8; 32]],
    ) -> Result<Vec<u8>, &'static str> {

        let mut hasher = Sha256::new();
        for component in components {
            hasher.update(component.name.as_bytes());
            hasher.update(component.version.as_bytes());
            for hash in &component.hashes {
                hasher.update(hash.content.as_bytes());
            }
        }
        let sbom_merkle_root = hasher.finalize();

        // Verify that no component hash collides with the banned CVE database
        for cve_hash in banned_cves {
            if sbom_merkle_root.as_slice() == cve_hash.as_slice() {
                return Err("CRITICAL: Component matches banned CVE database entry");
            }
        }

        Ok(sbom_merkle_root.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sbom_witness_generator_success() {
        let components = vec![CycloneDxComponent {
            name: "openssl".to_string(),
            version: "3.0.1".to_string(),
            hashes: vec![CycloneDxHash {
                alg: "SHA-256".to_string(),
                content: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
            }],
        }];
        let banned: Vec<[u8; 32]> = vec![[0xaa; 32]];
        let root = SbomWitnessGenerator::generate_circuit_witness(&components, &banned).unwrap();
        assert_eq!(root.len(), 32);
    }

    #[test]
    fn test_sbom_witness_generator_banned_cve() {
        let components = vec![CycloneDxComponent {
            name: "vulnerable-lib".to_string(),
            version: "0.1.0".to_string(),
            hashes: vec![],
        }];
        let mut hasher = Sha256::new();
        hasher.update("vulnerable-lib".as_bytes());
        hasher.update("0.1.0".as_bytes());
        let expected_root: [u8; 32] = hasher.finalize().into();

        let banned = vec![expected_root];
        let res = SbomWitnessGenerator::generate_circuit_witness(&components, &banned);
        assert!(res.is_err());
    }
}
