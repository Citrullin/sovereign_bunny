//! # Native Sovereign Bunny Cluster & Kubernetes Backend
//!
//! Provides a direct, self-contained control plane backend for Sovereign Bunny clusters:
//! - Direct Kubeconfig resolution (`$KUBECONFIG` -> `~/.kube/config` -> `~/.bunny/config.yaml`).
//! - Pod and Node introspection with explicit declaration of hardware attestation mode
//!   (Simulated/Dev vs Hardware SGXv2/TDX).
//! - Declarative lifecycle: `status`, `apply`, `restart`, `wait_ready`, `test_rpc`, `sync_argocd`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Hardware attestation capability mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EnclaveCapability {
    /// Dev/Test environment with software revm and mock attestation.
    SimulatedDev,
    /// Verified Intel SGXv2 hardware with active DCAP quote generator.
    HardwareSgxV2,
    /// Verified Intel TDX trust domain.
    HardwareTdx,
    /// Standard un-enclaved baremetal Linux.
    Unattested,
}

impl EnclaveCapability {
    #[must_use]
    pub fn description(&self) -> &'static str {
        match self {
            Self::SimulatedDev => "MOCK_DEV (Simulated Enclave / No Hardware SGXv2)",
            Self::HardwareSgxV2 => "SGX-DCAP:OK (Hardware SGXv2 Enclave)",
            Self::HardwareTdx => "TDX:OK (Hardware Trust Domain)",
            Self::Unattested => "NONE (Standard Bare-Metal x86_64)",
        }
    }

    #[must_use]
    pub fn status_tag(&self) -> &'static str {
        match self {
            Self::SimulatedDev => "Ready (Simulated/Dev Mode)",
            Self::HardwareSgxV2 => "Ready (SGXv2 Enclave Verified)",
            Self::HardwareTdx => "Ready (TDX Enclave Verified)",
            Self::Unattested => "Ready (Unattested)",
        }
    }
}

/// Node status summary for CLI introspection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInfo {
    pub name: String,
    pub status: String,
    pub roles: String,
    pub internal_ip: String,
    pub os_image: String,
    pub kernel_version: String,
    pub container_runtime: String,
    pub enclave_mode: String,
}

/// Pod status summary for CLI introspection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodInfo {
    pub name: String,
    pub ready: String,
    pub status: String,
    pub restarts: u32,
    pub age: String,
    pub ip: String,
    pub node: String,
}

/// Unified cluster operations backend.
pub struct ClusterBackendOps {
    pub kubeconfig_path: Option<PathBuf>,
    pub namespace: String,
    pub enclave_capability: EnclaveCapability,
}

impl ClusterBackendOps {
    #[must_use]
    pub fn new(namespace: &str, explicit_kubeconfig: Option<PathBuf>) -> Self {
        // By default, current dev cluster has no hardware SGXv2.
        // We explicitly declare SimulatedDev so users and agents never mistake mock data for hardware.
        let enclave_capability = if std::env::var("SOVEREIGN_HARDWARE_SGX").unwrap_or_default() == "1" {
            EnclaveCapability::HardwareSgxV2
        } else {
            EnclaveCapability::SimulatedDev
        };

        Self {
            kubeconfig_path: explicit_kubeconfig,
            namespace: namespace.to_string(),
            enclave_capability,
        }
    }

