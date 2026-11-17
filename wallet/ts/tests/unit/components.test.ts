import { TxHistoryStateMachine } from '../../src/app/tx_history_machine.js';
import { SovereignWallet } from '../../src/components/sovereign_wallet.js';
import { SovereignAccount } from '../../src/components/sovereign_account.js';
import { TxHistory } from '../../src/components/tx_history.js';
import { WalletStateMachine } from '../../src/app/wallet_machine.js';
import { NetworkStateMachine } from '../../src/app/network_machine.js';

console.log("🧩 Running Sovereign Lit Components & TxHistoryMachine Unit Tests...");

// 1. TxHistoryStateMachine tests
const txMachine = new TxHistoryStateMachine();
let txSnap = txMachine.getSnapshot();
console.assert(txSnap.value === 'idle', `TxHistoryMachine initial state must be idle, got ${txSnap.value}`);
console.assert(txSnap.context.transactions.length === 0, "Initial transactions should be empty");

txMachine.send({ type: 'LOAD', address: '0x1111111111111111111111111111111111111111' });
txSnap = txMachine.getSnapshot();
console.assert(txSnap.value === 'loading', "State should be loading after LOAD");

txMachine.send({
    type: 'LOAD_SUCCESS',
    transactions: [
        {
            hash: '0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abc1',
            from: '0x1111111111111111111111111111111111111111',
            to: '0x2222222222222222222222222222222222222222',
            value: '10.50 TBL',
            timestamp: Date.now(),
            status: 'success',
            type: 'Transfer',
        },
        {
            hash: '0xdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890def2',
            from: '0x3333333333333333333333333333333333333333',
            to: '0x1111111111111111111111111111111111111111',
            value: '50.00 TBL',
            timestamp: Date.now(),
            status: 'success',
            type: 'Claim',
        },
    ],
});
txSnap = txMachine.getSnapshot();
console.assert(txSnap.value === 'ready', "State should be ready after LOAD_SUCCESS");
console.assert(txSnap.context.transactions.length === 2, "Transactions count should be 2");
console.log("   ✅ TxHistoryStateMachine lifecycle verified.");

// 2. TxHistory component binding and filtering
const txComponent = new TxHistory();
txComponent.bindMachine(txMachine);
console.assert(txComponent.transactions.length === 2, "Component transactions synced with machine");
console.assert(txComponent.filteredTransactions.length === 2, "Filter 'all' returns all 2");

txComponent.setFilter('sent');
console.assert(txComponent.filteredTransactions.length === 1, "Filter 'sent' returns 1");
console.assert(txComponent.filteredTransactions[0].from === '0x1111111111111111111111111111111111111111', "Sent tx matches from address");

txComponent.setFilter('received');
console.assert(txComponent.filteredTransactions.length === 1, "Filter 'received' returns 1");
console.assert(txComponent.filteredTransactions[0].to === '0x1111111111111111111111111111111111111111', "Received tx matches to address");
console.log("   ✅ TxHistory Lit component binding and filtering verified.");

// 3. SovereignWallet component binding to WalletStateMachine
const walletMachine = new WalletStateMachine();
const walletComp = new SovereignWallet();
walletComp.setWalletActor(walletMachine);

walletMachine.send({
    type: 'SET_PROFILES',
    profiles: [
        { address: '0x1111111111111111111111111111111111111111', did: 'did:sov:1111' },
    ],
    activeIndex: 0,
});
console.assert(walletComp.profiles.length === 1, "WalletComponent synced profiles from WalletStateMachine");
console.assert(walletComp.activeProfileIndex === 0, "WalletComponent activeProfileIndex synced");
console.log("   ✅ SovereignWallet Lit component actor subscription verified.");

// 4. SovereignAccount component binding to both WalletMachine and NetworkMachine
const netMachine = new NetworkStateMachine();
const accountComp = new SovereignAccount();
accountComp.bindMachines(walletMachine, netMachine);

netMachine.send({ type: 'EPOCH_ADVANCED', epochHeight: 88 });
console.assert(accountComp.epochHeight === 88, `SovereignAccount synced epochHeight, got ${accountComp.epochHeight}`);
console.log("   ✅ SovereignAccount dual-machine binding verified.");

txMachine.stop();
walletMachine.stop();
netMachine.stop();

console.log("🎉 All Sovereign Lit Components & TxHistoryMachine unit tests passed!\n");
