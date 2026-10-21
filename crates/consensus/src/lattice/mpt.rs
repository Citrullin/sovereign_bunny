//! # Stateless Merkle Patricia Trie (MPT) Proof Verifier
//!
//! Evaluates standard legacy Ethereum MPT proofs (as produced by `eth_getProof`)
//! statelessly in RAM against canonical foreign state roots (Ethereum L1, Base, Gnosis).
//!
//! Implements Appendix D of the Ethereum Yellow Paper without external heavy dependencies.

use alloy_primitives::{Address, B256, U256};

/// An RLP item decoded from a byte slice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RlpItem<'a> {
    String(&'a [u8]),
    List(&'a [u8]),
}

/// Decodes an RLP header returning (item, remaining_bytes).
pub fn decode_rlp_item(input: &[u8]) -> Result<(RlpItem<'_>, &[u8]), &'static str> {
    if input.is_empty() {
        return Err("Empty RLP input");
    }
    let prefix = input[0];
    if prefix < 0x80 {
        // Single byte literal [0x00, 0x7f]
        Ok((RlpItem::String(&input[0..1]), &input[1..]))
    } else if prefix <= 0xb7 {
        // Short string 0-55 bytes
        let len = (prefix - 0x80) as usize;
        if input.len() < 1 + len {
            return Err("Truncated RLP short string");
        }
        Ok((RlpItem::String(&input[1..1 + len]), &input[1 + len..]))
    } else if prefix <= 0xbf {
        // Long string >55 bytes
        let len_of_len = (prefix - 0xb7) as usize;
        if input.len() < 1 + len_of_len {
            return Err("Truncated RLP long string length");
        }
        let mut len: usize = 0;
        for &b in &input[1..1 + len_of_len] {
            len = (len << 8) | (b as usize);
        }
        let total_offset = 1 + len_of_len;
        if input.len() < total_offset + len {
            return Err("Truncated RLP long string payload");
        }
        Ok((RlpItem::String(&input[total_offset..total_offset + len]), &input[total_offset + len..]))
    } else if prefix <= 0xf7 {
        // Short list 0-55 bytes payload
        let len = (prefix - 0xc0) as usize;
        if input.len() < 1 + len {
            return Err("Truncated RLP short list");
        }
        Ok((RlpItem::List(&input[1..1 + len]), &input[1 + len..]))
    } else {
        // Long list >55 bytes payload
        let len_of_len = (prefix - 0xf7) as usize;
        if input.len() < 1 + len_of_len {
            return Err("Truncated RLP long list length");
        }
        let mut len: usize = 0;
        for &b in &input[1..1 + len_of_len] {
            len = (len << 8) | (b as usize);
        }
        let total_offset = 1 + len_of_len;
        if input.len() < total_offset + len {
            return Err("Truncated RLP long list payload");
        }
        Ok((RlpItem::List(&input[total_offset..total_offset + len]), &input[total_offset + len..]))
    }
}

/// Decodes all items contained in an RLP list payload.
pub fn decode_rlp_list_items(mut payload: &[u8]) -> Result<Vec<RlpItem<'_>>, &'static str> {
    let mut items = Vec::new();
    while !payload.is_empty() {
        let (item, rest) = decode_rlp_item(payload)?;
        items.push(item);
        payload = rest;
    }
    Ok(items)
}

/// Converts a byte slice into a sequence of 4-bit nibbles (most significant first).
#[must_use]
pub fn bytes_to_nibbles(bytes: &[u8]) -> Vec<u8> {
    let mut nibbles = Vec::with_capacity(bytes.len() * 2);
    for &b in bytes {
        nibbles.push(b >> 4);
        nibbles.push(b & 0x0f);
    }
    nibbles
}

/// Decodes compact hex-prefix encoding:
/// Returns (nibbles, is_leaf).
pub fn decode_hex_prefix(compact: &[u8]) -> Result<(Vec<u8>, bool), &'static str> {
    if compact.is_empty() {
        return Err("Empty hex prefix");
    }
    let first = compact[0];
    let prefix = first >> 4;
    let is_leaf = prefix >= 2;
    let is_odd = (prefix % 2) != 0;

    let mut nibbles = Vec::new();
    if is_odd {
        nibbles.push(first & 0x0f);
    }
    for &b in &compact[1..] {
        nibbles.push(b >> 4);
        nibbles.push(b & 0x0f);
    }
    Ok((nibbles, is_leaf))
}

/// Verifies a standard Ethereum Merkle Patricia Trie proof.
///
/// # Arguments
/// - `expected_root`: The 32-byte MPT root hash.
/// - `key_hash`: The 32-byte keccak256 hash of the target path/address/slot.
/// - `proof_nodes`: Ordered or unordered list of raw RLP trie nodes.
///
/// Returns `Ok(Some(value_bytes))` if the key exists, `Ok(None)` for proof-of-non-existence,
/// or `Err(...)` if the proof path is invalid or corrupted.
pub fn verify_mpt_proof(
    expected_root: B256,
    key_hash: &[u8],
    proof_nodes: &[Vec<u8>],
) -> Result<Option<Vec<u8>>, &'static str> {
    if proof_nodes.is_empty() {
        return Err("Empty MPT proof nodes");
    }

    // Build hash -> node lookup table for fast traversal
    let mut node_map = std::collections::HashMap::new();
    for node in proof_nodes {
        let hash = alloy_primitives::keccak256(node);
        node_map.insert(hash, node.as_slice());
    }

    let full_nibbles = bytes_to_nibbles(key_hash);
    let mut nibble_idx = 0;
    let mut current_hash = expected_root;

    loop {
        let node_bytes = match node_map.get(&current_hash) {
            Some(&bytes) => bytes,
            None => {
                // If expected_root was short (<32 bytes) or embedded
                return Err("Node hash in proof chain not found in provided witness");
            }
        };

        let (root_item, remaining) = decode_rlp_item(node_bytes)?;
        if !remaining.is_empty() {
            return Err("Trailing bytes in MPT node RLP");
        }

        let list_payload = match root_item {
            RlpItem::List(payload) => payload,
            RlpItem::String(_) => return Err("MPT node must be an RLP list"),
        };

        let items = decode_rlp_list_items(list_payload)?;

        if items.len() == 17 {
            // ── Branch Node (16 branches + 1 optional value) ──
            if nibble_idx == full_nibbles.len() {
                // Leaf value at branch
                return match &items[16] {
                    RlpItem::String(val) if !val.is_empty() => Ok(Some(val.to_vec())),
                    _ => Ok(None),
                };
            }

            let next_nibble = full_nibbles[nibble_idx] as usize;
            nibble_idx += 1;

            match &items[next_nibble] {
                RlpItem::String(child_ref) if child_ref.len() == 32 => {
                    current_hash = B256::from_slice(child_ref);
                }
                RlpItem::String(child_ref) if child_ref.is_empty() => {
                    // Null branch -> Non-existence proof
                    return Ok(None);
                }
                RlpItem::List(inline_child) => {
                    // Inline child node
                    let inline_hash = alloy_primitives::keccak256(inline_child);
                    node_map.insert(inline_hash, *inline_child);
                    current_hash = inline_hash;
                }
                _ => return Err("Malformed child reference in branch node"),
            }
        } else if items.len() == 2 {
            // ── Leaf or Extension Node ──
            let compact_path = match &items[0] {
                RlpItem::String(p) => *p,
                _ => return Err("Path in 2-item node must be a string"),
            };

            let (path_nibbles, is_leaf) = decode_hex_prefix(compact_path)?;
            let rem_len = full_nibbles.len() - nibble_idx;

            if rem_len < path_nibbles.len() {
                // Path diverges -> non-existence proof
                return Ok(None);
            }

            if full_nibbles[nibble_idx..nibble_idx + path_nibbles.len()] != path_nibbles[..] {
                // Divergent path -> non-existence proof
                return Ok(None);
            }

            nibble_idx += path_nibbles.len();

            if is_leaf {
                if nibble_idx != full_nibbles.len() {
                    return Err("Leaf node reached before exhausting key nibbles");
                }
                return match &items[1] {
                    RlpItem::String(val) => Ok(Some(val.to_vec())),
                    _ => Err("Leaf node value must be string"),
                };
            } else {
                // Extension node -> traverse to child
                match &items[1] {
                    RlpItem::String(child_ref) if child_ref.len() == 32 => {
                        current_hash = B256::from_slice(child_ref);
                    }
                    RlpItem::List(inline_child) => {
                        let inline_hash = alloy_primitives::keccak256(inline_child);
                        node_map.insert(inline_hash, *inline_child);
                        current_hash = inline_hash;
                    }
                    _ => return Err("Malformed child reference in extension node"),
                }
            }
        } else {
            return Err("Invalid MPT node: list must have 2 or 17 elements");
        }
    }
}

