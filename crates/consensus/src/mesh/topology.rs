//! # Physical Cluster Network Topology & Peering
//!
//! Provides network topology configuration and peering mode abstractions for physical clusters,
//! supporting direct IX/data-center fiber, ISP transit, and mixed overlay topologies.

use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

/// Peering connection mode between cluster nodes and manifold validators.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PeeringMode {
    /// Public internet transit via ISP routes (BGP Anycast / WireGuard tunnels)
    Isp,
    /// Direct Layer-2 / cross-connect datacenter peering (DPDK/AF_XDP kernel bypass)
    Direct,
    /// Mixed multi-homed topology: prefer Direct peering with fallback to ISP transit
    Mixed,
}

impl Default for PeeringMode {
    fn default() -> Self {
        Self::Mixed
    }
}

/// Topology configuration for a physical cluster node or validator instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClusterTopologyConfig {
    /// Autonomous System Number (ASN) assigned to this cluster node
    pub asn: u32,
    /// Active peering connection mode
    pub peering_mode: PeeringMode,
    /// Primary direct peering physical interface or socket address
    pub direct_endpoint: Option<SocketAddr>,
    /// WireGuard / public ISP transit overlay address
    pub overlay_endpoint: SocketAddr,
    /// Maximum link MTU (e.g. 9000 for jumbo frames on Direct peering, 1420 for WireGuard)
    pub link_mtu: u16,
    /// Whether kernel-bypass DPDK/AF_XDP offload is enabled
    pub kernel_bypass_enabled: bool,
}

impl Default for ClusterTopologyConfig {
    fn default() -> Self {
        Self {
            asn: 65001,
            peering_mode: PeeringMode::Mixed,
            direct_endpoint: None,
            overlay_endpoint: "127.0.0.1:51820".parse().unwrap(),
            link_mtu: 1420,
            kernel_bypass_enabled: false,
        }
    }
}
