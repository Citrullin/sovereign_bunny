use dep::std;

// Confidential Unit Voting Circuit (Phase 1 Remediation)
// Proves valid voter membership in an epoch SMT, derives a deterministic nullifier
// to prevent double-voting, binds public proposal_id, and commits to confidential vote_choice.
// Eliminates off-chain DKG/E3 economic voting committees.

fn main(
    // Private Inputs:
    voter_secret_key: Field,
    vote_blinding: Field,
    smt_leaf_index: u64,
    smt_siblings: [Field; 32],
    vote_choice: Field, // 0 = Against / Nay, 1 = In Favor / Yay

    // Public Inputs:
    proposal_id: pub Field,
    proposal_scope: pub Field,
    voter_registration_smt_root: pub Field,
    derived_nullifier: pub Field,
    vote_commitment: pub Field,
    public_vote_weight: pub Field,
) {
    // 1. Constrain vote_choice to binary unit value {0, 1}
    assert((vote_choice == 0) | (vote_choice == 1));

    // 2. Derive voter identity commitment from secret key
    let voter_id_commitment = std::hash::pedersen_hash([voter_secret_key]);

    // 3. Verify membership of voter_id_commitment in the voter_registration_smt_root
    let computed_root = std::merkle::compute_merkle_root(voter_id_commitment, smt_leaf_index, smt_siblings);
    assert(computed_root == voter_registration_smt_root);

    // 4. Derive deterministic, un-linkable nullifier for this (voter, proposal_id, proposal_scope)
    // Ensures a voter can only cast exactly one vote per proposal
    let computed_nullifier = std::hash::pedersen_hash([
        voter_secret_key,
        proposal_id,
        proposal_scope,
    ]);
    assert(computed_nullifier == derived_nullifier);

    // 5. Constrain confidential vote commitment to Pedersen(vote_choice, vote_blinding)
    let computed_vote_commitment = std::hash::pedersen_hash([
        vote_choice,
        vote_blinding,
    ]);
    assert(computed_vote_commitment == vote_commitment);

    // 6. Constrain public_vote_weight to exactly 1 (strictly unit-weighted confidential voting)
    assert(public_vote_weight == 1);
}