/// Decodes the 4-tuple of an Ethereum account state: `[nonce, balance, storageRoot, codeHash]`.
pub fn decode_account_storage_root(account_rlp: &[u8]) -> Result<B256, &'static str> {
    let (item, rest) = decode_rlp_item(account_rlp)?;
    if !rest.is_empty() {
        return Err("Trailing bytes in account RLP");
    }
    let list_payload = match item {
        RlpItem::List(payload) => payload,
        _ => return Err("Account state must be an RLP list"),
    };
    let items = decode_rlp_list_items(list_payload)?;
    if items.len() < 4 {
        return Err("Account state requires 4 items: nonce, balance, storageRoot, codeHash");
    }
    match &items[2] {
        RlpItem::String(sr) if sr.len() == 32 => Ok(B256::from_slice(sr)),
        _ => Err("Invalid storageRoot in account state"),
    }
}

/// Verifies a 2-tier Ethereum `eth_getProof` (account proof + storage proof).
///
/// # Arguments
/// - `state_root`: Canonical foreign block header state root
/// - `contract_address`: The escrow / bridge smart contract address on the foreign chain
/// - `storage_key`: The storage slot commitment where deposit is inscribed
/// - `account_proof`: RLP trie nodes from state root to the contract account
/// - `storage_proof`: RLP trie nodes from contract `storageRoot` to the storage slot value
pub fn verify_account_and_storage_proof(
    state_root: B256,
    contract_address: &Address,
    storage_key: &B256,
    account_proof: &[Vec<u8>],
    storage_proof: &[Vec<u8>],
) -> Result<U256, &'static str> {
    // 1. Path for account trie = keccak256(contract_address)
    let account_path = alloy_primitives::keccak256(contract_address.as_slice());
    let account_rlp = verify_mpt_proof(state_root, account_path.as_slice(), account_proof)?
        .ok_or("Account not found in foreign state trie")?;

    // 2. Extract storageRoot from account state
    let storage_root = decode_account_storage_root(&account_rlp)?;

    // 3. Path for storage trie = keccak256(storage_key)
    let storage_path = alloy_primitives::keccak256(storage_key.as_slice());
    let storage_val_rlp = verify_mpt_proof(storage_root, storage_path.as_slice(), storage_proof)?
        .ok_or("Storage key not found in contract storage trie")?;

    // 4. Decode storage value to U256
    let raw = if let Ok((RlpItem::String(inner), rest)) = decode_rlp_item(&storage_val_rlp) {
        if rest.is_empty() { inner } else { &storage_val_rlp[..] }
    } else {
        &storage_val_rlp[..]
    };

    if raw.is_empty() {
        return Ok(U256::ZERO);
    }
    if raw.len() > 32 {
        return Err("Storage value exceeds 32 bytes");
    }
    let mut buf = [0u8; 32];
    buf[32 - raw.len()..].copy_from_slice(raw);
    Ok(U256::from_be_bytes(buf))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rlp_short_and_long_string_decode() {
        // "dog" -> 0x83 'd' 'o' 'g'
        let input = [0x83, b'd', b'o', b'g'];
        let (item, rest) = decode_rlp_item(&input).unwrap();
        assert_eq!(item, RlpItem::String(b"dog"));
        assert!(rest.is_empty());
    }

    #[test]
    fn test_hex_prefix_decode() {
        // Even extension: [0x00, 0x12, 0x34] -> nibbles [1, 2, 3, 4], is_leaf: false
        let ext = [0x00, 0x12, 0x34];
        let (nibbles, is_leaf) = decode_hex_prefix(&ext).unwrap();
        assert_eq!(nibbles, vec![1, 2, 3, 4]);
        assert!(!is_leaf);

        // Odd leaf: [0x31, 0x23] -> nibbles [1, 2, 3], is_leaf: true
        let leaf = [0x31, 0x23];
        let (nibbles, is_leaf) = decode_hex_prefix(&leaf).unwrap();
        assert_eq!(nibbles, vec![1, 2, 3]);
        assert!(is_leaf);
    }
}