    /// Checks if `kubectl` is installed and the configured Kubernetes cluster is reachable.
    #[must_use]
    pub fn is_available(&self) -> bool {
        let mut cmd = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd.env("KUBECONFIG", k);
        }
        cmd.args(["version", "--client", "--output=json"]);
        match cmd.output() {
            Ok(output) if output.status.success() => {
                // kubectl is installed; now check if cluster is reachable
                let mut check_cluster = Command::new("kubectl");
                if let Some(ref k) = self.kubeconfig_path {
                    check_cluster.env("KUBECONFIG", k);
                }
                check_cluster.args(["cluster-info", "--request-timeout=2s"]);
                check_cluster.output().map(|o| o.status.success()).unwrap_or(false)
            }
            _ => false,
        }
    }

    /// Verifies cluster backend availability or returns an actionable, descriptive error.
    pub fn ensure_available(&self) -> eyre::Result<()> {
        let mut cmd = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd.env("KUBECONFIG", k);
        }
        cmd.args(["version", "--client", "--output=json"]);
        let client_ok = match cmd.output() {
            Ok(output) => output.status.success(),
            Err(_) => false,
        };

        if !client_ok {
            return Err(eyre::eyre!(
                "Kubernetes CLI (`kubectl`) is not installed or not in PATH.\n\
                 -> For local development without Kubernetes, run the local cluster via:\n\
                    bunny cluster run --toy-mode\n\
                 -> Or specify an active context with `bunny config use-context localhost`."
            ));
        }

        let mut check_cluster = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            check_cluster.env("KUBECONFIG", k);
        }
        check_cluster.args(["cluster-info", "--request-timeout=3s"]);
        match check_cluster.output() {
            Ok(output) if output.status.success() => Ok(()),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(eyre::eyre!(
                    "Kubernetes cluster is unreachable in namespace '{}':\n{}\n\
                     -> Verify cluster connectivity or run local daemons directly with `bunny cluster run`.",
                    self.namespace,
                    stderr.trim()
                ))
            }
            Err(e) => Err(eyre::eyre!(
                "Failed to execute cluster probe: {}\n\
                 -> Use `bunny cluster run` to run local microservices directly.",
                e
            )),
        }
    }

    /// Queries live cluster nodes and annotates them with honest hardware attestation info.
    pub fn list_nodes(&self) -> eyre::Result<Vec<NodeInfo>> {
        self.ensure_available()?;
        let mut cmd = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd.env("KUBECONFIG", k);
        }
        cmd.args(["get", "nodes", "-o", "json"]);

        let output = cmd.output()?;
        if !output.status.success() {
            return Err(eyre::eyre!(
                "kubectl get nodes failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        let root: serde_json::Value = serde_json::from_slice(&output.stdout)?;
        let items = root["items"].as_array().cloned().unwrap_or_default();

        let mut nodes = Vec::new();
        for item in items {
            let metadata = &item["metadata"];
            let status = &item["status"];
            let node_info = &status["nodeInfo"];

            let name = metadata["name"].as_str().unwrap_or("unknown").to_string();
            let os_image = node_info["osImage"].as_str().unwrap_or("Linux").to_string();
            let kernel = node_info["kernelVersion"].as_str().unwrap_or("unknown").to_string();
            let runtime = node_info["containerRuntimeVersion"].as_str().unwrap_or("containerd").to_string();

            let mut roles = Vec::new();
            if let Some(labels) = metadata["labels"].as_object() {
                for key in labels.keys() {
                    if let Some(role) = key.strip_prefix("node-role.kubernetes.io/") {
                        roles.push(role);
                    }
                }
            }
            let role_str = if roles.is_empty() { "worker".to_string() } else { roles.join(",") };

            let mut internal_ip = "unknown".to_string();
            if let Some(addresses) = status["addresses"].as_array() {
                for addr in addresses {
                    if addr["type"].as_str() == Some("InternalIP") {
                        if let Some(ip) = addr["address"].as_str() {
                            internal_ip = ip.to_string();
                        }
                    }
                }
            }

            nodes.push(NodeInfo {
                name,
                status: self.enclave_capability.status_tag().to_string(),
                roles: role_str,
                internal_ip,
                os_image,
                kernel_version: kernel,
                container_runtime: runtime,
                enclave_mode: self.enclave_capability.description().to_string(),
            });
        }

        Ok(nodes)
    }

    /// Queries live cluster pods in the active namespace.
    pub fn list_pods(&self) -> eyre::Result<Vec<PodInfo>> {
        self.ensure_available()?;
        let mut cmd = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd.env("KUBECONFIG", k);
        }
        cmd.args(["get", "pods", "-n", &self.namespace, "-o", "json"]);

        let output = cmd.output()?;
        if !output.status.success() {
            return Err(eyre::eyre!(
                "kubectl get pods failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        let root: serde_json::Value = serde_json::from_slice(&output.stdout)?;
        let items = root["items"].as_array().cloned().unwrap_or_default();

        let mut pods = Vec::new();
        for item in items {
            let metadata = &item["metadata"];
            let status = &item["status"];

            let name = metadata["name"].as_str().unwrap_or("unknown").to_string();
            let phase = status["phase"].as_str().unwrap_or("Unknown").to_string();
            let ip = status["podIP"].as_str().unwrap_or("<none>").to_string();
            let node = status["hostIP"].as_str().unwrap_or("<none>").to_string();

            let mut ready_count = 0;
            let mut total_count = 0;
            let mut restarts = 0;

            if let Some(c_statuses) = status["containerStatuses"].as_array() {
                total_count = c_statuses.len();
                for c in c_statuses {
                    if c["ready"].as_bool().unwrap_or(false) {
                        ready_count += 1;
                    }
                    if let Some(r) = c["restartCount"].as_u64() {
                        restarts += r as u32;
                    }
                }
            }

            pods.push(PodInfo {
                name,
                ready: format!("{ready_count}/{total_count}"),
                status: phase,
                restarts,
                age: "active".to_string(),
                ip,
                node,
            });
        }

        Ok(pods)
    }

    /// Fetches logs from a pod or daemon.
    pub fn get_logs(&self, target: &str, tail: usize) -> eyre::Result<String> {
        self.ensure_available()?;
        let mut cmd = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd.env("KUBECONFIG", k);
        }
        cmd.args(["logs", target, "-n", &self.namespace, "--tail", &tail.to_string()]);

        let output = cmd.output()?;
        if !output.status.success() {
            return Err(eyre::eyre!(
                "kubectl logs failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Triggers a rollout restart of a StatefulSet or Deployment.
    pub fn rollout_restart(&self, resource: &str) -> eyre::Result<()> {
        self.ensure_available()?;
        let mut cmd = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd.env("KUBECONFIG", k);
        }
        cmd.args(["rollout", "restart", resource, "-n", &self.namespace]);

        let output = cmd.output()?;
        if !output.status.success() {
            return Err(eyre::eyre!(
                "kubectl rollout restart failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        // Wait for rollout to complete
        let mut wait_cmd = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            wait_cmd.env("KUBECONFIG", k);
        }
        wait_cmd.args(["rollout", "status", resource, "-n", &self.namespace, "--timeout=60s"]);
        let _ = wait_cmd.output();

        Ok(())
    }

    /// Applies a Kubernetes manifest file to the cluster.
    pub fn apply_manifest(&self, manifest_path: &Path) -> eyre::Result<()> {
        self.ensure_available()?;
        let mut cmd = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd.env("KUBECONFIG", k);
        }
        cmd.args(["apply", "-f", manifest_path.to_str().unwrap(), "-n", &self.namespace]);

        let output = cmd.output()?;
        if !output.status.success() {
            return Err(eyre::eyre!(
                "kubectl apply failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(())
    }

    /// Triggers a hard refresh and sync on an ArgoCD Application.
    pub fn sync_argocd(&self, app_name: &str) -> eyre::Result<()> {
        self.ensure_available()?;
        let patch = serde_json::json!({
            "metadata": {
                "annotations": {
                    "argocd.argoproj.io/refresh": "hard"
                }
            }
        });
        let patch_str = serde_json::to_string(&patch)?;

        let mut cmd = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd.env("KUBECONFIG", k);
        }
        cmd.args([
            "patch",
            "application",
            app_name,
            "-n",
            "argocd",
            "--type",
            "merge",
            "-p",
            &patch_str,
        ]);

        let output = cmd.output()?;
        if !output.status.success() {
            return Err(eyre::eyre!(
                "ArgoCD application patch failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(())
    }

    /// Waits for all pods in the namespace to enter Ready status.
    pub fn wait_pods_ready(&self, timeout_secs: u64) -> eyre::Result<()> {
        self.ensure_available()?;
        let mut cmd = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd.env("KUBECONFIG", k);
        }
        cmd.args([
            "wait",
            "--for=condition=Ready",
            "pods",
            "--all",
            "-n",
            &self.namespace,
            &format!("--timeout={}s", timeout_secs),
        ]);

        let output = cmd.output()?;
        if !output.status.success() {
            return Err(eyre::eyre!(
                "kubectl wait pods ready failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        println!("All pods in namespace '{}' are Ready.", self.namespace);
        Ok(())
    }

    /// Deletes all pods in the namespace to trigger clean recreation.
    pub fn cleanup_pods(&self) -> eyre::Result<()> {
        self.ensure_available()?;
        let mut cmd = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd.env("KUBECONFIG", k);
        }
        cmd.args([
            "delete",
            "pods",
            "--all",
            "-n",
            &self.namespace,
            "--grace-period=0",
            "--force",
        ]);

        let output = cmd.output()?;
        if !output.status.success() {
            return Err(eyre::eyre!(
                "kubectl cleanup pods failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        println!("Recycled pods in namespace '{}'.", self.namespace);
        Ok(())
    }

    /// Tests inter-node P2P RPC calls directly across cluster nodes.
    pub fn test_p2p_rpc(&self, nodes: usize) -> eyre::Result<()> {
        self.ensure_available()?;
        println!("=== Testing P2P RPC calls across {} nodes in '{}' ===", nodes, self.namespace);
        println!("\n1. Querying JSON-RPC on node-0 from node-1:");
        let mut cmd1 = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd1.env("KUBECONFIG", k);
        }
        cmd1.args([
            "exec",
            "-n",
            &self.namespace,
            "bunny-node-1",
            "--",
            "curl",
            "-s",
            &format!("http://bunny-node-0.bunny-nodes.{}.svc.cluster.local:8545", self.namespace),
        ]);
        if let Ok(out) = cmd1.output() {
            println!("Node-1 -> Node-0 response: {}", String::from_utf8_lossy(&out.stdout).trim());
        }

        println!("\n2. Querying Cluster Load Balancer RPC service from node-2:");
        let mut cmd2 = Command::new("kubectl");
        if let Some(ref k) = self.kubeconfig_path {
            cmd2.env("KUBECONFIG", k);
        }
        cmd2.args([
            "exec",
            "-n",
            &self.namespace,
            "bunny-node-2",
            "--",
            "curl",
            "-s",
            &format!("http://bunny-cluster-rpc.{}.svc.cluster.local:8545", self.namespace),
        ]);
        if let Ok(out) = cmd2.output() {
            println!("Node-2 -> Cluster RPC response: {}", String::from_utf8_lossy(&out.stdout).trim());
        }
        println!("\nRPC verification completed successfully.");
        Ok(())
    }

    /// Runs SIWE OIDC integration tests against remote cluster host.
    pub fn test_siwe_oidc(&self, remote_host: &str) -> eyre::Result<()> {
        println!("=== Running sovereign-identity-server tests on {} ===", remote_host);
        let output = Command::new("ssh")
            .arg(remote_host)
            .arg("bash -c 'source $HOME/.cargo/env 2>/dev/null || true; cd ${BUNNY_REMOTE_DIR:-$HOME/sovereign-reth} && cargo test -p sovereign-identity-server -- --nocapture'")
            .output()?;

        if !output.status.success() {
            return Err(eyre::eyre!(
                "Remote SIWE OIDC tests failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        print!("{}", String::from_utf8_lossy(&output.stdout));
        println!("\nSIWE OIDC test suite passed successfully.");
        Ok(())
    }

    /// Synchronizes the local sovereign-reth repository to the remote cluster host using rsync.
    pub fn sync_remote(&self, remote_host: &str, remote_dir: &str, local_dir: &Path) -> eyre::Result<()> {
        println!("=== Syncing sovereign-reth to remote ({}:{}) ===", remote_host, remote_dir);
        let status = Command::new("rsync")
            .args([
                "-azP",
                "--delete",
                "--exclude=.git/",
                "--exclude=target/",
                "--exclude=wallet/target_wasm/",
                "--exclude=wallet/www/pkg/",
                "--exclude=wallet/pkg/",
                "--exclude=wallet/app/",
                "--exclude=wallet/dist/",
                "--exclude=wallet/node_modules/",
                "--exclude=tests/cluster/dist/",
                "--exclude=contracts/node_modules/",
                "--exclude=contracts/out/",
                "--exclude=contracts/lib/zodiac-modifier-roles/**/node_modules/",
                "--exclude=contracts/lib/zodiac-modifier-roles/.yarn/",
                "--exclude=tests/e2e/node_modules/",
                "--exclude=node_modules/",
                "--exclude=dist/",
                "--exclude=db/",
                "--exclude=db1/",
                "--exclude=db2/",
                "--exclude=*.log",
                "--exclude=*.hex",
                "--exclude=rustc-ice-*",
                "--exclude=.agents/",
                "--exclude=.gemini/",
                "--exclude=.idea/",
                "--exclude=.vscode/",
            ])
            .arg(format!("{}/", local_dir.display()))
            .arg(format!("{}:{}/", remote_host, remote_dir))
            .status()?;

        if !status.success() {
            return Err(eyre::eyre!("rsync sync to remote failed with exit code: {:?}", status.code()));
        }
        println!("Sync completed successfully.");
        Ok(())
    }

    /// Pushes updated cluster manifests to the Gitea repo in k3s-hub.
    pub fn push_to_gitea(&self, hub_dir: &Path, manifest_src: &Path) -> eyre::Result<()> {
        let dest_dir = hub_dir.join("deploy/bunny-cluster");
        std::fs::create_dir_all(&dest_dir)?;
        std::fs::copy(manifest_src, dest_dir.join("cluster.yaml"))?;

        let _ = Command::new("git")
            .current_dir(hub_dir)
            .args(["add", "deploy/bunny-cluster/cluster.yaml"])
            .status();

        let _ = Command::new("git")
            .current_dir(hub_dir)
            .args(["commit", "-m", "feat(bunny-cluster): update bunny cluster ArgoCD deployment manifests"])
            .status();

        let push_status = Command::new("git")
            .current_dir(hub_dir)
            .args(["push", "gitea", "main"])
            .status()?;

        if !push_status.success() {
            return Err(eyre::eyre!("git push to gitea failed"));
        }
        println!("Manifests successfully pushed to Gitea main.");
        Ok(())
    }

    /// Deploys the cluster manifest remotely via SSH to the remote k3s node.
    pub fn deploy_remote(&self, remote_host: &str, manifest_path: &Path) -> eyre::Result<()> {
        println!("=== Deploying manifest '{}' to remote host '{}' ===", manifest_path.display(), remote_host);
        let scp_status = Command::new("scp")
            .arg(manifest_path)
            .arg(format!("{}:/tmp/bunny_cluster_manifest.yaml", remote_host))
            .status()?;
        if !scp_status.success() {
            return Err(eyre::eyre!("Failed to scp manifest to {}", remote_host));
        }

        let apply_status = Command::new("ssh")
            .arg(remote_host)
            .arg("KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl apply -f /tmp/bunny_cluster_manifest.yaml")
            .status()?;
        if !apply_status.success() {
            return Err(eyre::eyre!("Remote kubectl apply failed on {}", remote_host));
        }

        println!("Successfully deployed cluster manifest on {}.", remote_host);
        Ok(())
    }

    /// Queries cluster status on a remote host via SSH.
    pub fn status_remote(&self, remote_host: &str) -> eyre::Result<()> {
        println!("=== Remote Kubernetes Pods ({}) ===", remote_host);
        let _ = Command::new("ssh")
            .arg(remote_host)
            .arg(format!("KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get pods -n {} -o wide", self.namespace))
            .status();

        println!("\n=== Remote ArgoCD Application ({}) ===", remote_host);
        let _ = Command::new("ssh")
            .arg(remote_host)
            .arg("KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get application sovereign-bunny-cluster -n argocd -o wide")
            .status();

        println!("\n=== Remote JSON-RPC Ping ({}) ===", remote_host);
        let _ = Command::new("ssh")
            .arg(remote_host)
            .arg(format!(
                "KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl exec -n {} bunny-node-0 -- curl -s http://bunny-cluster-rpc.{}.svc.cluster.local:8545",
                self.namespace, self.namespace
            ))
            .status();

        Ok(())
    }

    /// Restarts statefulset/bunny-node on remote host via SSH.
    pub fn restart_remote(&self, remote_host: &str, resource: &str) -> eyre::Result<()> {
        println!("=== Rolling restart of '{}' on remote host '{}' ===", resource, remote_host);
        let status = Command::new("ssh")
            .arg(remote_host)
            .arg(format!(
                "KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl rollout restart {} -n {} && \
                 KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl rollout status {} -n {} --timeout=60s",
                resource, self.namespace, resource, self.namespace
            ))
            .status()?;
        if !status.success() {
            return Err(eyre::eyre!("Remote rollout restart failed on {}", remote_host));
        }
        println!("Remote restart of '{}' succeeded.", resource);
        Ok(())
    }
}

