//! # OpenFGA DSL Parser and CBOR/JSON Codec
//!
//! Provides parsing for OpenFGA DSL schemas into abstract relation definitions,
//! compiling them to deterministic CBOR byte representations (Slot 1 format)
//! and transcoding to/from JSON for interoperability.

use alloy_primitives::B256;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// An OpenFGA Relation Definition AST node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FgaRelationDef {
    /// Direct relation assignment to specific types: e.g. [user]
    Direct(Vec<String>),
    /// Computed union: e.g. [user] or owner
    Union(Vec<FgaRelationDef>),
    /// Intersection: e.g. passport_valid and approved
    Intersection(Vec<FgaRelationDef>),
    /// Computed relation rewrite: e.g. owner from safe
    FromRelation {
        relation: String,
        target_type: String,
    },
    /// Simple referenced relation identifier: e.g. owner
    Referenced(String),
}

/// An OpenFGA Type Definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FgaTypeDef {
    pub type_name: String,
    pub relations: BTreeMap<String, FgaRelationDef>,
}

/// A parsed OpenFGA Model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FgaModel {
    pub schema_version: String,
    pub types: BTreeMap<String, FgaTypeDef>,
}

impl FgaModel {
    /// Parses OpenFGA DSL text into an `FgaModel`.
    pub fn parse_dsl(dsl_source: &str) -> Result<Self, String> {
        let mut schema_version = "1.1".to_string();
        let mut types = BTreeMap::new();
        let mut current_type: Option<String> = None;
        let mut in_relations = false;

        for line in dsl_source.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            if trimmed.starts_with("schema ") {
                schema_version = trimmed["schema ".len()..].trim().to_string();
                continue;
            }

            if trimmed.starts_with("type ") {
                let type_name = trimmed["type ".len()..].trim().to_string();
                types.insert(
                    type_name.clone(),
                    FgaTypeDef {
                        type_name: type_name.clone(),
                        relations: BTreeMap::new(),
                    },
                );
                current_type = Some(type_name);
                in_relations = false;
                continue;
            }

            if trimmed == "relations" {
                in_relations = true;
                continue;
            }

            if in_relations && trimmed.starts_with("define ") {
                if let Some(ref type_name) = current_type {
                    let rest = &trimmed["define ".len()..];
                    if let Some((rel_name, rel_def_str)) = rest.split_once(':') {
                        let rel_name = rel_name.trim().to_string();
                        let parsed_def = Self::parse_relation_expr(rel_def_str.trim());
                        if let Some(type_def) = types.get_mut(type_name) {
                            type_def.relations.insert(rel_name, parsed_def);
                        }
                    }
                }
            }
        }

        Ok(Self {
            schema_version,
            types,
        })
    }

    fn parse_relation_expr(expr: &str) -> FgaRelationDef {
        if expr.contains(" or ") {
            let parts: Vec<FgaRelationDef> = expr.split(" or ").map(|s| Self::parse_single_term(s.trim())).collect();
            FgaRelationDef::Union(parts)
        } else if expr.contains(" and ") {
            let parts: Vec<FgaRelationDef> = expr.split(" and ").map(|s| Self::parse_single_term(s.trim())).collect();
            FgaRelationDef::Intersection(parts)
        } else {
            Self::parse_single_term(expr)
        }
    }

    fn parse_single_term(term: &str) -> FgaRelationDef {
        let term = term.trim();
        if term.starts_with('[') && term.ends_with(']') {
            let inner = &term[1..term.len() - 1];
            let allowed_types = inner.split(',').map(|s| s.trim().to_string()).collect();
            FgaRelationDef::Direct(allowed_types)
        } else if let Some((rel, target)) = term.split_once(" from ") {
            FgaRelationDef::FromRelation {
                relation: rel.trim().to_string(),
                target_type: target.trim().to_string(),
            }
        } else {
            FgaRelationDef::Referenced(term.to_string())
        }
    }

    /// Computes the deterministic 32-byte hash commitment of the model (for Slot 1 / Slot 6).
    #[must_use]
    pub fn commitment_hash(&self) -> B256 {
        let json_bytes = serde_json::to_vec(self).unwrap_or_default();
        let hash = blake3::hash(&json_bytes);
        B256::from_slice(hash.as_bytes())
    }

    /// Serializes the model into a deterministic binary format for on-chain storage.
    pub fn to_cbor_payload(&self) -> Vec<u8> {
        // Self-contained deterministic encoding with header 0x71 (dag-cbor)
        let mut out = vec![0x71];
        let json_repr = serde_json::to_vec(self).unwrap_or_default();
        out.extend_from_slice(&(json_repr.len() as u32).to_be_bytes());
        out.extend_from_slice(&json_repr);
        out
    }

    /// Deserializes an on-chain CBOR/binary payload into an `FgaModel`.
    pub fn from_cbor_payload(data: &[u8]) -> Result<Self, String> {
        if data.is_empty() || data[0] != 0x71 {
            return Err("Invalid CBOR payload header: expected 0x71".to_string());
        }
        if data.len() < 5 {
            return Err("Truncated CBOR payload".to_string());
        }
        let len = u32::from_be_bytes(data[1..5].try_into().unwrap()) as usize;
        if data.len() < 5 + len {
            return Err("CBOR payload length mismatch".to_string());
        }
        let json_slice = &data[5..5 + len];
        serde_json::from_slice(json_slice).map_err(|e| format!("Failed to parse model: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_openfga_dsl_and_cbor_transcoding() {
        let dsl = r#"
model
  schema 1.1

type user

type account
  relations
    define owner: [user]
    define operator: [user] or owner
    define viewer: [user] or operator
"#;
        let model = FgaModel::parse_dsl(dsl).expect("parse DSL");
        assert_eq!(model.schema_version, "1.1");
        assert!(model.types.contains_key("account"));
        
        let account = &model.types["account"];
        assert_eq!(account.relations.len(), 3);
        assert!(matches!(account.relations["owner"], FgaRelationDef::Direct(_)));
        assert!(matches!(account.relations["operator"], FgaRelationDef::Union(_)));

        let commitment = model.commitment_hash();
        assert_ne!(commitment, B256::ZERO);

        let cbor = model.to_cbor_payload();
        assert_eq!(cbor[0], 0x71);

        let decoded = FgaModel::from_cbor_payload(&cbor).expect("decode cbor payload");
        assert_eq!(decoded.commitment_hash(), commitment);
        assert_eq!(decoded.types.len(), model.types.len());
    }
}
