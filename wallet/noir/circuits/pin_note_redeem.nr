// Sovereign Model 3: PIN-Based Nullifier Derivation Circuit
//
// Allows an off-the-shelf NFC card/tag storing a public (or ephemeral) note commitment
// and salt to be redeemed exclusively by the party that knows the secret PIN.
// The raw PIN and pin_hash never leave the local prover (client-side Noir / WASM).
//
// Invariant:
// nullifier = Poseidon(pin_hash, note_id, salt)
//
// The contract / system router verifies that the nullifier has not been spent
// in the NullifierSmt accumulator, preventing double-redemption.

use dep::std::hash::poseidon;

fn main(
    pin_hash: Field,    // poseidon(PIN) — private secret
    note_id: Field,     // public note commitment ID
    salt: Field,        // public salt stored on physical tag
) -> pub Field {        // public output nullifier
    poseidon::bn254::hash_3([pin_hash, note_id, salt])
}
