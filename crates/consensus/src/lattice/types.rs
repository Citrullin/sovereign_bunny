//! Discrete block-lattice payloads and block headers.

use alloy_primitives::{Address, B256, Bytes, U256};
use super::witness::StaticWitnessProof;

/// Discrete block-lattice payloads representing actions on an account chain.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum LatticePayload {
    /// Send transfer to recipient
    Send { recipient: Address, amount: U256 },
    /// Receive claim against an earlier send block hash
    Receive { send_block_hash: B256, amount: U256 },
    /// Asynchronous contract call intent
    ContractCall { target: Address, intent_id: B256, data: Bytes },
    /// Blind note commitment emission
    CommitNote { note: super::note::CommitNote },
    /// Blind note absorption via zero-knowledge nullifier proof
    AbsorbNote { absorb: super::note::AbsorbNote },
    /// Account Lease: locks account state with an intermediate root during in-flight send/bundle
    Lease { intermediate_root: B256, duration_epochs: u64 },
    /// Unlock account upon confirmation of receive or execution
    Unlock { unlock_commitment: B256 },
    /// Reclaim locked state if cross-account call timed out past expiry epoch
    Reclaim { intermediate_root: B256, expiry_epoch: u64 },
}

/// A block-lattice block representing a transaction on an individual account chain.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LatticeBlock {
    pub account: Address,
    pub previous_hash: B256,
    pub sequence: u64,
    pub payload: LatticePayload,
    pub signature: Vec<u8>,
    pub static_witnesses: Vec<StaticWitnessProof>,
}

/// Send Block Header representation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SendBlockHeader {
    pub recipient: Address,
    pub amount: U256,
    pub nonce: u64,
    pub blob_commitment: B256,
}

/// Receive Block Header representation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReceiveBlockHeader {
    pub send_block_hash: B256,
    pub verkle_witness_proof: Vec<u8>,
}

/// Reclaim Send representation for timed-out floating balances.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReclaimSend {
    pub send_block_hash: B256,
    pub signature: Vec<u8>,
}

impl scale::Encode for LatticePayload {
    fn encode_to<T: scale::Output + ?Sized>(&self, dest: &mut T) {
        match self {
            LatticePayload::Send { recipient, amount } => {
                0u8.encode_to(dest);
                recipient.0.encode_to(dest);
                amount.to_be_bytes::<32>().encode_to(dest);
            }
            LatticePayload::Receive { send_block_hash, amount } => {
                1u8.encode_to(dest);
                send_block_hash.0.encode_to(dest);
                amount.to_be_bytes::<32>().encode_to(dest);
            }
            LatticePayload::ContractCall { target, intent_id, data } => {
                2u8.encode_to(dest);
                target.0.encode_to(dest);
                intent_id.0.encode_to(dest);
                data.as_ref().encode_to(dest);
            }
            LatticePayload::CommitNote { note } => {
                3u8.encode_to(dest);
                note.target_account.0.encode_to(dest);
                note.note_commitment.commitment.0.encode_to(dest);
                note.note_commitment.encrypted_ciphertext.as_ref().encode_to(dest);
                note.note_commitment.ephemeral_pubkey.as_ref().encode_to(dest);
                note.note_commitment.gossip_topic.0.encode_to(dest);
                note.target_slot.encode_to(dest);
                note.note_commitment.manifold_id.encode_to(dest);
                note.note_commitment.issuance_epoch.encode_to(dest);
                note.note_commitment.relayer_fee_hint.encode_to(dest);
                note.note_commitment.did_registration_fee.encode_to(dest);
                note.note_commitment.view_tag.encode_to(dest);
                note.note_commitment.decay_epoch.encode_to(dest);
            }
            LatticePayload::AbsorbNote { absorb } => {
                4u8.encode_to(dest);
                absorb.nullifier.0.encode_to(dest);
                absorb.target_account.0.encode_to(dest);
                absorb.target_slot.encode_to(dest);
                absorb.epoch.encode_to(dest);
                absorb.zk_proof.as_ref().encode_to(dest);
                absorb.is_reclaim.encode_to(dest);
            }
            LatticePayload::Lease { intermediate_root, duration_epochs } => {
                5u8.encode_to(dest);
                intermediate_root.0.encode_to(dest);
                duration_epochs.encode_to(dest);
            }
            LatticePayload::Unlock { unlock_commitment } => {
                6u8.encode_to(dest);
                unlock_commitment.0.encode_to(dest);
            }
            LatticePayload::Reclaim { intermediate_root, expiry_epoch } => {
                7u8.encode_to(dest);
                intermediate_root.0.encode_to(dest);
                expiry_epoch.encode_to(dest);
            }
        }
    }
}

