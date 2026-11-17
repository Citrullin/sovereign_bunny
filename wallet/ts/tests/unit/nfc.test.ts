// Unit Tests for NFC ZK-Proof Programming & Verification
import assert from 'assert';
import { SovereignNfcManager, BoundedDebitTagPayload, PhysicalAuthTriggerPayload } from '../../src/nfc.js';

async function runNfcTests() {
    console.log("📱 Running Sovereign NFC ZK-Proof & State Ladder Unit Tests...\n");

    // 1. Model 1: Bounded Debit Tag Serialization & Deserialization
    console.log("1. Testing Model 1 Bounded Debit Tag packing & deserialization...");
    const mockPayload: BoundedDebitTagPayload = {
        tagType: 'ntag424_dna',
        subAccountId: '0x1122334455667788990011223344556677889900',
        sequence: 4,
        maxSteps: 10,
        currentTip: `0x${'aa'.repeat(32)}`,
        zkProof: `0x${'bb'.repeat(128)}`,
        publicInputs: `0x${'cc'.repeat(64)}`
    };

    const serialized = SovereignNfcManager.serializeBoundedDebitPayload(mockPayload);
    assert.strictEqual(serialized.length, 256);
    console.log(`   ✅ Packed payload length is exactly 256 bytes (fits NTAG 424 DNA 416B).`);

    const deserialized = SovereignNfcManager.deserializeBoundedDebitPayload(serialized);
    assert.strictEqual(deserialized.subAccountId.toLowerCase(), mockPayload.subAccountId.toLowerCase());
    assert.strictEqual(deserialized.sequence, mockPayload.sequence);
    assert.strictEqual(deserialized.maxSteps, mockPayload.maxSteps);
    assert.strictEqual(deserialized.currentTip, mockPayload.currentTip);
    assert.strictEqual(deserialized.zkProof, mockPayload.zkProof);
    assert.strictEqual(deserialized.publicInputs, mockPayload.publicInputs);
    console.log("   ✅ Deserialized fields match original payload perfectly.\n");

    // 2. Model 2: Physical Auth Trigger Serialization
    console.log("2. Testing Model 2 Physical Auth Trigger serialization...");
    const authPayload: PhysicalAuthTriggerPayload = {
        tagType: 'ntag216',
        cardAddress: '0x2233445566778899001122334455667788990011',
        challengeNonce: `0x${'dd'.repeat(32)}`,
        authMac: `0x${'ee'.repeat(32)}`,
        p2pEndpoint: 'iroh://node12345.relay.manifold.mesh'
    };

    const authBytes = SovereignNfcManager.serializePhysicalAuthPayload(authPayload);
    assert.ok(authBytes.length > 90);
    assert.strictEqual(authBytes[0], 0x53); // 'S'
    assert.strictEqual(authBytes[1], 0x4e); // 'N'
    assert.strictEqual(authBytes[3], 0x02); // Model 2
    console.log(`   ✅ Model 2 Auth Trigger formatted with P2P handover endpoint (${authBytes.length} bytes).\n`);

    // 3. Compact Groth16 Proof Packing
    console.log("3. Testing Groth16 BN254 Compact Packing...");
    const packedProof = SovereignNfcManager.packGroth16Proof({
        piA: `0x${'01'.repeat(64)}`,
        piB: `0x${'02'.repeat(128)}`,
        piC: `0x${'03'.repeat(64)}`
    });
    assert.strictEqual(packedProof.length, 2 + 256); // 128 bytes hex encoded
    console.log("   ✅ BN254 Groth16 proof successfully packed to 128 bytes.\n");

    // 4. Simulated Tag Write and Read Cycle
    console.log("4. Testing Simulated NFC Tag Write & Read cycle (Model 1)...");
    const writeRes = await SovereignNfcManager.writeTag(mockPayload, 1);
    assert.strictEqual(writeRes.success, true);
    assert.strictEqual(writeRes.simulated, true);

    const readRes = await SovereignNfcManager.readTag();
    assert.strictEqual(readRes.model, 1);
    const readPayload = readRes.payload as BoundedDebitTagPayload;
    assert.strictEqual(readPayload.subAccountId.toLowerCase(), mockPayload.subAccountId.toLowerCase());
    assert.strictEqual(readPayload.sequence, 4);
    console.log("   ✅ Simulated NFC read verified successfully from mock tag memory.\n");

    // 5. Model 3: PIN-Based Nullifier Tag & Redeem Flow
    console.log("5. Testing Model 3 PIN-Based Nullifier Tag serialization & redeem flow...");
    const model3Tag = {
        tagType: 'ntag424_dna' as const,
        noteId: `0x${'33'.repeat(32)}` as const,
        salt: `0x${'44'.repeat(32)}` as const,
        assetId: '0x0000000000000000000000000000000000000000' as const,
        value: 5000000n,
        gossipTopic: `0x${'55'.repeat(32)}` as const,
    };

    const m3Bytes = SovereignNfcManager.serializeModel3Payload(model3Tag);
    assert.strictEqual(m3Bytes.length, 128);
    assert.strictEqual(m3Bytes[3], 0x03); // Model 3 indicator
    console.log(`   ✅ Model 3 packed payload length is exactly 128 bytes.`);

    const m3Deserialized = SovereignNfcManager.deserializeModel3Payload(m3Bytes);
    assert.strictEqual(m3Deserialized.noteId, model3Tag.noteId);
    assert.strictEqual(m3Deserialized.salt, model3Tag.salt);
    assert.strictEqual(m3Deserialized.value, model3Tag.value);
    console.log(`   ✅ Model 3 deserialized fields match original payload.`);

    // Write Model 3 to tag and test PinNoteRedeemFlow
    await SovereignNfcManager.writeTag(model3Tag, 3);
    const redeemRes = await import('../../src/nfc.js').then(m =>
        m.PinNoteRedeemFlow.redeemFromTag('1234', '0x9999999999999999999999999999999999999999', 2)
    );

    assert.ok(redeemRes.nullifier.startsWith('0x'));
    assert.strictEqual(redeemRes.noteId, model3Tag.noteId);
    assert.strictEqual(redeemRes.value, model3Tag.value);
    assert.strictEqual(redeemRes.absorbPayload.target_slot, 2);
    console.log(`   ✅ Model 3 PinNoteRedeemFlow successfully derived nullifier ${redeemRes.nullifier.slice(0, 18)}...\n`);

    console.log("🎉 All Sovereign NFC ZK-Proof unit tests passed successfully!\n");
}

runNfcTests().catch(err => {
    console.error("❌ NFC unit tests failed:", err);
    process.exit(1);
});
