//! Storage replication and audit protocols.

pub mod replication_ticket;

pub use replication_ticket::{ReplicationTicket, ReplicationTicketManager, TicketStatus};
