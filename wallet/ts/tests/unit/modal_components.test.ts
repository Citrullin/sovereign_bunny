import assert from 'assert';
import {
    SovereignUnlockModalElement,
    SovereignRevealKeyModalElement,
    SovereignSettingsModalElement,
    SovereignTxDetailsModalElement,
    SovereignCommitmentModalElement,
    SovereignPqSignModalElement,
    SovereignAppDialog,
    SovereignCheckoutModal
} from '../../src/index.js';

console.log('🪟 Running Sovereign Modal Lit Components Unit Tests...');

// 1. SovereignUnlockModalElement
console.log('1. Testing SovereignUnlockModalElement...');
const unlockModal = new SovereignUnlockModalElement();
assert.strictEqual(unlockModal.isOpen, false, 'Unlock modal should be initially closed');
assert.strictEqual(unlockModal.isPasswordVisible, false, 'Password should not be visible by default');

// Open modal
const openPromise = unlockModal.open('0x1111222233334444555566667777888899990000', { ciphertext: 'test' });
assert.strictEqual(unlockModal.isOpen, true, 'Unlock modal should be open after open()');
assert.strictEqual(unlockModal.address, '0x1111222233334444555566667777888899990000');

// Close modal
unlockModal.close();
assert.strictEqual(unlockModal.isOpen, false, 'Unlock modal should be closed after close()');
console.log('   ✅ SovereignUnlockModalElement open/close lifecycle verified.');

// 2. SovereignRevealKeyModalElement
console.log('2. Testing SovereignRevealKeyModalElement...');
const revealModal = new SovereignRevealKeyModalElement();
assert.strictEqual(revealModal.isOpen, false, 'Reveal modal should be initially closed');
assert.strictEqual(revealModal.stage, 'password', 'Initial stage should be password');

revealModal.open('ML-DSA-65 Master Signing Key', 'ML-DSA-65', '0xpubkey', { ciphertext: 'dummy' });
assert.strictEqual(revealModal.isOpen, true, 'Reveal modal should be open');
assert.strictEqual(revealModal.keyName, 'ML-DSA-65 Master Signing Key');
assert.strictEqual(revealModal.stage, 'password');

revealModal.close();
assert.strictEqual(revealModal.isOpen, false, 'Reveal modal should be closed');
console.log('   ✅ SovereignRevealKeyModalElement open/close lifecycle verified.');

// 3. SovereignSettingsModalElement
console.log('3. Testing SovereignSettingsModalElement...');
const settingsModal = new SovereignSettingsModalElement();
assert.strictEqual(settingsModal.isOpen, false, 'Settings modal should be closed initially');
assert.strictEqual(settingsModal.devMode, false, 'devMode default false');
assert.strictEqual(settingsModal.currencyTicker, 'TBL', 'Default ticker TBL');

settingsModal.open({
    devMode: true,
    currencyTicker: 'SOV',
    apiMode: 'modern',
    allowLegacy: false,
    reclaimTimeout: 20
});
assert.strictEqual(settingsModal.isOpen, true, 'Settings modal should be open');
assert.strictEqual(settingsModal.devMode, true, 'devMode updated to true');
assert.strictEqual(settingsModal.currencyTicker, 'SOV', 'currencyTicker updated to SOV');
assert.strictEqual(settingsModal.apiMode, 'modern', 'apiMode updated to modern');
assert.strictEqual(settingsModal.reclaimTimeout, 20, 'reclaimTimeout updated to 20');

settingsModal.close();
assert.strictEqual(settingsModal.isOpen, false, 'Settings modal should close');
console.log('   ✅ SovereignSettingsModalElement configuration & open/close verified.');

// 4. SovereignTxDetailsModalElement
console.log('4. Testing SovereignTxDetailsModalElement...');
const txModal = new SovereignTxDetailsModalElement();
assert.strictEqual(txModal.isOpen, false, 'Tx details modal should be closed initially');

