#!/usr/bin/env python3
import os
import sys

DEST = "/home/citrullin/git/bunny-hive"

def write(rel_path, content):
    p = os.path.join(DEST, rel_path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Wrote {p}")

# 1. Cargo.toml
write("Cargo.toml", """[package]
name = "bunny-hive"
version = "0.1.0"
edition = "2021"
authors = ["Sovereign Bunny Contributors"]
description = "Institutional Layer and Scene-Graph Resolver for Graphs of Graphs"
license = "Apache-2.0"

[dependencies]
blake3 = "1.5"
sha2 = "0.10"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

[dev-dependencies]
""")

# 2. README.md
write("README.md", """# Sovereign Bunny Hive

### The Institutional Layer & Scene-Graph Resolver for Graphs of Graphs
*Part of the Sovereign Bunny ecosystem (see `docs/booklet/bunny-hive.tex`).*

## Overview
Bunny Hive introduces **zero new ledger primitives**. Everything is expressed through:
- **Slot 0**: W3C Identity
- **Slot 1**: Google Zanzibar ReBAC relationship tuples
- **Slot 2**: Aztec-style Blind Notes & nullifiers
- **Slot 4**: Proof of SQL relational commitments
- **Slot 6**: Governance accumulators & MeritRank tallies

## Four Scene-Graph Techniques
1. **Double-buffered reconciliation**: Pure transition functions over Virtual CAR tree.
2. **Subgraph culling (PVS)**: 256-bit conservative Bloom frustum bitmask (`[u64; 4]`).
3. **Structural sharing**: Memoized subtree skipping with 4-tuple cache keys: `(observer_r1, target_r1, seed_set_digest, params_digest)`.
4. **Cooperative two-lane scheduler**: Urgent sub-10ms lane vs 10s background epoch lane sliced by counted work.
""")

# 3. src/types.rs
write("src/types.rs", """use serde::{Deserialize, Serialize};

pub type Root = [u8; 32];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProofOfRelationship {
    pub path: Vec<String>,
    pub relation: String,
    pub authority_digest: Root,
    pub epoch: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Resolution {
    Culled,
    NoPath,
    Proven(ProofOfRelationship),
}

#[derive(Debug, Clone)]
pub struct ActorView {
    pub did: String,
    pub car_roots: [Root; 64],
    pub public_namespaces: crate::frustum::Frustum,
    pub frustum: crate::frustum::Frustum,
    pub relationships: Vec<(String, String, String)>, // (subject, relation, object)
}

#[derive(Debug, Clone)]
pub struct EpochCtx {
    pub epoch: u64,
    pub seed_set_digest: Root,
    pub params_digest: Root,
}
""")

# 4. src/frustum.rs
write("src/frustum.rs", """use serde::{Deserialize, Serialize};

/// 256-bit conservative visibility mask over followed DAO namespaces.
/// Soundness condition: Bloom-style superset (zero false negatives).
/// Privacy invariant: computed locally by observer and NEVER published.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Frustum {
    pub mask: [u64; 4],
}

impl Default for Frustum {
    fn default() -> Self {
        Self::new()
    }
}

impl Frustum {
    pub const fn new() -> Self {
        Self { mask: [0; 4] }
    }

    pub fn from_namespaces(namespaces: &[&str]) -> Self {
        let mut f = Self::new();
        for ns in namespaces {
            f.add_namespace(ns);
        }
        f
    }

    pub fn add_namespace(&mut self, ns: &str) {
        let hash = blake3::hash(ns.as_bytes());
        let bytes = hash.as_bytes();
        // Set two independent bits across 256 bits
        let bit1 = ((bytes[0] as usize) | ((bytes[1] as usize) << 8)) % 256;
        let bit2 = ((bytes[2] as usize) | ((bytes[3] as usize) << 8)) % 256;

        self.set_bit(bit1);
        self.set_bit(bit2);
    }

    #[inline]
    fn set_bit(&mut self, bit: usize) {
        let idx = bit / 64;
        let offset = bit % 64;
        self.mask[idx] |= 1u64 << offset;
    }

    /// Fast bitwise check for potential visibility overlap.
    /// If false, the subgraphs are provably disjoint and traversal can be culled.
    #[inline]
    pub fn intersects(&self, other: &Frustum) -> bool {
        (self.mask[0] & other.mask[0]) != 0
            || (self.mask[1] & other.mask[1]) != 0
            || (self.mask[2] & other.mask[2]) != 0
            || (self.mask[3] & other.mask[3]) != 0
    }
}
""")

# 5. src/memo.rs
write("src/memo.rs", """use crate::types::Root;
use std::collections::{HashMap, VecDeque};

/// Complete 4-tuple statement key for memoized structural sharing.
/// Must include observer_r1 so revocation immediately invalidates cache.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MemoKey {
    pub observer_r1: Root,
    pub target_r1: Root,
    pub seed_set_digest: Root,
    pub params_digest: Root,
}

pub struct BoundedLru<K, V> {
    capacity: usize,
    map: HashMap<K, V>,
    order: VecDeque<K>,
}

impl<K: Clone + Eq + std::hash::Hash, V: Clone> BoundedLru<K, V> {
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0);
        Self {
            capacity,
            map: HashMap::with_capacity(capacity),
            order: VecDeque::with_capacity(capacity),
        }
    }

    pub fn get(&mut self, key: &K) -> Option<&V> {
        if self.map.contains_key(key) {
            // Move to back of order
            self.order.retain(|k| k != key);
            self.order.push_back(key.clone());
            self.map.get(key)
        } else {
            None
        }
    }

    pub fn put(&mut self, key: K, val: V) {
        if self.map.contains_key(&key) {
            self.order.retain(|k| k != &key);
            self.order.push_back(key.clone());
            self.map.insert(key, val);
            return;
        }

        if self.map.len() >= self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }

        self.order.push_back(key.clone());
        self.map.insert(key, val);
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}
""")

# 6. src/scheduler.rs
write("src/scheduler.rs", """/// Deterministic cooperative two-lane scheduler.
/// Slices background work by counted work units (iterations/edges visited)
/// to ensure bit-for-bit identical checkpoints regardless of CPU clock frequency.
pub struct TwoLaneScheduler {
    pub max_work_units_per_slice: usize,
    pub current_work_units: usize,
}

impl TwoLaneScheduler {
    pub fn new(max_work_units_per_slice: usize) -> Self {
        Self {
            max_work_units_per_slice,
            current_work_units: 0,
        }
    }

    /// Increments counted work. Returns true if slice deadline reached and task should yield.
    pub fn step(&mut self, units: usize) -> bool {
        self.current_work_units += units;
        if self.current_work_units >= self.max_work_units_per_slice {
            self.current_work_units = 0;
            true
        } else {
            false
        }
    }
}
""")

# 7. src/reputation.rs
write("src/reputation.rs", """use std::collections::HashMap;

/// 18-decimal fixed-point scale for deterministic Sybil attenuation.
pub const FIXED_SCALE: u128 = 1_000_000_000_000_000_000;

#[derive(Debug, Clone)]
pub struct ReputationEngine {
    pub scores: HashMap<String, u128>,
    pub seed_counts: HashMap<String, usize>,
}

impl ReputationEngine {
    pub fn new() -> Self {
        Self {
            scores: HashMap::new(),
            seed_counts: HashMap::new(),
        }
    }

    pub fn set_score(&mut self, actor: &str, raw_score: u128, connected_seeds: usize) {
        self.scores.insert(actor.to_string(), raw_score);
        self.seed_counts.insert(actor.to_string(), connected_seeds);
    }

    /// Single-seed diversity attenuation (bunny-hive.tex Section 6).
    /// If a participant's score depends on only 1 seed (connected_seeds == 1),
    /// attenuate their reputation by 10% per iteration to prevent single-hub capture.
    pub fn apply_diversity_attenuation(&mut self) {
        for (actor, score) in self.scores.iter_mut() {
            let seeds = self.seed_counts.get(actor).copied().unwrap_or(0);
            if seeds == 1 {
                // 10% penalty: score * 90 / 100
                *score = (*score * 90) / 100;
            }
        }
    }

    /// Computes rank mass concentration behind top-k seeds for epoch telemetry.
    pub fn compute_top_k_concentration(&self, k: usize) -> u128 {
        let mut sorted_scores: Vec<u128> = self.scores.values().copied().collect();
        sorted_scores.sort_unstable_by(|a, b| b.cmp(a));

        let top_sum: u128 = sorted_scores.iter().take(k).sum();
        let total_sum: u128 = sorted_scores.iter().sum();

        if total_sum == 0 {
            0
        } else {
            (top_sum * FIXED_SCALE) / total_sum
        }
    }
}
""")

# 8. src/resolver.rs
write("src/resolver.rs", """use crate::memo::{BoundedLru, MemoKey};
use crate::types::{ActorView, EpochCtx, ProofOfRelationship, Resolution};

pub struct HiveResolver {
    pub cache: BoundedLru<MemoKey, ProofOfRelationship>,
}

impl HiveResolver {
    pub fn new(cache_capacity: usize) -> Self {
        Self {
            cache: BoundedLru::new(cache_capacity),
        }
    }

    /// Semantic-preserving 3-technique resolution (bunny-hive.tex Listing 2)
    pub fn resolve(&mut self, obs: &ActorView, tgt: &ActorView, ctx: &EpochCtx) -> Resolution {
        // 1. Frustum Culling: discard provably unshared DAO subgraphs (zero false negatives)
        if !obs.frustum.intersects(&tgt.public_namespaces) {
            return Resolution::Culled;
        }

        // 2. Structural Sharing: Memoization on complete 4-tuple statement
        let key = MemoKey {
            observer_r1: obs.car_roots[1],
            target_r1: tgt.car_roots[1],
            seed_set_digest: ctx.seed_set_digest,
            params_digest: ctx.params_digest,
        };

        if let Some(proof) = self.cache.get(&key) {
            return Resolution::Proven(proof.clone());
        }

        // 3. Evaluate graph walk
        match self.walk_zanzibar(obs, tgt, ctx) {
            Some(proof) => {
                self.cache.put(key, proof.clone());
                Resolution::Proven(proof)
            }
            None => Resolution::NoPath,
        }
    }

    fn walk_zanzibar(&self, obs: &ActorView, tgt: &ActorView, ctx: &EpochCtx) -> Option<ProofOfRelationship> {
        // Search relationships for path between obs and tgt
        for (subj, rel, obj) in &obs.relationships {
            if subj == &obs.did && (obj == &tgt.did || obj == "canonical_dao_anchor") {
                let digest = blake3::hash(format!("{}:{}:{}", subj, rel, obj).as_bytes());
                return Some(ProofOfRelationship {
                    path: vec![subj.clone(), rel.clone(), obj.clone()],
                    relation: rel.clone(),
                    authority_digest: *digest.as_bytes(),
                    epoch: ctx.epoch,
                });
            }
        }
        None
    }
}

/// Naive full-walk oracle without culling or memoization.
/// Used as ground-truth oracle for differential conformance tests.
pub fn naive_full_walk_oracle(obs: &ActorView, tgt: &ActorView, ctx: &EpochCtx) -> Resolution {
    for (subj, rel, obj) in &obs.relationships {
        if subj == &obs.did && (obj == &tgt.did || obj == "canonical_dao_anchor") {
            let digest = blake3::hash(format!("{}:{}:{}", subj, rel, obj).as_bytes());
            return Resolution::Proven(ProofOfRelationship {
                path: vec![subj.clone(), rel.clone(), obj.clone()],
                relation: rel.clone(),
                authority_digest: *digest.as_bytes(),
                epoch: ctx.epoch,
            });
        }
    }
    Resolution::NoPath
}
""")

# 9. src/lib.rs
write("src/lib.rs", """//! Sovereign Bunny Hive: Institutional Layer and Scene-Graph Resolver
//! Implements multi-seed reputation, Google Zanzibar ReBAC resolution,
//! frustum culling, structural sharing, and counted-work scheduling.

pub mod frustum;
pub mod memo;
pub mod reputation;
pub mod resolver;
pub mod scheduler;
pub mod types;

pub use frustum::Frustum;
pub use memo::{BoundedLru, MemoKey};
pub use reputation::{ReputationEngine, FIXED_SCALE};
pub use resolver::{naive_full_walk_oracle, HiveResolver};
pub use scheduler::TwoLaneScheduler;
pub use types::{ActorView, EpochCtx, ProofOfRelationship, Resolution, Root};
""")

# 10. tests/conformance.rs
write("tests/conformance.rs", """use bunny_hive::{
    naive_full_walk_oracle, ActorView, EpochCtx, Frustum, HiveResolver, ReputationEngine,
    Resolution, Root, TwoLaneScheduler, FIXED_SCALE,
};

fn mock_actor(did: &str, namespaces: &[&str], rels: Vec<(&str, &str, &str)>) -> ActorView {
    let mut roots: [Root; 64] = [[0u8; 32]; 64];
    // Hash DID into slot 0 and slot 1
    roots[0] = *blake3::hash(format!("{}:slot0", did).as_bytes()).as_bytes();
    roots[1] = *blake3::hash(format!("{}:slot1", did).as_bytes()).as_bytes();

    let f = Frustum::from_namespaces(namespaces);
    ActorView {
        did: did.to_string(),
        car_roots: roots,
        public_namespaces: f,
        frustum: f,
        relationships: rels
            .into_iter()
            .map(|(s, r, o)| (s.to_string(), r.to_string(), o.to_string()))
            .collect(),
    }
}

fn mock_ctx(epoch: u64) -> EpochCtx {
    EpochCtx {
        epoch,
        seed_set_digest: [1u8; 32],
        params_digest: [2u8; 32],
    }
}

#[test]
fn test_differential_conformance_zero_false_negatives() {
    let mut resolver = HiveResolver::new(100);
    let ctx = mock_ctx(1);

    // Observer and Target share "berlin_dao" namespace
    let obs = mock_actor(
        "did:rad:alice",
        &["berlin_dao", "tinyblock_mesh"],
        vec![("did:rad:alice", "member_of", "canonical_dao_anchor")],
    );
    let tgt = mock_actor("did:rad:bob", &["berlin_dao"], vec![]);

    let optimized = resolver.resolve(&obs, &tgt, &ctx);
    let naive = naive_full_walk_oracle(&obs, &tgt, &ctx);

    match (&optimized, &naive) {
        (Resolution::Proven(p1), Resolution::Proven(p2)) => {
            assert_eq!(p1.relation, p2.relation);
            assert_eq!(p1.authority_digest, p2.authority_digest);
        }
        _ => panic!("Expected both to prove relationship"),
    }
}

#[test]
fn test_frustum_culling_soundness() {
    let mut resolver = HiveResolver::new(100);
    let ctx = mock_ctx(1);

    // Completely disjoint namespaces
    let obs = mock_actor("did:rad:alice", &["berlin_dao"], vec![]);
    let tgt = mock_actor("did:rad:charlie", &["tokyo_dao"], vec![]);

    let res = resolver.resolve(&obs, &tgt, &ctx);
    assert_eq!(res, Resolution::Culled);
}

#[test]
fn test_memoization_and_revocation_invalidation() {
    let mut resolver = HiveResolver::new(100);
    let ctx = mock_ctx(1);

    let mut obs = mock_actor(
        "did:rad:alice",
        &["shared_namespace"],
        vec![("did:rad:alice", "admin_role", "did:rad:bob")],
    );
    let tgt = mock_actor("did:rad:bob", &["shared_namespace"], vec![]);

    // 1. Initial resolution (cache miss -> Proven)
    let res1 = resolver.resolve(&obs, &tgt, &ctx);
    assert!(matches!(res1, Resolution::Proven(_)));
    assert_eq!(resolver.cache.len(), 1);

    // 2. Second resolution (cache hit)
    let res2 = resolver.resolve(&obs, &tgt, &ctx);
    assert_eq!(res1, res2);

    // 3. Revocation: Observer's Slot 1 root mutates
    obs.car_roots[1] = [0x99u8; 32];
    obs.relationships.clear(); // Role revoked

    // 4. Must invalidate cache and return NoPath (not stale cached proof!)
    let res3 = resolver.resolve(&obs, &tgt, &ctx);
    assert_eq!(res3, Resolution::NoPath);
}

#[test]
fn test_reputation_diversity_attenuation() {
    let mut rep = ReputationEngine::new();
    let initial_score = 100 * FIXED_SCALE;

    // Node A has multi-seed diversity (3 seeds)
    rep.set_score("node_diverse", initial_score, 3);
    // Node B is attached to a single hub (1 seed)
    rep.set_score("node_single_hub", initial_score, 1);

    rep.apply_diversity_attenuation();

    assert_eq!(rep.scores["node_diverse"], initial_score);
    // Single hub node attenuated by 10%
    assert_eq!(rep.scores["node_single_hub"], 90 * FIXED_SCALE);
}

#[test]
fn test_two_lane_counted_work_determinism() {
    let mut sched1 = TwoLaneScheduler::new(50);
    let mut sched2 = TwoLaneScheduler::new(50);

    // Node 1 executes in batches of 10
    let mut yields1 = 0;
    for _ in 0..10 {
        if sched1.step(10) {
            yields1 += 1;
        }
    }

    // Node 2 executes in batches of 25 (faster CPU)
    let mut yields2 = 0;
    for _ in 0..4 {
        if sched2.step(25) {
            yields2 += 1;
        }
    }

    // Both must yield exactly twice over 100 work units
    assert_eq!(yields1, 2);
    assert_eq!(yields2, 2);
}
""")

print("Successfully generated bunny-hive crate files!")
