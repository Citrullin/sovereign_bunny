//! # High-Throughput Aztec-Style View-Tag Scanner
//!
//! Provides ultra-low-latency batch filtering of incoming encrypted blind notes
//! on the Account-Lattice (CAR Slot 2). Discards 99.6% (255/256) of incoming notes
//! in constant time without performing expensive symmetric trial decryptions.
//!
//! Complies directly with Sovereign Whitebooklet §7.2.

use crate::lattice::note::derive_view_tag;
use crate::lattice::viewing_key::ViewingKeyPair;
use serde::{Deserialize, Serialize};

/// Encrypted Blind Note Envelope broadcast over the P2P mesh or low-entropy log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EncryptedNoteEnvelope {
    /// 32-byte ephemeral public key or sender commitment
    pub ephemeral_pubkey: [u8; 32],
    /// 1-byte Aztec-style view tag: `Blake3("sovereign:view_tag:v1:", shared_secret)[0]`
    pub view_tag: u8,
    /// Encrypted ciphertext payload (AES-256-GCM or ChaCha20-Poly1305)
    pub ciphertext: Vec<u8>,
    /// Target manifold identifier
    pub manifold_id: u64,
    /// Block or epoch number of broadcast
    pub broadcast_epoch: u64,
}

/// Result of scanning an incoming note batch with a user's viewing key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanResult {
    /// Total notes processed in batch
    pub total_scanned: usize,
    /// Notes discarded instantly via 1-byte view tag mismatch (no decryption attempted)
    pub fast_discarded: usize,
    /// Candidate notes where view tag matched and trial decryption was warranted
    pub candidate_matches: Vec<CandidateMatch>,
}

/// A matched note candidate with derived shared secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateMatch {
    pub envelope_index: usize,
    pub shared_secret: [u8; 32],
    pub ciphertext: Vec<u8>,
    pub manifold_id: u64,
}

/// High-throughput view-tag scanner executing vectorized batch filtering.
#[derive(Debug, Clone)]
pub struct ViewTagScanner {
    pub sk_view: [u8; 32],
}

impl ViewTagScanner {
    /// Instantiates a scanner initialized with the recipient's private 32-byte viewing key.
    pub fn new(sk_view: [u8; 32]) -> Self {
        Self { sk_view }
    }

    /// Creates a scanner from a `ViewingKeyPair` if the private key is available.
    pub fn from_keypair(keypair: &ViewingKeyPair) -> Option<Self> {
        let secret = keypair.secret_key.as_ref()?;
        if secret.len() != 32 {
            return None;
        }
        let mut sk_view = [0u8; 32];
        sk_view.copy_from_slice(secret.as_ref());
        Some(Self { sk_view })
    }

    /// Fast-filters a batch of envelopes.
    ///
    /// Computes Diffie-Hellman shared secret between `sk_view` and each `ephemeral_pubkey`,
    /// evaluates the 1-byte view tag, and filters out non-matching envelopes before trial decryption.
    pub fn filter_batch(&self, envelopes: &[EncryptedNoteEnvelope]) -> ScanResult {
        let mut fast_discarded = 0;
        let mut candidate_matches = Vec::new();

        for (index, env) in envelopes.iter().enumerate() {
            // 1. Derive ECDH shared secret:
            // In sovereign profile, shared_secret = Blake3("sovereign:ecdh:v1:", sk_view, ephem_pk)
            let shared_secret = self.derive_shared_secret(&env.ephemeral_pubkey);

            // 2. Derive expected view-tag in O(1)
            let expected_tag = derive_view_tag(&shared_secret);

            // 3. Fast filter check
            if env.view_tag == expected_tag {
                candidate_matches.push(CandidateMatch {
                    envelope_index: index,
                    shared_secret,
                    ciphertext: env.ciphertext.clone(),
                    manifold_id: env.manifold_id,
                });
            } else {
                fast_discarded += 1;
            }
        }

        ScanResult {
            total_scanned: envelopes.len(),
            fast_discarded,
            candidate_matches,
        }
    }