impl scale::Decode for LatticePayload {
    fn decode<I: scale::Input>(input: &mut I) -> Result<Self, scale::Error> {
        let ty = u8::decode(input)?;
        match ty {
            0 => {
                let recipient = Address::from(<[u8; 20]>::decode(input)?);
                let amount_bytes = <[u8; 32]>::decode(input)?;
                let amount = U256::from_be_bytes(amount_bytes);
                Ok(LatticePayload::Send { recipient, amount })
            }
            1 => {
                let send_block_hash = B256::from(<[u8; 32]>::decode(input)?);
                let amount_bytes = <[u8; 32]>::decode(input)?;
                let amount = U256::from_be_bytes(amount_bytes);
                Ok(LatticePayload::Receive { send_block_hash, amount })
            }
            2 => {
                let target = Address::from(<[u8; 20]>::decode(input)?);
                let intent_id = B256::from(<[u8; 32]>::decode(input)?);
                let data = Bytes::from(Vec::<u8>::decode(input)?);
                Ok(LatticePayload::ContractCall { target, intent_id, data })
            }
            3 => {
                let target_account = Address::from(<[u8; 20]>::decode(input)?);
                let commitment = B256::from(<[u8; 32]>::decode(input)?);
                let encrypted_ciphertext = Bytes::from(Vec::<u8>::decode(input)?);
                let ephemeral_pubkey = Bytes::from(Vec::<u8>::decode(input)?);
                let gossip_topic = B256::from(<[u8; 32]>::decode(input)?);
                let target_slot = u16::decode(input)?;
                let manifold_id = u64::decode(input)?;
                let issuance_epoch = u64::decode(input)?;
                let relayer_fee_hint = u64::decode(input)?;
                let did_registration_fee = u64::decode(input)?;
                let view_tag = u8::decode(input)?;
                let decay_epoch = u64::decode(input)?;
                Ok(LatticePayload::CommitNote {
                    note: super::note::CommitNote {
                        target_account,
                        note_commitment: super::note::NoteCommitment {
                            commitment,
                            encrypted_ciphertext,
                            ephemeral_pubkey,
                            gossip_topic,
                            manifold_id,
                            issuance_epoch,
                            relayer_fee_hint,
                            did_registration_fee,
                            view_tag,
                            decay_epoch,
                        },
                        target_slot,
                    },
                })
            }
            4 => {
                let nullifier = B256::from(<[u8; 32]>::decode(input)?);
                let target_account = Address::from(<[u8; 20]>::decode(input)?);
                let target_slot = u16::decode(input)?;
                let epoch = u64::decode(input)?;
                let zk_proof = Bytes::from(Vec::<u8>::decode(input)?);
                let is_reclaim = bool::decode(input)?;
                Ok(LatticePayload::AbsorbNote {
                    absorb: super::note::AbsorbNote {
                        nullifier,
                        zk_proof,
                        target_account,
                        target_slot,
                        epoch,
                        is_reclaim,
                    },
                })
            }
            5 => {
                let intermediate_root = B256::from(<[u8; 32]>::decode(input)?);
                let duration_epochs = u64::decode(input)?;
                Ok(LatticePayload::Lease { intermediate_root, duration_epochs })
            }
            6 => {
                let unlock_commitment = B256::from(<[u8; 32]>::decode(input)?);
                Ok(LatticePayload::Unlock { unlock_commitment })
            }
            7 => {
                let intermediate_root = B256::from(<[u8; 32]>::decode(input)?);
                let expiry_epoch = u64::decode(input)?;
                Ok(LatticePayload::Reclaim { intermediate_root, expiry_epoch })
            }
            _ => Err("Invalid LatticePayload variant".into()),
        }
    }
}

