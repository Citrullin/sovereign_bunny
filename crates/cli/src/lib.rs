pub mod ctl;
pub mod k8s_backend;
pub mod daemons;
pub mod debug;
pub mod orchestration;
pub mod dif_transport;
pub mod genesis;
pub mod genesis_bundle;

use std::path::PathBuf;
use clap::{Parser, Subcommand};
use dif_transport::TransportKind;
use orchestration::ClusterBackend;

#[derive(Parser, Debug)]
#[command(name = "bunny", about = "Sovereign Bunny: Autonomous Bare-Silicon Cloud & Microservice Mesh")]
pub struct Cli {
    /// Active cluster context or backend (e.g. k8s, remote, localhost, baremetal)
    #[arg(long, global = true, env = "BUNNY_CONTEXT")]
    pub context: Option<String>,

    /// Kubernetes namespace (defaults to bunny-cluster)
    #[arg(short = 'n', long, global = true, default_value = "bunny-cluster", env = "BUNNY_NAMESPACE")]
    pub namespace: String,

    /// Direct Sovereign RPC or Gateway URL (e.g. http://localhost:8545 or http://127.0.0.1:8545)
    #[arg(long, global = true, env = "BUNNY_RPC_URL")]
    pub rpc_url: Option<String>,

    /// Explicit path to KUBECONFIG (defaults to ~/.kube/config)
    #[arg(long, global = true, env = "KUBECONFIG")]
    pub kubeconfig: Option<PathBuf>,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Display one or many resources (nodes, pods, vms, shards, acl, compliance, metrics)
    Get {
        #[command(subcommand)]
        resource: ctl::GetResourceCommands,
    },
    /// Inspect cluster status (Pods, ArgoCD application, live JSON-RPC ping)
    Status {
        #[arg(default_value = "bunny-cluster")]
        name: String,
        /// Run live JSON-RPC liveness probe
        #[arg(long, default_value_t = false)]
        verify: bool,
    },
    /// Stream or tail logs from a pod or daemon
    Logs(ctl::LogsArgs),
    /// Restart a cluster resource (e.g. statefulset/bunny-node or deployment)
    Restart {
        #[arg(default_value = "statefulset/bunny-node")]
        target: String,
    },
    /// Apply a Kubernetes or cluster manifest
    Apply {
        #[arg(short, long)]
        file: PathBuf,
    },
    /// Wait for all pods in the namespace to become ready
    Wait {
        #[arg(short, long, default_value_t = 60)]
        timeout: u64,
    },
    /// Clean up / recycle pods in the namespace
    Cleanup,
    /// Synchronize cluster state (argocd, remote, or gitea)
    Sync {
        #[command(subcommand)]
        sub: SyncCommands,
    },
    /// Run cluster tests (rpc, oidc)
    Test {
        #[command(subcommand)]
        sub: TestCommands,
    },
    /// Manage cluster configuration contexts
    Config {
        #[command(subcommand)]
        action: ctl::ConfigSubcommands,
    },
    /// Multi-key DID, SSZ wrapping, CAIP parsing, and cross-chain tickets (alias to `bunny ctl did`)
    Did {
        #[command(subcommand)]
        action: ctl::DidSubcommands,
    },
    /// Kubectl-style cluster introspection, OTel logs, and resource queries
    Ctl {
        #[command(subcommand)]
        sub: ctl::CtlCommands,
    },
    /// Create, export, validate, status, or run local multi-daemon cluster
    Cluster {
        #[command(subcommand)]
        sub: ClusterCommands,
    },
    /// Run an individual microservice daemon mode directly
    Daemon {
        #[command(subcommand)]
        sub: daemons::DaemonCommands,
    },
    /// Interactive terminal debugging, ABI introspection, and DID tools
    Debug {
        #[command(subcommand)]
        sub: debug::DebugCommands,
    },
    /// Deploy stateless Wasm/SGX actor runtime across local 400GbE nodes
    Deploy {
        #[arg(long)]
        cluster: String,

        #[arg(long, default_value_t = true)]
        dpu_offload: bool,

        #[arg(long, default_value_t = true)]
        wireguard_mesh: bool,
    },
    /// Mesh peering, dark-fiber negotiation, and proximity discovery (NFC / BLE / DIF / BGP)
    Mesh {
        #[command(subcommand)]
        sub: MeshCommands,
    },
    /// Koral patch signing and supply chain operations
    Patch {
        #[command(subcommand)]
        sub: PatchCommands,
    },
    /// Universal Relational Genesis DAG and Zanzibar permission compiler
    Genesis {
        #[command(subcommand)]
        sub: GenesisCommands,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum GenesisCommands {
    /// Compile a declarative graph specification (JSON/YAML) or multi-file bundle into deterministic genesis
    Compile {
        /// Path to input declarative graph specification file (single YAML/JSON)
        #[arg(short, long)]
        spec: Option<PathBuf>,
        /// Path to directory containing a multi-file genesis bundle (with genesis_bundle.yaml)
        #[arg(short, long)]
        bundle: Option<PathBuf>,
        /// Destination output path for compiled EVM genesis.json
        #[arg(short, long, default_value = "genesis.json")]
        output: PathBuf,
        /// Destination output path for compiled Consensus NetworkGenesisConfig JSON
        #[arg(long, default_value = "genesis_network.json")]
        network_output: PathBuf,
        /// Optional path to export generated genesis secret vouchers
        #[arg(long, default_value = "genesis_vouchers.json")]
        vouchers_output: Option<PathBuf>,
        /// Output directory when compiling a bundle (writes all bundle artifacts into this dir)
        #[arg(long)]
        output_dir: Option<PathBuf>,
    },
}


#[derive(Subcommand, Debug, Clone)]
pub enum SyncCommands {
    /// Trigger hard refresh on ArgoCD application
    Argocd {
        #[arg(default_value = "sovereign-bunny-cluster")]
        app: String,
    },
    /// Rsync workspace to remote host
    Remote {
        #[arg(long, env = "BUNNY_REMOTE_HOST", default_value = "root@127.0.0.1")]
        remote_host: String,
        #[arg(long, env = "BUNNY_REMOTE_DIR", default_value = "~/sovereign-reth")]
        remote_dir: String,
    },
    /// Commit and push manifests to Gitea repo
    Gitea {
        #[arg(long, env = "BUNNY_GITEA_HUB_DIR", default_value = "k3s-hub")]
        hub_dir: PathBuf,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum TestCommands {
    /// Test inter-node P2P RPC calls directly across cluster nodes
    Rpc {
        #[arg(long, default_value_t = 5)]
        nodes: usize,
    },
    /// Test SIWE OIDC integration and identity verification on remote host
    Oidc {
        #[arg(long, env = "BUNNY_REMOTE_HOST", default_value = "root@127.0.0.1")]
        remote_host: String,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum ClusterCommands {
    /// Setup, provision, and bootstrap a primitive cluster (localhost, k3s, podman, baremetal)
    Init {
        #[arg(default_value = "primitive-cluster")]
        name: String,
        #[arg(long, default_value = "k3s")]
        backend: String,
        #[arg(long, default_value_t = 65001)]
        bgp_asn: u32,
        #[arg(long, default_value = "./deploy/cluster")]
        out_dir: PathBuf,
        #[arg(long, default_value_t = false)]
        start: bool,
    },
    /// Create a new cluster descriptor
    Create {
        name: String,
        #[arg(long, default_value = "localhost")]
        backend: String,
        #[arg(long, default_value_t = 65001)]
        bgp_asn: u32,
        #[arg(long, use_value_delimiter = true)]
        ips: Vec<String>,
        #[arg(long, default_value_t = true)]
        dpu_offload: bool,
        #[arg(long, default_value_t = true)]
        wireguard_mesh: bool,
        #[arg(long)]
        out_dir: Option<PathBuf>,
    },
    /// Run the entire microservice mesh locally on single machine
    Run {
        #[arg(long, default_value = "local-dev")]
        name: String,
        #[arg(long, default_value = "localhost")]
        backend: String,
        #[arg(long, default_value_t = 65001)]
        bgp_asn: u32,
        #[arg(short, long, default_value_t = false)]
        debug: bool,
        #[arg(long, default_value_t = false)]
        toy_mode: bool,
    },
    /// Export all manifests, systemd unit files, and WireGuard mesh configurations to disk
    Export {
        name: String,
        #[arg(long, default_value = "baremetal")]
        backend: String,
        #[arg(long, default_value_t = 65001)]
        bgp_asn: u32,
        #[arg(long, use_value_delimiter = true)]
        ips: Vec<String>,
        #[arg(long, default_value_t = true)]
        dpu_offload: bool,
        #[arg(long, default_value_t = true)]
        wireguard_mesh: bool,
        #[arg(long, default_value = "./deploy/cluster-out")]
        out_dir: PathBuf,
    },
    /// Validate cluster specification topology and parameters
    Validate {
        name: String,
        #[arg(long, default_value = "localhost")]
        backend: String,
        #[arg(long, default_value_t = 65001)]
        bgp_asn: u32,
        #[arg(long, use_value_delimiter = true)]
        ips: Vec<String>,
    },
    /// Inspect status of a cluster (K8s pods, ArgoCD sync, RPC endpoint)
    Status {
        #[arg(default_value = "bunny-cluster")]
        name: String,
        /// Also run RPC live liveness probe and verification
        #[arg(long, default_value_t = false)]
        verify: bool,
    },
    /// Test inter-node P2P RPC calls directly across cluster nodes
    TestRpc {
        #[arg(long, default_value = "bunny-cluster")]
        namespace: String,
        #[arg(long, default_value_t = 5)]
        nodes: usize,
    },
    /// Generate a customized cluster deployment manifest with custom domain and replica count
    GenerateManifest {
        /// Base ingress domain (e.g. mgmt.local, cluster.local, mydomain.com)
        #[arg(short, long, default_value = "mgmt.local")]
        domain: String,
        /// Number of bunny-node replicas
        #[arg(short, long, default_value_t = 10)]
        replicas: usize,
        /// Destination output path
        #[arg(short, long, default_value = "scripts/bunny_cluster_manifest.yaml")]
        output: PathBuf,
    },
    /// Deploy cluster manifests to a remote host via SSH/k3s
    DeployRemote {
        #[arg(long, env = "BUNNY_REMOTE_HOST", default_value = "root@127.0.0.1")]
        remote_host: String,
        #[arg(long, default_value = "scripts/bunny_cluster_manifest.yaml")]
        manifest: PathBuf,
    },
    /// Check cluster status and pods on a remote host via SSH/k3s
    StatusRemote {
        #[arg(long, env = "BUNNY_REMOTE_HOST", default_value = "root@127.0.0.1")]
        remote_host: String,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum MeshCommands {
    /// Peer operations
    Peer {
        #[command(subcommand)]
        action: PeerCommands,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum PeerCommands {
    /// Peer check status reporting
    Check,
    /// Proximity or BGP peer discovery
    Discover {
        #[arg(long, value_enum, default_value_t = TransportKind::Nfc)]
        transport: TransportKind,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum PatchCommands {
    /// Package and sign a patch bundle
    Package {
        #[command(subcommand)]
        sub: PackageCommands,
    },
    /// Verify and apply signed patch bundle
    Apply {
        bundle_path: String,
        #[arg(long, default_value = "prod-cluster")]
        target: String,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum PackageCommands {
    /// Sign a patch against a base image
    Sign {
        #[arg(long)]
        input: String,
        #[arg(long)]
        base_image: String,
        #[arg(long, default_value_t = true)]
        sigstore_keyless: bool,
        #[arg(long)]
        out: String,
    },
}

pub fn parse_backend(backend: &str) -> ClusterBackend {
    match backend.to_lowercase().as_str() {
        "localhost" | "local" => ClusterBackend::Localhost,
        "lxc" | "lxd" => ClusterBackend::Lxc,
        "podman" => ClusterBackend::Podman,
        "k8s" => ClusterBackend::K8s,
        "k3s" => ClusterBackend::K3s,
        "baremetal" | "ips" => ClusterBackend::Baremetal,
        _ => ClusterBackend::Localhost,
    }
}
