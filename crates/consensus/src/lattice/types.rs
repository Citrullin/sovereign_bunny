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
                note.note_commitment.gossip_topic.0.encode_to(dest);
                note.target_slot.encode_to(dest);
                note.note_commitment.manifold_id.encode_to(dest);
                note.note_commitment.issuance_epoch.encode_to(dest);
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
                let gossip_topic = B256::from(<[u8; 32]>::decode(input)?);
                let target_slot = u16::decode(input)?;
                let manifold_id = u64::decode(input)?;
                let issuance_epoch = u64::decode(input)?;
                Ok(LatticePayload::CommitNote {
                    note: super::note::CommitNote {
                        target_account,
                        note_commitment: super::note::NoteCommitment {
                            commitment,
                            encrypted_ciphertext: Bytes::new(),
                            ephemeral_pubkey: Bytes::new(),
                            gossip_topic,
                            manifold_id,
                            issuance_epoch,
                            relayer_fee_hint: 0,
                            did_registration_fee: 0,
                            view_tag: 0,
                            decay_epoch: issuance_epoch.saturating_add(10),
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
                let is_reclaim = bool::decode(input).unwrap_or(false);
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
