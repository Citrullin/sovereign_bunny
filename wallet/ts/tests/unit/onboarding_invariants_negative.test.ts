// Unit Tests for Onboarding Invariants: Note Gas & PQ DID Invariant Rejections and Approvals
import assert from 'assert';
import { ethers } from 'ethers';

function runNegativeTests() {
    console.log("🧪 Running Onboarding Invariants & Protocol Rejection Unit Tests...\n");

    const DID_REGISTRATION_GAS_FEE = 50000n;

    // In-memory protocol state simulation adhering to router.rs and proxy.rs rules
    const accounts = new Map<string, {
        balance: bigint;
        hasDid: boolean;
        pqKey?: string;
        unspentNotes: Array<{ commitment: string; didRegGasFee: bigint }>;
    }>();

    function getAccount(addr: string) {
        if (!accounts.has(addr)) {
            accounts.set(addr, { balance: 0n, hasDid: false, unspentNotes: [] });
        }
        return accounts.get(addr)!;
    }

    function commitNote(senderAddr: string, recipientAddr: string, didRegFee: bigint) {
        const sender = getAccount(senderAddr);
        // Sender must fund registration fee if recipient is unregistered
        const recipient = getAccount(recipientAddr);
        if (!recipient.hasDid) {
            if (didRegFee < DID_REGISTRATION_GAS_FEE && sender.balance < DID_REGISTRATION_GAS_FEE) {
                throw new Error("Sender must fund DID_REGISTRATION_GAS_FEE when sending a blind note to a fresh account without a registered DID");
            }
            const feeToCredit = didRegFee > 0n ? didRegFee : DID_REGISTRATION_GAS_FEE;
            if (sender.balance >= feeToCredit) {
                sender.balance -= feeToCredit;
            }
            recipient.balance += feeToCredit;
        }
        recipient.unspentNotes.push({ commitment: ethers.hexlify(ethers.randomBytes(32)), didRegGasFee: didRegFee });
    }

    function registerDid(callerAddr: string, pqKey: string, didDocJson: string) {
        const acc = getAccount(callerAddr);
        const doc = JSON.parse(didDocJson);

        // SEC-04 Caller EVM address check
        if (doc.evmAddress && doc.evmAddress.toLowerCase() !== callerAddr.toLowerCase()) {
            throw new Error("RegisterDid caller address mismatch with DID EVM address");
        }

        // Anti-DDoS & Solvency Invariant Check
        if (acc.balance < DID_REGISTRATION_GAS_FEE) {
            throw new Error("Insufficient economic credit: Fresh address requires an in-note gas allocation or settled balance to register DID");
        }

        // PQ Key presence
        if (!pqKey || pqKey === '0x' || pqKey.length < 32) {
            throw new Error("Post-Quantum keys (ML-DSA-65/Falcon) are strictly required for DID registration");
        }

        acc.balance -= DID_REGISTRATION_GAS_FEE;
        acc.hasDid = true;
        acc.pqKey = pqKey;
        return true;
    }

    function dispatchTransaction(callerAddr: string) {
        const acc = getAccount(callerAddr);
        if (!acc.hasDid) {
            throw new Error("No state change permitted without an on-chain DID identity: Caller has not registered a DID on Slot 0");
        }
        return true;
    }

    const freshUser = ethers.Wallet.createRandom().address;
    const fundedSender = ethers.Wallet.createRandom().address;
    const fundedAcc = getAccount(fundedSender);
    fundedAcc.balance = 1000000n;
    fundedAcc.hasDid = true;

    // 1. NEGATIVE TEST: Fresh user with 0 notes and 0 balance attempts state change
    console.log("1. Testing state change on unregistered, unfunded account...");
    assert.throws(() => {
        dispatchTransaction(freshUser);
    }, /No state change permitted without an on-chain DID identity/, "Must reject state changes before DID registration");
    console.log("   ✅ Disallowed state changes on unregistered fresh account.\n");

    // 2. NEGATIVE TEST: Fresh user with 0 notes attempts DID registration
    console.log("2. Testing DID registration on unfunded account with 0 notes...");
    assert.throws(() => {
        registerDid(freshUser, ethers.hexlify(ethers.randomBytes(32)), JSON.stringify({
            id: `did:sovereign:1337:${freshUser}`,
            evmAddress: freshUser
        }));
    }, /Insufficient economic credit/, "Must reject DID registration without economic credit");
    console.log("   ✅ Zero-gas DID registration rejected with Insufficient economic credit.\n");

    // 3. NEGATIVE TEST: Registering DID with mismatched caller EVM address
    console.log("3. Testing DID registration with mismatched caller EVM address...");
    const anotherAddr = ethers.Wallet.createRandom().address;
    const accWithFee = getAccount(freshUser);
    accWithFee.balance = DID_REGISTRATION_GAS_FEE; // Temporarily grant fee
    assert.throws(() => {
        registerDid(freshUser, ethers.hexlify(ethers.randomBytes(32)), JSON.stringify({
            id: `did:sovereign:1337:${freshUser}`,
            evmAddress: anotherAddr
        }));
    }, /RegisterDid caller address mismatch/, "Must reject mismatched EVM controller address");
    accWithFee.balance = 0n; // Reset
    console.log("   ✅ Mismatched EVM controller rejected.\n");

    // 4. NEGATIVE TEST: Registering DID without Post-Quantum keys
    console.log("4. Testing DID registration without Post-Quantum verification keys...");
    accWithFee.balance = DID_REGISTRATION_GAS_FEE;
    assert.throws(() => {
        registerDid(freshUser, "", JSON.stringify({
            id: `did:sovereign:1337:${freshUser}`,
            evmAddress: freshUser
        }));
    }, /Post-Quantum keys .* are strictly required/, "Must reject DID registration missing PQ keys");
    accWithFee.balance = 0n; // Reset
    console.log("   ✅ Missing post-quantum key rejected.\n");

    // 5. POSITIVE TEST: Sender commits blind note with DID registration gas -> Fresh user registers DID -> Transacts
    console.log("5. Testing complete positive path with blind note registration fee...");
    commitNote(fundedSender, freshUser, DID_REGISTRATION_GAS_FEE);
    assert.strictEqual(getAccount(freshUser).balance, DID_REGISTRATION_GAS_FEE, "Fresh account must be credited registration gas");
    
    // Now fresh user registers PQ DID
    const pqKey = ethers.hexlify(ethers.randomBytes(32));
    const registered = registerDid(freshUser, pqKey, JSON.stringify({
        id: `did:sovereign:1337:${freshUser}`,
        evmAddress: freshUser
    }));
    assert.ok(registered, "Registration must succeed with funded note gas");
    assert.strictEqual(getAccount(freshUser).hasDid, true, "Account must now have registered DID");
    assert.strictEqual(getAccount(freshUser).balance, 0n, "Registration fee must be consumed");

    // Fresh user can now dispatch transactions
    const txOk = dispatchTransaction(freshUser);
    assert.ok(txOk, "Account must now be permitted to execute state transitions");
    console.log("   ✅ Complete positive onboarding sequence verified.\n");

    console.log("🎉 All Onboarding Invariant Negative & Positive Unit Tests Passed Successfully!");
}

runNegativeTests();
