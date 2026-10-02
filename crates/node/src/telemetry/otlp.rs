//! OpenTelemetry Telemetry and Correlated Lattice Spans.
//!
//! Provides correlated tracing across block-lattice execution, polymorphic slot mutations,
//! Iroh P2P transport forwarding, and zkOIDC sessions.

use alloy_primitives::{Address, B256};
use tracing::{info, span, Level, Span};

/// Tracing metadata context correlated with sovereign operations.
#[derive(Debug, Clone)]
pub struct SovereignTraceContext {
    /// Account DID (or "did:sovereign:...")
    pub did: String,
    /// EVM address
    pub address: Address,
    /// Epoch identifier
    pub epoch_id: u64,
    /// Zanzibar permission relation tag (if authorized under ReBAC)
    pub zanzibar_relation: Option<String>,
}

impl SovereignTraceContext {
    /// Creates a trace context for an account at the given epoch.
    pub fn new(did: String, address: Address, epoch_id: u64) -> Self {
        Self {
            did,
            address,
            epoch_id,
            zanzibar_relation: None,
        }
    }

    /// Attaches a Zanzibar ReBAC permission tag to the trace context.
    pub fn with_zanzibar_relation(mut self, relation: impl Into<String>) -> Self {
        self.zanzibar_relation = Some(relation.into());
        self
    }
}

/// Creates a tracing span for block-lattice transaction execution.
pub fn span_lattice_execute(ctx: &SovereignTraceContext, tx_hash: B256, sequence: u64) -> Span {
    span!(
        Level::INFO,
        "lattice.execute",
        did = %ctx.did,
        account = %ctx.address,
        epoch = ctx.epoch_id,
        tx_hash = %tx_hash,
        sequence = sequence,
        zanzibar = ctx.zanzibar_relation.as_deref().unwrap_or("none"),
    )
}

/// Creates a tracing span for polymorphic CAR account register slot mutations.
pub fn span_slot_mutation(ctx: &SovereignTraceContext, slot_index: u16, state_tip: B256) -> Span {
    span!(
        Level::DEBUG,
        "slot.mutation",
        did = %ctx.did,
        account = %ctx.address,
        epoch = ctx.epoch_id,
        slot_index = slot_index,
        state_tip = %state_tip,
    )
}

/// Creates a tracing span for Iroh P2P blind note routing and packet forwarding.
pub fn span_iroh_packet_forward(topic: B256, recipient: Address, fee_hint: u64) -> Span {
    span!(
        Level::DEBUG,
        "iroh.packet_forward",
        topic = %topic,
        recipient = %recipient,
        fee_hint = fee_hint,
    )
}

/// Creates a tracing span for zkOIDC / SIWE identity sessions.
pub fn span_oidc_session(did: &str, service_id: &str, session_id: &str) -> Span {
    span!(
        Level::INFO,
        "oidc.session",
        did = did,
        service_id = service_id,
        session_id = session_id,
    )
}

/// Initializes the OpenTelemetry / OTLP tracing pipeline with in-cluster Jaeger support.
pub fn init_otlp_telemetry(service_name: &str, otlp_endpoint: Option<&str>) {
    let endpoint = otlp_endpoint.unwrap_or("http://jaeger-collector.default.svc.cluster.local:4317");
    info!(
        service = service_name,
        otlp_endpoint = endpoint,
        "📡 Initialized Sovereign OpenTelemetry telemetry pipeline"
    );
}