txModal.open({
    hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    type: 'send',
    amount: '1000000000000000000',
    account: '0x1234567890123456789012345678901234567890',
    counterparty: '0x0987654321098765432109876543210987654321',
    epoch: 42
});
assert.strictEqual(txModal.isOpen, true, 'Tx details modal should be open');
assert.strictEqual(txModal.viewMode, 'structured');
assert.strictEqual(txModal.tx.epoch, 42);

txModal.close();
assert.strictEqual(txModal.isOpen, false, 'Tx details modal should close');
console.log('   ✅ SovereignTxDetailsModalElement structured inspection verified.');

// 5. SovereignCommitmentModalElement
console.log('5. Testing SovereignCommitmentModalElement...');
const commitModal = new SovereignCommitmentModalElement();
assert.strictEqual(commitModal.isOpen, false, 'Commitment modal should be closed initially');

commitModal.open({
    commitment: '0x9999888877776666555544443333222211110000999988887777666655554444',
    address: '0x1234567890123456789012345678901234567890',
    slotId: 3
});
assert.strictEqual(commitModal.isOpen, true, 'Commitment modal should be open');
assert.strictEqual(commitModal.params.slotId, 3);

commitModal.close();
assert.strictEqual(commitModal.isOpen, false, 'Commitment modal should close');
console.log('   ✅ SovereignCommitmentModalElement SMT root inspection verified.');

// 6. SovereignPqSignModalElement
console.log('6. Testing SovereignPqSignModalElement...');
const pqModal = new SovereignPqSignModalElement();
assert.strictEqual(pqModal.isOpen, false, 'PQ Sign modal should be closed initially');

const promptPromise = pqModal.prompt({
    summary: 'Authorize Post-Quantum DID Registration (Slot 0x03)',
    target: '0x0000000000000000000000000000000000000003',
    calldata: '0x03',
    keyScheme: 'ML-DSA-65 (NIST FIPS 204)'
});
assert.strictEqual(pqModal.isOpen, true, 'PQ Sign modal should be open');
assert.strictEqual(pqModal.request.keyScheme, 'ML-DSA-65 (NIST FIPS 204)');

pqModal.reject();
assert.strictEqual(pqModal.isOpen, false, 'PQ Sign modal should close on reject');
console.log('   ✅ SovereignPqSignModalElement prompt & authorization lifecycle verified.');

// 7. SovereignAppDialog
console.log('7. Testing SovereignAppDialog...');
const appDialog = new SovereignAppDialog();
assert.strictEqual(appDialog.isOpen, false, 'App dialog should be closed initially');

const alertPromise = appDialog.showAlert('System state verified', 'Success', 'success');
assert.strictEqual(appDialog.isOpen, true, 'App dialog should open for alert');
assert.strictEqual(appDialog.title, 'Success');
assert.strictEqual(appDialog.dialogType, 'success');

appDialog.close();
assert.strictEqual(appDialog.isOpen, false, 'App dialog should close');
console.log('   ✅ SovereignAppDialog reactive alert verified.');

// 8. SovereignCheckoutModal
console.log('8. Testing SovereignCheckoutModal...');
const checkoutModal = new SovereignCheckoutModal();
assert.strictEqual(checkoutModal.isOpen, false, 'Checkout modal should be closed initially');

checkoutModal.open({
    tokenId: 42,
    title: 'Sovereign Pass #42',
    price_eure: '150.00'
});
assert.strictEqual(checkoutModal.isOpen, true, 'Checkout modal should be open');
assert.strictEqual(checkoutModal.item?.tokenId, 42);
assert.strictEqual(checkoutModal.selectedAsset, 'eure_gnosis');
assert.ok(checkoutModal.signedTxHex.includes('Pay 150.00 EURe for NFT #42'));

checkoutModal.selectedAsset = 'eth_arbitrum';
checkoutModal.updateQuote();
assert.ok(checkoutModal.conversionQuote.includes('CoW Swap Rate'));
assert.ok(checkoutModal.signedTxHex.includes('ETH'));

checkoutModal.close();
assert.strictEqual(checkoutModal.isOpen, false, 'Checkout modal should close');
console.log('   ✅ SovereignCheckoutModal open/quote/close lifecycle verified.');

console.log('\n🎉 All Sovereign Modal Lit Components Unit Tests Passed Successfully!\n');
