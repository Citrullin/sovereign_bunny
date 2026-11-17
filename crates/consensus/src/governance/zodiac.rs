//! # Zodiac Safe Roles & Module Guard Integration
//!
//! Provides reverse-engineered Zodiac Roles Modifier compatibility and module guards
//! mapping cleanly onto Zanzibar ReBAC relation tuples in Slot 1.

use alloy_primitives::{Address, B256, Bytes};
use serde::{Deserialize, Serialize};

/// Action type dispatched through a Zodiac module or Safe guard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ZodiacModuleAction {
    /// Safe execution call (target contract, value, calldata, operation)
    ExecTransactionFromModule {
        to: Address,
        value: alloy_primitives::U256,
        data: Bytes,
        operation: u8,
    },
    /// Role assignment / membership modification
    AssignRole {
        role_id: u16,
        member: Address,
    },
    /// Scope / permission grant on target function
    ScopeFunction {
        role_id: u16,
        target_contract: Address,
        function_sig: [u8; 4],
        is_scoped: bool,
    },
}

/// A Zodiac guard instance verifying that transactions conform to Zanzibar permissions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ZodiacGuard {
    /// Associated Safe avatar address
    pub avatar: Address,
    /// Associated module address
    pub module: Address,
    /// Model hash of the active OpenFGA / Zanzibar model in Slot 1
    pub model_hash: B256,
}

impl ZodiacGuard {
    /// Creates a new ZodiacGuard instance.
    #[must_use]
    pub fn new(avatar: Address, module: Address, model_hash: B256) -> Self {
        Self {
            avatar,
            module,
            model_hash,
        }
    }

    /// Verifies if the caller has permission in Zanzibar to execute the Zodiac action.
    #[must_use]
    pub fn check_action(
        &self,
        zanzibar: &super::zanzibar::ZanzibarGraphEngine,
        caller: Address,
        action: &ZodiacModuleAction,
    ) -> bool {
        match action {
            ZodiacModuleAction::ExecTransactionFromModule { to, .. } => {
                let to_b256 = B256::from_slice(&[to.as_slice(), &[0u8; 12]].concat());
                zanzibar.check_named("zodiac_roles", to_b256, "can_call_function", caller, 5)
            }
            ZodiacModuleAction::AssignRole { role_id, .. } => {
                let mut role_b256 = [0u8; 32];
                role_b256[0..2].copy_from_slice(&role_id.to_le_bytes());
                zanzibar.check_named("role", B256::from(role_b256), "manager", caller, 5)
            }
            ZodiacModuleAction::ScopeFunction { .. } => {
                let avatar_b256 = B256::from_slice(&[self.avatar.as_slice(), &[0u8; 12]].concat());
                zanzibar.check_named("dao", avatar_b256, "owner", caller, 5)
            }
        }
    }
}
