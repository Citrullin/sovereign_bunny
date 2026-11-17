//! Physical Layer & Peering Module
//! Handles `WireGuard` interfaces, single-key derivation, and cross-manifold gossip.

#![warn(missing_docs)]
#![warn(clippy::all, clippy::pedantic)]

/// Key derivation and Zero-KMS handshake module.
pub mod handshake;
pub mod wireguard;
pub mod das;
pub mod xroad;
/// Address Interest Signaling Swarm and Guarded Bus module.
pub mod signal_swarm;
/// Iroh P2P mesh and blind note routing.
pub mod iroh;
/// Decentralized storage replication and Proof of Retrievability tickets.
pub mod storage;

pub use signal_swarm::{CompressedCuckooFilter, GuardedBus, SignalTopicSwarm};
pub use iroh::{IrohEndpoint, PeerInfo, blind_note_transport::{BlindNoteMessage, BlindNoteRouter}};
pub use storage::{ReplicationTicket, ReplicationTicketManager, TicketStatus};
