export interface SlotSchema {
    id: number;
    name: string;
    pluginId: string;
    precompile: string;
}

export interface SovereignNetworkConfig {
    networkName: string;
    chainId: number;
    rpcUrl: string;
    storageUrl: string;
    ticker: string;
    enclaveCapability: 'SimulatedDev' | 'HardwareSgxV2' | 'HardwareTdx' | 'Unattested';
    slots: SlotSchema[];
}

export const defaultSovereignConfig: SovereignNetworkConfig = {
    networkName: "Sovereign Bunny",
    chainId: 1337,
    rpcUrl: typeof window !== 'undefined' && window.location.origin && window.location.origin !== "null"
        ? (window.location.origin.includes("localhost") || window.location.origin.includes("127.0.0.1") ? "http://127.0.0.1:8545" : `${window.location.origin}/rpc`)
        : "http://127.0.0.1:8545",
    storageUrl: typeof window !== 'undefined' && window.location.origin && window.location.origin !== "null"
        ? (window.location.origin.includes("localhost") || window.location.origin.includes("127.0.0.1") ? "http://127.0.0.1:8548" : `${window.location.origin}/storage`)
        : "http://127.0.0.1:8548",
    ticker: "TBL",
    enclaveCapability: "SimulatedDev",
    slots: [
        { id: 0, name: "DID Document Root", pluginId: "core.did_identity", precompile: "0x03" },
        { id: 1, name: "Zanzibar ReBAC SMT", pluginId: "core.zanzibar", precompile: "0x61" },
        { id: 2, name: "Native Payment Core", pluginId: "core.native_payment", precompile: "0x02" },
        { id: 3, name: "Git VCS Object DAG", pluginId: "vcs.git_dag", precompile: "0x63" },
        { id: 4, name: "Relational SQL Digest", pluginId: "ext.sqldigest", precompile: "0x62" },
        { id: 5, name: "X-Road Service Descriptor", pluginId: "authority.xroad_descriptor", precompile: "0x05" },
        { id: 6, name: "Supply Chain Interface", pluginId: "vcs.interface_contract", precompile: "0x66" },
        { id: 7, name: "Reputation & Merit Score", pluginId: "reputation.merit", precompile: "0x07" }
    ]
};

export async function loadSovereignConfig(overrideUrl?: string): Promise<SovereignNetworkConfig> {
    if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const rpcOverride = urlParams.get('rpc');
        const chainOverride = urlParams.get('chainId');

        try {
            const configPath = overrideUrl || './sovereign.config.json';
            let res = await fetch(configPath);
            if (!res.ok && !overrideUrl) {
                res = await fetch('./sovereign.config.example.json');
            }
            if (res.ok) {
                const json: SovereignNetworkConfig = await res.json();
                if (json.rpcUrl && json.rpcUrl.startsWith('/')) {
                    json.rpcUrl = `${window.location.origin}${json.rpcUrl}`;
                }
                if (json.storageUrl && json.storageUrl.startsWith('/')) {
                    json.storageUrl = `${window.location.origin}${json.storageUrl}`;
                }
                if (rpcOverride) json.rpcUrl = rpcOverride;
                if (chainOverride) json.chainId = parseInt(chainOverride, 10);
                return json;
            }
        } catch (_) {}

        const conf = { ...defaultSovereignConfig };
        if (rpcOverride) conf.rpcUrl = rpcOverride;
        if (chainOverride) conf.chainId = parseInt(chainOverride, 10);
        return conf;
    }
    return defaultSovereignConfig;
}