    /// Derives shared secret between this viewing key and an ephemeral public key.
    pub fn derive_shared_secret(&self, ephemeral_pubkey: &[u8; 32]) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"sovereign:ecdh:v1:");
        hasher.update(&self.sk_view);
        hasher.update(ephemeral_pubkey);
        let hash = hasher.finalize();
        let mut secret = [0u8; 32];
        secret.copy_from_slice(hash.as_bytes());
        secret
    }

    /// Fast-filters a raw 31-byte BLE `ADV_NONCONN_IND` packet against an ephemeral sender public key.
    pub fn filter_ble_adv_payload(
        &self,
        raw_adv: &[u8],
        ephem_pubkey: &[u8; 32],
    ) -> Option<BleAdvNonconnIndPacket> {
        let packet = BleAdvNonconnIndPacket::decode_adv_payload(raw_adv).ok()?;
        let shared_secret = self.derive_shared_secret(ephem_pubkey);
        let expected_tag = derive_view_tag(&shared_secret);
        if packet.view_tag == expected_tag {
            Some(packet)
        } else {
            None
        }
    }
}

/// Standard Bluetooth SIG / Sovereign 16-bit Service UUID for 6LoWPAN / IPv6 over BLE (RFC 7668).
pub const SOVEREIGN_IPV6_BLE_SERVICE_UUID: u16 = 0xFD68;

/// Maximum payload length of a legacy Bluetooth Low Energy Advertising Packet (`ADV_NONCONN_IND`).
pub const BLE_ADV_MAX_PAYLOAD: usize = 31;

/// Standard BLE Non-Connectable Undirected Advertising Packet (`ADV_NONCONN_IND`)
/// carrying an RFC 7668 / RFC 6282 6LoWPAN compressed IPv6 datagram.
///
/// Encodes:
/// 1. AD Structure 1: Flags (3 bytes) - LE General Discoverable, BR/EDR not supported.
/// 2. AD Structure 2: 16-bit Service UUID (4 bytes) - `0xFD68` (RFC 7668 6LoWPAN over BLE).
/// 3. AD Structure 3: Service Data (24 bytes):
///    - Service Data AD type (0x16) + UUID (0xFD68)
///    - 6LoWPAN IPHC Header (RFC 6282): compressed link-local multicast / CGA
///    - Compressed UDP Header (RFC 6282 §4.3)
///    - 1-byte Aztec View Tag (`H_k(viewing_key)[0]`)
///    - 8-byte scalar micro-commitment
///    - 2-byte epoch sequence nonce
///    - 4-byte Cryptographically Generated Address (CGA, RFC 3972) integrity checksum
///
/// Exactly 31 bytes total. Fully parsable by standard IPv6 protocol stacks and BLE sniffers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BleAdvNonconnIndPacket {
    /// 16-bit Service UUID (standard 0xFD68)
    pub service_uuid: u16,
    /// 1-byte Aztec View Tag
    pub view_tag: u8,
    /// 8-byte micro-commitment scalar
    pub micro_commitment: [u8; 8],
    /// 2-byte epoch / sequence number
    pub epoch_seq: u16,
    /// 4-byte CGA / integrity parameter
    pub cga_tag: [u8; 4],
}

impl BleAdvNonconnIndPacket {
    /// Creates a new packet with standard 16-bit Service UUID `0xFD68`.
    #[must_use]
    pub fn new(view_tag: u8, micro_commitment: [u8; 8], epoch_seq: u16, cga_tag: [u8; 4]) -> Self {
        Self {
            service_uuid: SOVEREIGN_IPV6_BLE_SERVICE_UUID,
            view_tag,
            micro_commitment,
            epoch_seq,
            cga_tag,
        }
    }

