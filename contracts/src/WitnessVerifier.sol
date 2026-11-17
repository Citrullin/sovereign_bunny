// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title WitnessVerifier
/// @notice Implements O(1) Pairing check on BN254 curve (alt_bn128) in Solidity
contract WitnessVerifier {
    // BN254 field prime p
    uint256 constant P = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Canonical G2 generator point coordinates [x_a, x_b, y_a, y_b] (SRS G2)
    uint256[4] internal _srsG2;
    // Canonical trusted state root point on G2 [x_a, x_b, y_a, y_b]
    uint256[4] internal _trustedStateRootG2;
    // Flag indicating whether SRS and trusted roots have been anchored
    bool internal _rootsConfigured;

    event SrsG2Updated(uint256[4] srsG2);
    event TrustedStateRootUpdated(uint256[4] rootG2);

    constructor() {}

    /// @notice Returns the anchored SRS G2 point.
    function getSrsG2() public view returns (uint256[4] memory) {
        return _srsG2;
    }

    /// @notice Returns the anchored trusted state root on G2.
    function getTrustedStateRootG2() public view returns (uint256[4] memory) {
        return _trustedStateRootG2;
    }

    /// @notice Configures the canonical SRS G2 and trusted root on G2 points in storage (C-6).
    function setTrustedRootsG2(uint256[4] memory srsG2, uint256[4] memory rootG2) public virtual {
        _srsG2 = srsG2;
        _trustedStateRootG2 = rootG2;
        _rootsConfigured = true;
        emit SrsG2Updated(srsG2);
        emit TrustedStateRootUpdated(rootG2);
    }

    /// @notice Verifies Verkle state leaf witness pairing: e(pi, g2) == e(leaf, r_stateless)
    /// @return true if verification succeeds
    function verifyPairing(
        uint256[2] memory pi_g1,       // x, y coordinate of proof pi
        uint256[2] memory leaf_g1,     // x, y coordinate of Leaf(H, owner)
        uint256[4] memory g2_point,    // G2 generator point
        uint256[4] memory r_stateless  // G2 stateless root reference point
    ) public view returns (bool) {
        // If contract storage has anchored roots configured, enforce that provided G2 parameters match
        if (_rootsConfigured) {
            require(
                g2_point[0] == _srsG2[0] && g2_point[1] == _srsG2[1] &&
                g2_point[2] == _srsG2[2] && g2_point[3] == _srsG2[3],
                "WitnessVerifier: unanchored g2_point provided"
            );
            require(
                r_stateless[0] == _trustedStateRootG2[0] && r_stateless[1] == _trustedStateRootG2[1] &&
                r_stateless[2] == _trustedStateRootG2[2] && r_stateless[3] == _trustedStateRootG2[3],
                "WitnessVerifier: unanchored r_stateless provided"
            );
        }

        // Pairing input structure for 0x08 precompile:
        // [P1.x, P1.y, Q1.x_a, Q1.x_b, Q1.y_a, Q1.y_b, P2.x, P2.y, Q2.x_a, Q2.x_b, Q2.y_a, Q2.y_b]
        uint256[12] memory input;

        // 1. First pair: e(pi, g2_point)
        input[0] = pi_g1[0];
        input[1] = pi_g1[1];
        input[2] = g2_point[0];
        input[3] = g2_point[1];
        input[4] = g2_point[2];
        input[5] = g2_point[3];

        // 2. Second pair: e(-leaf_g1, r_stateless) -> negating y mod P
        input[6] = leaf_g1[0];
        input[7] = P - (leaf_g1[1] % P);
        input[8] = r_stateless[0];
        input[9] = r_stateless[1];
        input[10] = r_stateless[2];
        input[11] = r_stateless[3];

        uint256[1] memory out;
        bool success;
        assembly {
            // Call alt_bn128 pairing precompile at address 0x08
            success := staticcall(gas(), 8, input, 384, out, 32)
        }
        return success && out[0] == 1;
    }
}
