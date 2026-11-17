import assert from 'assert';
import { createOnboardingActor, onboardingMachine } from '../../src/app/onboarding_machine.js';
import { SovereignOnboardingWizard } from '../../src/components/sovereign_onboarding_wizard.js';

console.log('🌱 Running Sovereign Onboarding State Machine & Lit Component Tests...');

// 1. Initial State & Context
console.log('1. Testing OnboardingMachine initial state & defaults...');
const actor = createOnboardingActor();
const snap1 = actor.getSnapshot();
assert.strictEqual(snap1.value, 'step1_connect', 'Should start in step1_connect state');
assert.strictEqual(snap1.context.step, 1, 'Context step should be 1');
assert.strictEqual(snap1.context.connectedAddress, null, 'Connected address should start null');
console.log('   ✅ OnboardingMachine initial state verified.');

// 2. Setting Connected Address
console.log('2. Testing SET_CONNECTED_ADDRESS transition...');
actor.send({
    type: 'SET_CONNECTED_ADDRESS',
    address: '0x1111111111111111111111111111111111111111',
    signature: '0xsig123',
});
const snap2 = actor.getSnapshot();
assert.strictEqual(snap2.context.connectedAddress, '0x1111111111111111111111111111111111111111');
assert.strictEqual(snap2.context.siweSignature, '0xsig123');
assert.ok(snap2.context.statusMessage.includes('0x1111'), 'Status message should include address');

actor.send({ type: 'NEXT_STEP' });
const snap3 = actor.getSnapshot();
assert.strictEqual(snap3.value, 'step2_storage');
assert.strictEqual(snap3.context.step, 2);
console.log('   ✅ SET_CONNECTED_ADDRESS and transition to step 2 verified.');

// 3. Skip Step 2 if directory handle already active
console.log('3. Testing directory skip optimization...');
const actor2 = createOnboardingActor();
actor2.send({
    type: 'SET_STORAGE_MODE',
    mode: 'native',
    handle: { name: 'my-keys' },
    name: 'my-keys',
});
actor2.send({
    type: 'SET_CONNECTED_ADDRESS',
    address: '0x2222222222222222222222222222222222222222',
});
actor2.send({ type: 'NEXT_STEP' });
assert.strictEqual(actor2.getSnapshot().value, 'step3_password');
assert.strictEqual(actor2.getSnapshot().context.step, 3);
console.log('   ✅ Direct transition to step 3 when storage active verified.');

// 4. Auto-detect existing keystore jumps to step 3 with unlock prompt
console.log('4. Testing KEYSTORE_DETECTED auto-advance...');
const actor3 = createOnboardingActor();
actor3.send({
    type: 'KEYSTORE_DETECTED',
    keystore: '{"encrypted":"data"}',
    address: '0x3333333333333333333333333333333333333333',
});
assert.strictEqual(actor3.getSnapshot().value, 'step3_password');
assert.strictEqual(actor3.getSnapshot().context.step, 3);
assert.strictEqual(actor3.getSnapshot().context.existingKeystoreFound, '{"encrypted":"data"}');
console.log('   ✅ KEYSTORE_DETECTED transition verified.');

// 5. Password input and visibility
console.log('5. Testing SET_PASSWORD & TOGGLE_PASSWORD_VISIBILITY...');
actor3.send({ type: 'SET_PASSWORD', password: 'SecretPassword123!' });
assert.strictEqual(actor3.getSnapshot().context.password, 'SecretPassword123!');
assert.strictEqual(actor3.getSnapshot().context.isPasswordVisible, false);
actor3.send({ type: 'TOGGLE_PASSWORD_VISIBILITY' });
assert.strictEqual(actor3.getSnapshot().context.isPasswordVisible, true);
console.log('   ✅ Password management verified.');

// 6. Lit Component <sovereign-onboarding-wizard>
console.log('6. Testing SovereignOnboardingWizard Lit Component...');
const wizard = new SovereignOnboardingWizard();
wizard.bindActor(actor);
assert.strictEqual(wizard.step, 2);
assert.strictEqual(wizard.isOpen, false);

wizard.open();
assert.strictEqual(wizard.isOpen, true);

wizard.render();
assert.ok(wizard.innerHTML.includes('Step 2: Storage Method'), 'Render should display step 2');

wizard.close();
assert.strictEqual(wizard.isOpen, false);
console.log('   ✅ SovereignOnboardingWizard open/close and rendering verified.');

console.log('🎉 All Sovereign Onboarding State Machine & Lit Component Tests Passed Successfully!');