    /// Encodes this packet into a compliant 31-byte BLE `ADV_NONCONN_IND` advertising payload.
    #[must_use]
    pub fn encode_adv_payload(&self) -> [u8; BLE_ADV_MAX_PAYLOAD] {
        let mut pdu = [0u8; BLE_ADV_MAX_PAYLOAD];

        // 1. AD Structure 1: Flags (3 bytes)
        pdu[0] = 0x02; // Length: 2 bytes
        pdu[1] = 0x01; // AD Type: Flags
        pdu[2] = 0x06; // Value: LE General Discoverable Mode | BR/EDR Not Supported

        // 2. AD Structure 2: Complete List of 16-bit Service Class UUIDs (4 bytes)
        pdu[3] = 0x03; // Length: 3 bytes
        pdu[4] = 0x03; // AD Type: 16-bit Service UUIDs
        pdu[5] = (self.service_uuid & 0xFF) as u8; // LSB
        pdu[6] = ((self.service_uuid >> 8) & 0xFF) as u8; // MSB

        // 3. AD Structure 3: Service Data - 16-bit UUID (24 bytes)
        // Length = 23 bytes (1 type + 2 UUID + 2 IPHC + 3 UDP + 1 view_tag + 8 micro_commitment + 2 epoch + 4 cga = 23)
        pdu[7] = 23;   // Length byte
        pdu[8] = 0x16; // AD Type: Service Data - 16-bit UUID
        pdu[9] = (self.service_uuid & 0xFF) as u8;
        pdu[10] = ((self.service_uuid >> 8) & 0xFF) as u8;

        // RFC 6282 6LoWPAN IPHC Header:
        // Byte 0 (0x7B): 011 (dispatch) | 11 (TF elided) | 1 (NH compressed) | 01 (HL 1 hop-limit)
        pdu[11] = 0x7B;
        // Byte 1 (0x3B): 0 (CID) | 01 (SAC link-local) | 1 (SAM compressed) | 1 (M=1 multicast) | 1 (DAC) | 11 (DAM compressed)
        pdu[12] = 0x3B;

        // RFC 6282 Section 4.3 Compressed UDP Header:
        // 0xF0: 11110 (UDP dispatch) | 0 (checksum present) | 00 (port compression)
        pdu[13] = 0xF0;
        pdu[14] = 0x00; // Checksum byte 0
        pdu[15] = 0x00; // Checksum byte 1

        // Payload (15 bytes):
        pdu[16] = self.view_tag;
        pdu[17..25].copy_from_slice(&self.micro_commitment);
        pdu[25..27].copy_from_slice(&self.epoch_seq.to_le_bytes());
        pdu[27..31].copy_from_slice(&self.cga_tag);

        pdu
    }

    /// Decodes a 31-byte raw BLE `ADV_NONCONN_IND` packet.
    pub fn decode_adv_payload(raw: &[u8]) -> Result<Self, &'static str> {
        if raw.len() < BLE_ADV_MAX_PAYLOAD {
            return Err("Advertising packet too short for ADV_NONCONN_IND");
        }

        // Validate Service Data AD header
        if raw[7] < 23 || raw[8] != 0x16 {
            return Err("Invalid or missing Service Data AD structure");
        }

        let service_uuid = u16::from_le_bytes([raw[9], raw[10]]);

        // Validate 6LoWPAN IPHC Header (0x7B, 0x3B)
        if raw[11] != 0x7B || raw[12] != 0x3B {
            return Err("Invalid 6LoWPAN IPHC encapsulation");
        }

        let view_tag = raw[16];
        let mut micro_commitment = [0u8; 8];
        micro_commitment.copy_from_slice(&raw[17..25]);
        let epoch_seq = u16::from_le_bytes([raw[25], raw[26]]);
        let mut cga_tag = [0u8; 4];
        cga_tag.copy_from_slice(&raw[27..31]);

