use dep::std;

// Proves valid Falcon-512 signature over a blind note commitment off-chain.
// Public inputs go on-ledger; the 690B signature stays private on device.
fn main(
    // Private: Falcon detached signature and public key
    falcon_signature: [u8; 690],
    falcon_pubkey: [u8; 897],
    // Public: what the ledger sees and verifies
    note_commitment: pub Field,
    account_pubkey_hash: pub Field,
    epoch: pub u64,
) {
    let computed_hash = std::hash::blake3(falcon_pubkey);
    assert(computed_hash == account_pubkey_hash);

    let valid = std::verify_signature(falcon_pubkey, note_commitment, falcon_signature);
    assert(valid == true);
}
