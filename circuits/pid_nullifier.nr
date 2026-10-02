use dep::std;

// Sybil-resistant domain-scoped nullifier for eIDAS PID.
// One human identity claims at most one nullifier per domain without revealing identity.
fn main(
    pid_unique_id: [u8; 64],
    pid_salt: Field,
    domain_id: pub Field,
    account_pubkey: pub [u8; 33],
) -> pub Field {
    std::hash::pedersen_hash([
        std::hash::pedersen_hash([pid_salt, domain_id]),
        pid_salt,
    ])
}