impl scale::Encode for LatticeBlock {
    fn encode_to<T: scale::Output + ?Sized>(&self, dest: &mut T) {
        self.account.0.encode_to(dest);
        self.previous_hash.0.encode_to(dest);
        self.sequence.encode_to(dest);
        self.payload.encode_to(dest);
        self.signature.encode_to(dest);
        self.static_witnesses.encode_to(dest);
    }
}

impl scale::Decode for LatticeBlock {
    fn decode<I: scale::Input>(input: &mut I) -> Result<Self, scale::Error> {
        let account = Address::from(<[u8; 20]>::decode(input)?);
        let previous_hash = B256::from(<[u8; 32]>::decode(input)?);
        let sequence = u64::decode(input)?;
        let payload = LatticePayload::decode(input)?;
        let signature = Vec::<u8>::decode(input)?;
        let static_witnesses = Vec::<StaticWitnessProof>::decode(input)?;
        Ok(LatticeBlock { account, previous_hash, sequence, payload, signature, static_witnesses })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use scale::{Decode, Encode};
    use alloy_primitives::{address, b256};
    use crate::lattice::note::{CommitNote, NoteCommitment, AbsorbNote};

    #[test]
    fn test_commit_note_roundtrip() {
        let note = CommitNote {
            target_account: address!("1111111111111111111111111111111111111111"),
            note_commitment: NoteCommitment {
                commitment: b256!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
                encrypted_ciphertext: Bytes::from(vec![1, 2, 3, 4, 5]),
                ephemeral_pubkey: Bytes::from(vec![6, 7, 8]),
                gossip_topic: b256!("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
                manifold_id: 1337,
                issuance_epoch: 42,
                relayer_fee_hint: 100,
                did_registration_fee: 50,
                view_tag: 0x7f,
                decay_epoch: 99,
            },
            target_slot: 2,
        };

        let payload = LatticePayload::CommitNote { note: note.clone() };
        let encoded = payload.encode();
        let decoded = LatticePayload::decode(&mut &encoded[..]).expect("decode must succeed");

        match decoded {
            LatticePayload::CommitNote { note: decoded_note } => {
                assert_eq!(decoded_note.target_account, note.target_account);
                assert_eq!(decoded_note.target_slot, note.target_slot);
                assert_eq!(decoded_note.note_commitment.commitment, note.note_commitment.commitment);
                assert_eq!(decoded_note.note_commitment.gossip_topic, note.note_commitment.gossip_topic);
                assert_eq!(decoded_note.note_commitment.manifold_id, note.note_commitment.manifold_id);
                assert_eq!(decoded_note.note_commitment.issuance_epoch, note.note_commitment.issuance_epoch);
                // The following checks verify fields were preserved and not lossy or fabricated
                assert_eq!(decoded_note.note_commitment.encrypted_ciphertext, note.note_commitment.encrypted_ciphertext);
                assert_eq!(decoded_note.note_commitment.ephemeral_pubkey, note.note_commitment.ephemeral_pubkey);
                assert_eq!(decoded_note.note_commitment.relayer_fee_hint, note.note_commitment.relayer_fee_hint);
                assert_eq!(decoded_note.note_commitment.did_registration_fee, note.note_commitment.did_registration_fee);
                assert_eq!(decoded_note.note_commitment.view_tag, note.note_commitment.view_tag);
                assert_eq!(decoded_note.note_commitment.decay_epoch, note.note_commitment.decay_epoch);
            }
            _ => panic!("Expected CommitNote variant"),
        }
    }

    #[test]
    fn test_absorb_note_roundtrip() {
        let absorb = AbsorbNote {
            nullifier: b256!("11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff"),
            zk_proof: Bytes::from(vec![9, 8, 7, 6]),
            target_account: address!("2222222222222222222222222222222222222222"),
            target_slot: 1,
            epoch: 123,
            is_reclaim: true,
        };

        let payload = LatticePayload::AbsorbNote { absorb: absorb.clone() };
        let encoded = payload.encode();
        let decoded = LatticePayload::decode(&mut &encoded[..]).expect("decode must succeed");

        match decoded {
            LatticePayload::AbsorbNote { absorb: decoded_absorb } => {
                assert_eq!(decoded_absorb.nullifier, absorb.nullifier);
                assert_eq!(decoded_absorb.zk_proof, absorb.zk_proof);
                assert_eq!(decoded_absorb.target_account, absorb.target_account);
                assert_eq!(decoded_absorb.target_slot, absorb.target_slot);
                assert_eq!(decoded_absorb.epoch, absorb.epoch);
                assert_eq!(decoded_absorb.is_reclaim, absorb.is_reclaim);
            }
            _ => panic!("Expected AbsorbNote variant"),
        }
    }

    #[test]
    fn test_absorb_note_strict_bool_rejects_invalid() {
        // Construct an AbsorbNote byte payload where the bool byte is non-canonical (e.g., 2)
        let mut corrupted = Vec::new();
        4u8.encode_to(&mut corrupted); // tag 4
        b256!("11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff").0.encode_to(&mut corrupted);
        address!("2222222222222222222222222222222222222222").0.encode_to(&mut corrupted);
        1u16.encode_to(&mut corrupted);
        123u64.encode_to(&mut corrupted);
        vec![9u8, 8, 7, 6].encode_to(&mut corrupted);
        corrupted.push(2); // Non-canonical boolean byte (must be 0 or 1)

        let result = LatticePayload::decode(&mut &corrupted[..]);
        assert!(result.is_err(), "Non-canonical bool must fail to decode");
    }

    #[test]
    fn test_lease_unlock_reclaim_roundtrip() {
        let intermediate_root = b256!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let lease_payload = LatticePayload::Lease {
            intermediate_root,
            duration_epochs: 10,
        };
        let encoded_lease = lease_payload.encode();
        let decoded_lease = LatticePayload::decode(&mut &encoded_lease[..]).expect("lease decode");
        match decoded_lease {
            LatticePayload::Lease { intermediate_root: r, duration_epochs: d } => {
                assert_eq!(r, intermediate_root);
                assert_eq!(d, 10);
            }
            _ => panic!("Expected Lease variant"),
        }

        let unlock_commitment = b256!("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        let unlock_payload = LatticePayload::Unlock { unlock_commitment };
        let encoded_unlock = unlock_payload.encode();
        let decoded_unlock = LatticePayload::decode(&mut &encoded_unlock[..]).expect("unlock decode");
        match decoded_unlock {
            LatticePayload::Unlock { unlock_commitment: c } => {
                assert_eq!(c, unlock_commitment);
            }
            _ => panic!("Expected Unlock variant"),
        }

        let reclaim_payload = LatticePayload::Reclaim {
            intermediate_root,
            expiry_epoch: 25,
        };
        let encoded_reclaim = reclaim_payload.encode();
        let decoded_reclaim = LatticePayload::decode(&mut &encoded_reclaim[..]).expect("reclaim decode");
        match decoded_reclaim {
            LatticePayload::Reclaim { intermediate_root: r, expiry_epoch: e } => {
                assert_eq!(r, intermediate_root);
                assert_eq!(e, 25);
            }
            _ => panic!("Expected Reclaim variant"),
        }
    }
}

