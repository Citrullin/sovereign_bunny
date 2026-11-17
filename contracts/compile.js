const fs = require('fs');
const path = require('path');
const solc = require('solc');

const srcDir = path.resolve(__dirname, 'src');
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.sol'));

const sources = {};
for (const file of files) {
    sources[file] = {
        content: fs.readFileSync(path.resolve(srcDir, file), 'utf8')
    };
}

const input = {
    language: 'Solidity',
    sources: sources,
    settings: {
        outputSelection: {
            '*': {
                '*': ['abi', 'evm.deployedBytecode']
            }
        }
    }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

let hasErrors = false;
if (output.errors) {
    output.errors.forEach(err => {
        if (err.severity === 'error') {
            hasErrors = true;
            console.error('ERROR:', err.formattedMessage);
        } else {
            console.warn('WARN:', err.formattedMessage);
        }
    });
}

if (hasErrors) {
    console.error('Solidity compilation failed with errors');
    process.exit(1);
}

const outDir = path.resolve(__dirname, 'out');
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

for (const [fileName, contracts] of Object.entries(output.contracts)) {
    for (const [contractName, contract] of Object.entries(contracts)) {
        const bin = contract.evm.deployedBytecode.object;
        if (bin && bin.length > 0) {
            fs.writeFileSync(path.resolve(outDir, `${contractName}.runtime.bin`), bin);
            console.log(`Compiled ${contractName} (runtime length: ${bin.length})`);
        }
    }
}
console.log('All contracts compiled successfully.');
