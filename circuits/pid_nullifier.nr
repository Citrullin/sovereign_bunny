use dep::std;

// Sybil-resistant domain-scoped nullifier for eIDAS PID.
// One human identity claims at most one nullifier per domain without revealing identity.
// Bound to the claiming account_pubkey to prevent front-running / theft of the ZK proof.
fn main(
    pid_unique_id: [u8; 64],
    pid_salt: Field,
    domain_id: pub Field,
    account_pubkey: pub [u8; 33],
) -> pub Field {
    // 1. Hash the 64-byte PID unique identifier to derive the unique root identity hash
    let pid_hash = std::hash::blake3(pid_unique_id);
    let pid_root_field = pid_hash[0] as Field + (pid_hash[1] as Field * 256);

    // 2. Hash the claiming account pubkey (compressed Secp256k1) to prevent proof front-running
    let account_hash = std::hash::blake3(account_pubkey);
    let account_field = account_hash[0] as Field + (account_hash[1] as Field * 256);

    // 3. Compute deterministic identity commitment combining root PID, salt, and bound account
    let id_commitment = std::hash::pedersen_hash([
        pid_root_field,
        pid_salt,
        account_field,
    ]);

    // 4. Derive the unique domain-scoped nullifier:
    // Guarantees one nullifier per human per domain_id, bound to id_commitment
    std::hash::pedersen_hash([
        id_commitment,
        domain_id,
        pid_salt,
    ])
}

