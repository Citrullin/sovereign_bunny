//! Decentralized Data Availability & Replication Ticket Protocol.
//!
//! Handles storage provider escrow tickets and periodic Bao slice challenge-response
//! audits for Proof of Retrievability (PoR).

use alloy_primitives::{Address, B256, U256};
use sovereign_consensus::storage::BaoSliceProof;
use std::collections::HashMap;

/// Lifecycle state of a replication ticket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TicketStatus {
    /// Ticket is active and currently being audited.
    Active,
    /// Storage provider failed consecutive PoR audits and was penalized.
    Slashed,
    /// Successfully served lease duration and escrow released.
    Settled,
}

/// An escrow replication ticket proving continuous storage of a blob CID.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReplicationTicket {
    /// Unique ticket identifier
    pub ticket_id: B256,
    /// Content identifier (BLAKE3 hash string) being stored
    pub blob_cid: String,
    /// Storage provider address
    pub provider: Address,
    /// Client who paid the escrow
    pub client: Address,
    /// Escrow balance in native TBL wei
    pub escrow_amount: U256,
    /// Total blob size in bytes
    pub blob_size: u64,
    /// Epoch height when the ticket was created
    pub start_epoch: u64,
    /// Epoch height when the ticket expires
    pub end_epoch: u64,
    /// Number of successful random PoR slice challenges passed
    pub successful_audits: u64,
    /// Number of failed PoR slice challenges
    pub failed_audits: u64,
    /// Current ticket status
    pub status: TicketStatus,
}

impl ReplicationTicket {
    /// Creates a new active replication ticket.
    pub fn new(
        ticket_id: B256,
        blob_cid: String,
        provider: Address,
        client: Address,
        escrow_amount: U256,
        blob_size: u64,
        start_epoch: u64,
        end_epoch: u64,
    ) -> Self {
        Self {
            ticket_id,
            blob_cid,
            provider,
            client,
            escrow_amount,
            blob_size,
            start_epoch,
            end_epoch,
            successful_audits: 0,
            failed_audits: 0,
            status: TicketStatus::Active,
        }
    }

    /// Evaluates a submitted Bao slice proof against this ticket's target blob and challenge parameters.
    pub fn verify_por_audit(
        &mut self,
        proof: &BaoSliceProof,
        expected_root: [u8; 32],
    ) -> Result<bool, &'static str> {
        if self.status != TicketStatus::Active {
            return Err("Ticket is not active");
        }

        if proof.root_hash != expected_root {
            self.failed_audits += 1;
            if self.failed_audits >= 3 {
                self.status = TicketStatus::Slashed;
            }
            return Ok(false);
        }

        // Verify the Bao proof cryptographically using sovereign_consensus PoR verification
        let is_valid = sovereign_consensus::storage::IrohStorageEngine::verify_por_proof(proof)
            .unwrap_or(false);

        if is_valid {
            self.successful_audits += 1;
            Ok(true)
        } else {
            self.failed_audits += 1;
            if self.failed_audits >= 3 {
                self.status = TicketStatus::Slashed;
            }
            Ok(false)
        }
    }
}

/// Registry managing active replication tickets and audits.
#[derive(Default, Clone)]
pub struct ReplicationTicketManager {
    tickets: HashMap<B256, ReplicationTicket>,
}

impl ReplicationTicketManager {
    /// Creates a new ticket manager.
    pub fn new() -> Self {
        Self {
            tickets: HashMap::new(),
        }
    }

    /// Registers a new replication ticket.
    pub fn register_ticket(&mut self, ticket: ReplicationTicket) {
        self.tickets.insert(ticket.ticket_id, ticket);
    }

    /// Gets a reference to a ticket.
    pub fn get_ticket(&self, ticket_id: &B256) -> Option<&ReplicationTicket> {
        self.tickets.get(ticket_id)
    }

    /// Gets a mutable reference to a ticket.
    pub fn get_ticket_mut(&mut self, ticket_id: &B256) -> Option<&mut ReplicationTicket> {
        self.tickets.get_mut(ticket_id)
    }
}
