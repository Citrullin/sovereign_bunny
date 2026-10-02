import assert from 'assert';
import { createNavigationActor, navigationMachine } from '../../src/app/navigation_machine.js';
import { SovereignNavigationBar } from '../../src/components/sovereign_navigation_bar.js';

console.log('🧭 Running Sovereign Navigation State Machine & Lit Component Tests...');

// 1. Initial State & Defaults
console.log('1. Testing NavigationActor initial state & defaults...');
const actor = createNavigationActor(false);
const snap1 = actor.getSnapshot();
assert.strictEqual(snap1.value, 'ready', 'Initial state should be ready');
assert.strictEqual(snap1.context.activeTab, 'profile', 'Default active tab should be profile');
assert.strictEqual(snap1.context.devMode, false, 'devMode should default to false');
assert.strictEqual(snap1.context.subRoute, null);
console.log('   ✅ Initial state & defaults verified.');

// 2. Tab Switching
console.log('2. Testing SWITCH_TAB transition...');
actor.send({ type: 'SWITCH_TAB', tab: 'market' });
assert.strictEqual(actor.getSnapshot().context.activeTab, 'market');

actor.send({ type: 'SWITCH_TAB', tab: 'explorer' });
assert.strictEqual(actor.getSnapshot().context.activeTab, 'explorer');
console.log('   ✅ Standard tab switching verified.');

// 3. DevMode Gating
console.log('3. Testing DevMode Gating (storage & debugger tabs)...');
// Attempt switching to debugger without devMode
actor.send({ type: 'SWITCH_TAB', tab: 'debugger' });
assert.strictEqual(actor.getSnapshot().context.activeTab, 'profile', 'Debugger should redirect to profile when devMode is false');

actor.send({ type: 'SWITCH_TAB', tab: 'storage' });
assert.strictEqual(actor.getSnapshot().context.activeTab, 'profile', 'Storage should redirect to profile when devMode is false');

// Enable devMode
actor.send({ type: 'SET_DEV_MODE', devMode: true });
assert.strictEqual(actor.getSnapshot().context.devMode, true);

actor.send({ type: 'SWITCH_TAB', tab: 'debugger' });
assert.strictEqual(actor.getSnapshot().context.activeTab, 'debugger', 'Debugger allowed when devMode is true');

actor.send({ type: 'SWITCH_TAB', tab: 'storage' });
assert.strictEqual(actor.getSnapshot().context.activeTab, 'storage', 'Storage allowed when devMode is true');

// Disabling devMode while on developer tab resets to profile
actor.send({ type: 'SET_DEV_MODE', devMode: false });
assert.strictEqual(actor.getSnapshot().context.activeTab, 'profile', 'Disabling devMode should bounce back to profile');
console.log('   ✅ DevMode gating & security invariants verified.');

// 4. Hash Routing
console.log('4. Testing ROUTE_HASH...');
actor.send({ type: 'ROUTE_HASH', hash: '#tx/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' });
assert.strictEqual(actor.getSnapshot().context.activeTab, 'explorer');
assert.strictEqual(actor.getSnapshot().context.subRoute, 'tx/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');

actor.send({ type: 'ROUTE_HASH', hash: '#commitment/0xfeedbeef' });
assert.strictEqual(actor.getSnapshot().context.activeTab, 'explorer');
assert.strictEqual(actor.getSnapshot().context.subRoute, 'commitment/0xfeedbeef');
console.log('   ✅ Hash routing & subroutes verified.');

// 5. SovereignNavigationBar Lit Component
console.log('5. Testing SovereignNavigationBar Lit Component...');
const navBar = new SovereignNavigationBar();
navBar.bindActor(actor);
assert.strictEqual(navBar.activeTab, 'explorer');
assert.strictEqual(navBar.devMode, false);

navBar.render();
assert.ok(navBar.innerHTML.includes('👤 Identity'));
assert.ok(navBar.innerHTML.includes('⛓️ Explorer'));
assert.ok(!navBar.innerHTML.includes('🐞 Debugger'), 'Debugger tab hidden when devMode is false');

navBar.setDevMode(true);
navBar.render();
assert.ok(navBar.innerHTML.includes('🐞 Debugger'), 'Debugger tab visible when devMode is true');
console.log('   ✅ SovereignNavigationBar Lit Component rendering & actor binding verified.');

console.log('🎉 All Sovereign Navigation State Machine & Lit Component Tests Passed Successfully!');