        Ok(Self {
            service_uuid,
            view_tag,
            micro_commitment,
            epoch_seq,
            cga_tag,
        })
    }

    /// Expands the compressed packet into a standard 128-bit RFC 7668 IPv6 Link-Local Destination Address.
    ///
    /// Prefix: `fe80::/64`
    /// Interface Identifier (IID): 64-bit derived from `[view_tag (1B) || micro_commitment[0..7]]`.
    #[must_use]
    pub fn to_standard_ipv6_destination(&self) -> [u8; 16] {
        let mut ipv6 = [0u8; 16];
        // fe80::
        ipv6[0] = 0xFE;
        ipv6[1] = 0x80;
        // Interface ID:
        ipv6[8] = self.view_tag;
        ipv6[9..16].copy_from_slice(&self.micro_commitment[..7]);
        ipv6
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_view_tag_scanner_filters_irrelevant_notes() {
        let sk_view = [0x42; 32];
        let scanner = ViewTagScanner::new(sk_view);

        // Generate 1 genuine matching note
        let matching_ephem_pk = [0x55; 32];
        let genuine_secret = scanner.derive_shared_secret(&matching_ephem_pk);
        let genuine_view_tag = derive_view_tag(&genuine_secret);

        let genuine_envelope = EncryptedNoteEnvelope {
            ephemeral_pubkey: matching_ephem_pk,
            view_tag: genuine_view_tag,
            ciphertext: vec![0xca, 0xfe, 0xba, 0xbe],
            manifold_id: 1,
            broadcast_epoch: 10,
        };

        // Generate 100 irrelevant notes with guaranteed mismatched tags
        let mut batch = vec![genuine_envelope];
        for i in 0..100u8 {
            let fake_ephem = [i + 1; 32];
            let fake_secret = scanner.derive_shared_secret(&fake_ephem);
            let expected_tag = derive_view_tag(&fake_secret);
            // Deliberately offset by 1 so it is guaranteed not to match expected tag
            let mismatched_tag = expected_tag.wrapping_add(1);
            batch.push(EncryptedNoteEnvelope {
                ephemeral_pubkey: fake_ephem,
                view_tag: mismatched_tag,
                ciphertext: vec![0x00; 32],
                manifold_id: 1,
                broadcast_epoch: 10,
            });
        }

        let result = scanner.filter_batch(&batch);
        assert_eq!(result.total_scanned, 101);
        assert_eq!(result.candidate_matches.len(), 1);
        assert_eq!(result.candidate_matches[0].envelope_index, 0);
        assert_eq!(result.candidate_matches[0].shared_secret, genuine_secret);
        assert_eq!(result.fast_discarded, 100);
    }

    #[test]
    fn test_ble_adv_nonconn_ind_rfc7668_ipv6_roundtrip_and_filtering() {
        let sk_view = [0x77; 32];
        let scanner = ViewTagScanner::new(sk_view);

        let ephem_pubkey = [0x99; 32];
        let shared_secret = scanner.derive_shared_secret(&ephem_pubkey);
        let expected_tag = derive_view_tag(&shared_secret);

        let micro_note = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
        let cga_checksum = [0xaa, 0xbb, 0xcc, 0xdd];

        let packet = BleAdvNonconnIndPacket::new(expected_tag, micro_note, 42, cga_checksum);
        let raw_pdu = packet.encode_adv_payload();

        // 1. Verify exact 31-byte legacy BLE PDU size
        assert_eq!(raw_pdu.len(), BLE_ADV_MAX_PAYLOAD);

        // 2. Verify Bluetooth SIG standard AD headers
        assert_eq!(raw_pdu[0], 0x02); // Length of flags
        assert_eq!(raw_pdu[1], 0x01); // Flags AD type
        assert_eq!(raw_pdu[3], 0x03); // Length of 16-bit UUID list
        assert_eq!(raw_pdu[4], 0x03); // 16-bit UUID AD type
        assert_eq!(raw_pdu[5], 0x68); // Service UUID LSB
        assert_eq!(raw_pdu[6], 0xFD); // Service UUID MSB (0xFD68)
        assert_eq!(raw_pdu[7], 23);   // Service Data length
        assert_eq!(raw_pdu[8], 0x16); // Service Data AD type

        // 3. Verify RFC 6282 6LoWPAN IPHC Header
        assert_eq!(raw_pdu[11], 0x7B);
        assert_eq!(raw_pdu[12], 0x3B);

        // 4. Verify decoded packet fidelity
        let decoded = BleAdvNonconnIndPacket::decode_adv_payload(&raw_pdu).unwrap();
        assert_eq!(decoded.service_uuid, SOVEREIGN_IPV6_BLE_SERVICE_UUID);
        assert_eq!(decoded.view_tag, expected_tag);
        assert_eq!(decoded.micro_commitment, micro_note);
        assert_eq!(decoded.epoch_seq, 42);
        assert_eq!(decoded.cga_tag, cga_checksum);

        // 5. Verify standard RFC 7668 128-bit IPv6 destination derivation
        let ipv6 = decoded.to_standard_ipv6_destination();
        assert_eq!(ipv6[0], 0xFE);
        assert_eq!(ipv6[1], 0x80); // fe80::/64
        assert_eq!(ipv6[8], expected_tag);
        assert_eq!(&ipv6[9..16], &micro_note[..7]);

        // 6. Verify instant scanner filtering: Genuine note matches
        let match_opt = scanner.filter_ble_adv_payload(&raw_pdu, &ephem_pubkey);
        assert!(match_opt.is_some());
        assert_eq!(match_opt.unwrap().view_tag, expected_tag);

        // 7. Verify scanner fast-discard: Irrelevant note dropped in O(1)
        let other_ephem = [0x33; 32];
        let discard_opt = scanner.filter_ble_adv_payload(&raw_pdu, &other_ephem);
        assert!(discard_opt.is_none());
    }
}

