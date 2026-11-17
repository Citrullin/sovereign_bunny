import { setup, assign, createActor, ActorRefFrom } from 'xstate';

export interface StorageContext {
    connectedAddress: string | null;
    // Iroh DA Upload
    uploadedCid: string | null;
    uploadedFileName: string | null;
    uploadedFileSize: number | null;
    uploadStatus: string | null;

    // Space and Time (SxT) Proof of SQL
    sxtTargetDao: string;
    sxtQuery: string;
    sxtResult: string | null;
    meritClaimResult: string | null;

    // DAO App Provenance & Anchoring
    daoAppId: string;
    daoAppVersion: string;
    daoSqlRoot: string;
    daoMediaCid: string;
    daoManifestCid: string;
    daoAnchorResult: string | null;
    daoHistory: Array<{ version: string; root: string; timestamp: number }> | null;

    // Address Interest Signaling (0x54)
    signalTargetAddr: string;
    signalAppCtx: string;
    signalTopicId: string | null;
    signalResult: string | null;

    // ZK-Merit & Guarded Bus
    zkMeritTier: number;
    zkMeritProof: string | null;
    guardedMsg: string;
    guardedStatus: string | null;

    // Zanzibar ReBAC (0x61)
    zanNamespace: string;
    zanObjectId: string;
    zanRelation: string;
    zanSubject: string;
    zanStatus: string | null;

    error: string | null;
}

export type StorageEvent =
    | { type: 'SET_CONNECTED_ADDRESS'; address: string | null }
    // Iroh DA
    | { type: 'UPLOAD_START'; fileName: string; fileSize: number }
    | { type: 'UPLOAD_SUCCESS'; cid: string; fileName: string; fileSize: number }
    | { type: 'UPLOAD_FAILURE'; error: string }
    // SxT Proof of SQL
    | { type: 'SET_SXT_CONFIG'; targetDao?: string; query?: string }
    | { type: 'EXEC_SXT_START' }
    | { type: 'EXEC_SXT_SUCCESS'; result: string }
    | { type: 'EXEC_SXT_FAILURE'; error: string }
    | { type: 'CLAIM_MERIT_START' }
    | { type: 'CLAIM_MERIT_SUCCESS'; result: string }
    | { type: 'CLAIM_MERIT_FAILURE'; error: string }
    // DAO App Anchoring
    | { type: 'SET_DAO_APP_CONFIG'; appId?: string; version?: string; sqlRoot?: string; mediaCid?: string; manifestCid?: string }
    | { type: 'ANCHOR_DAO_APP_START' }
    | { type: 'ANCHOR_DAO_APP_SUCCESS'; result: string }
    | { type: 'ANCHOR_DAO_APP_FAILURE'; error: string }
    | { type: 'VERIFY_DAO_APP_START' }
    | { type: 'VERIFY_DAO_APP_SUCCESS'; result: string }
    | { type: 'VERIFY_DAO_APP_FAILURE'; error: string }
    | { type: 'SET_DAO_HISTORY'; history: Array<{ version: string; root: string; timestamp: number }> }
    // Signaling (0x54)
    | { type: 'SET_SIGNAL_CONFIG'; targetAddr?: string; appCtx?: string; topicId?: string }
    | { type: 'INSCRIBE_SIGNAL_START' }
    | { type: 'INSCRIBE_SIGNAL_SUCCESS'; result: string }
    | { type: 'INSCRIBE_SIGNAL_FAILURE'; error: string }
    // ZK-Merit & Guarded Bus
    | { type: 'SET_ZKMERIT_CONFIG'; tier?: number; guardedMsg?: string }
    | { type: 'GEN_ZKMERIT_START' }
    | { type: 'GEN_ZKMERIT_SUCCESS'; proof: string }
    | { type: 'GEN_ZKMERIT_FAILURE'; error: string }
    | { type: 'SUBMIT_GUARDED_START' }
    | { type: 'SUBMIT_GUARDED_SUCCESS'; status: string }
    | { type: 'SUBMIT_GUARDED_FAILURE'; error: string }
    // Zanzibar ReBAC (0x61)
    | { type: 'SET_ZANZIBAR_CONFIG'; namespace?: string; objectId?: string; relation?: string; subject?: string }
    | { type: 'ZANZIBAR_INSCRIBE_START' }
    | { type: 'ZANZIBAR_INSCRIBE_SUCCESS'; status: string }
    | { type: 'ZANZIBAR_INSCRIBE_FAILURE'; error: string }
    | { type: 'ZANZIBAR_CHECK_START' }
    | { type: 'ZANZIBAR_CHECK_SUCCESS'; status: string }
    | { type: 'ZANZIBAR_CHECK_FAILURE'; error: string }
    | { type: 'RESET' };

export const initialStorageContext: StorageContext = {
    connectedAddress: null,
    uploadedCid: null,
    uploadedFileName: null,
    uploadedFileSize: null,
    uploadStatus: null,

    sxtTargetDao: '',
    sxtQuery: "SELECT sub_dao, budget_allocated_tbl FROM regional_allocations WHERE status = 'approved';",
    sxtResult: null,
    meritClaimResult: null,

    daoAppId: 'TreasuryDAO',
    daoAppVersion: 'v1.0.0',
    daoSqlRoot: '0x1111111111111111111111111111111111111111111111111111111111111111',
    daoMediaCid: '0x0',
    daoManifestCid: '0x0',
    daoAnchorResult: null,
    daoHistory: null,

    signalTargetAddr: '',
    signalAppCtx: 'dao.governance.notifications',
    signalTopicId: null,
    signalResult: null,

    zkMeritTier: 2,
    zkMeritProof: null,
    guardedMsg: 'Emergency shard coordination intent',
    guardedStatus: null,

    zanNamespace: '1',
    zanObjectId: '0x5555555555555555555555555555555555555555555555555555555555555555',
    zanRelation: '1',
    zanSubject: '',
    zanStatus: null,

    error: null,
};

export const storageMachine = setup({
    types: {
        context: {} as StorageContext,
        events: {} as StorageEvent,
    },
    actions: {
        setConnectedAddress: assign({
            connectedAddress: ({ event }) => (event.type === 'SET_CONNECTED_ADDRESS' ? event.address : null),
        }),
        // Iroh DA
        setUploadStart: assign({
            uploadedFileName: ({ event }) => (event.type === 'UPLOAD_START' ? event.fileName : null),
            uploadedFileSize: ({ event }) => (event.type === 'UPLOAD_START' ? event.fileSize : null),
            uploadStatus: () => 'Uploading to Iroh storage...',
            error: () => null,
        }),
        setUploadSuccess: assign({
            uploadedCid: ({ event }) => (event.type === 'UPLOAD_SUCCESS' ? event.cid : null),
            uploadedFileName: ({ event }) => (event.type === 'UPLOAD_SUCCESS' ? event.fileName : null),
            uploadedFileSize: ({ event }) => (event.type === 'UPLOAD_SUCCESS' ? event.fileSize : null),
            uploadStatus: () => 'Uploaded successfully to Iroh storage',
            error: () => null,
        }),
        setUploadFailure: assign({
            uploadStatus: () => 'Upload failed',
            error: ({ event }) => (event.type === 'UPLOAD_FAILURE' ? event.error : 'Upload error'),
        }),
        // SxT
        setSxtConfig: assign({
            sxtTargetDao: ({ context, event }) => (event.type === 'SET_SXT_CONFIG' && event.targetDao !== undefined ? event.targetDao : context.sxtTargetDao),
            sxtQuery: ({ context, event }) => (event.type === 'SET_SXT_CONFIG' && event.query !== undefined ? event.query : context.sxtQuery),
        }),
        setSxtSuccess: assign({
            sxtResult: ({ event }) => (event.type === 'EXEC_SXT_SUCCESS' ? event.result : null),
            error: () => null,
        }),
        setSxtFailure: assign({
            sxtResult: null,
            error: ({ event }) => (event.type === 'EXEC_SXT_FAILURE' ? event.error : 'SxT query failed'),
        }),
        setMeritSuccess: assign({
            meritClaimResult: ({ event }) => (event.type === 'CLAIM_MERIT_SUCCESS' ? event.result : null),
            error: () => null,
        }),
        setMeritFailure: assign({
            meritClaimResult: null,
            error: ({ event }) => (event.type === 'CLAIM_MERIT_FAILURE' ? event.error : 'Merit claim failed'),
        }),
        // DAO App
        setDaoAppConfig: assign({
            daoAppId: ({ context, event }) => (event.type === 'SET_DAO_APP_CONFIG' && event.appId !== undefined ? event.appId : context.daoAppId),
            daoAppVersion: ({ context, event }) => (event.type === 'SET_DAO_APP_CONFIG' && event.version !== undefined ? event.version : context.daoAppVersion),
            daoSqlRoot: ({ context, event }) => (event.type === 'SET_DAO_APP_CONFIG' && event.sqlRoot !== undefined ? event.sqlRoot : context.daoSqlRoot),
            daoMediaCid: ({ context, event }) => (event.type === 'SET_DAO_APP_CONFIG' && event.mediaCid !== undefined ? event.mediaCid : context.daoMediaCid),
            daoManifestCid: ({ context, event }) => (event.type === 'SET_DAO_APP_CONFIG' && event.manifestCid !== undefined ? event.manifestCid : context.daoManifestCid),
        }),
        setDaoAnchorSuccess: assign({
            daoAnchorResult: ({ event }) => (event.type === 'ANCHOR_DAO_APP_SUCCESS' ? event.result : null),
            error: () => null,
        }),
        setDaoAnchorFailure: assign({
            daoAnchorResult: null,
            error: ({ event }) => (event.type === 'ANCHOR_DAO_APP_FAILURE' ? event.error : 'Anchoring failed'),
        }),
        setDaoVerifySuccess: assign({
            daoAnchorResult: ({ event }) => (event.type === 'VERIFY_DAO_APP_SUCCESS' ? event.result : null),
            error: () => null,
        }),
        setDaoVerifyFailure: assign({
            daoAnchorResult: null,
            error: ({ event }) => (event.type === 'VERIFY_DAO_APP_FAILURE' ? event.error : 'Verification failed'),
        }),
        setDaoHistory: assign({
            daoHistory: ({ event }) => (event.type === 'SET_DAO_HISTORY' ? event.history : null),
        }),
        // Signaling
        setSignalConfig: assign({
            signalTargetAddr: ({ context, event }) => (event.type === 'SET_SIGNAL_CONFIG' && event.targetAddr !== undefined ? event.targetAddr : context.signalTargetAddr),
            signalAppCtx: ({ context, event }) => (event.type === 'SET_SIGNAL_CONFIG' && event.appCtx !== undefined ? event.appCtx : context.signalAppCtx),
            signalTopicId: ({ context, event }) => (event.type === 'SET_SIGNAL_CONFIG' && event.topicId !== undefined ? event.topicId : context.signalTopicId),
        }),
        setSignalSuccess: assign({
            signalResult: ({ event }) => (event.type === 'INSCRIBE_SIGNAL_SUCCESS' ? event.result : null),
            error: () => null,
        }),
        setSignalFailure: assign({
            signalResult: null,
            error: ({ event }) => (event.type === 'INSCRIBE_SIGNAL_FAILURE' ? event.error : 'Signal inscription failed'),
        }),
        // ZK-Merit
        setZkMeritConfig: assign({
            zkMeritTier: ({ context, event }) => (event.type === 'SET_ZKMERIT_CONFIG' && event.tier !== undefined ? event.tier : context.zkMeritTier),
            guardedMsg: ({ context, event }) => (event.type === 'SET_ZKMERIT_CONFIG' && event.guardedMsg !== undefined ? event.guardedMsg : context.guardedMsg),
        }),
        setZkMeritProofSuccess: assign({
            zkMeritProof: ({ event }) => (event.type === 'GEN_ZKMERIT_SUCCESS' ? event.proof : null),
            error: () => null,
        }),
        setZkMeritProofFailure: assign({
            zkMeritProof: null,
            error: ({ event }) => (event.type === 'GEN_ZKMERIT_FAILURE' ? event.error : 'Proof generation failed'),
        }),
        setGuardedSuccess: assign({
            guardedStatus: ({ event }) => (event.type === 'SUBMIT_GUARDED_SUCCESS' ? event.status : null),
            error: () => null,
        }),
        setGuardedFailure: assign({
            guardedStatus: null,
            error: ({ event }) => (event.type === 'SUBMIT_GUARDED_FAILURE' ? event.error : 'Guarded submission failed'),
        }),
        // Zanzibar ReBAC
        setZanzibarConfig: assign({
            zanNamespace: ({ context, event }) => (event.type === 'SET_ZANZIBAR_CONFIG' && event.namespace !== undefined ? event.namespace : context.zanNamespace),
            zanObjectId: ({ context, event }) => (event.type === 'SET_ZANZIBAR_CONFIG' && event.objectId !== undefined ? event.objectId : context.zanObjectId),
            zanRelation: ({ context, event }) => (event.type === 'SET_ZANZIBAR_CONFIG' && event.relation !== undefined ? event.relation : context.zanRelation),
            zanSubject: ({ context, event }) => (event.type === 'SET_ZANZIBAR_CONFIG' && event.subject !== undefined ? event.subject : context.zanSubject),
        }),
        setZanzibarInscribeSuccess: assign({
            zanStatus: ({ event }) => (event.type === 'ZANZIBAR_INSCRIBE_SUCCESS' ? event.status : null),
            error: () => null,
        }),
        setZanzibarInscribeFailure: assign({
            zanStatus: null,
            error: ({ event }) => (event.type === 'ZANZIBAR_INSCRIBE_FAILURE' ? event.error : 'Zanzibar inscribe failed'),
        }),
        setZanzibarCheckSuccess: assign({
            zanStatus: ({ event }) => (event.type === 'ZANZIBAR_CHECK_SUCCESS' ? event.status : null),
            error: () => null,
        }),
        setZanzibarCheckFailure: assign({
            zanStatus: null,
            error: ({ event }) => (event.type === 'ZANZIBAR_CHECK_FAILURE' ? event.error : 'Zanzibar check failed'),
        }),
        resetContext: assign(() => ({ ...initialStorageContext })),
    },
}).createMachine({
    id: 'storage',
    initial: 'idle',
    context: initialStorageContext,
    states: {
        idle: {
            on: {
                SET_CONNECTED_ADDRESS: { actions: 'setConnectedAddress' },
                UPLOAD_START: { actions: 'setUploadStart' },
                UPLOAD_SUCCESS: { actions: 'setUploadSuccess' },
                UPLOAD_FAILURE: { actions: 'setUploadFailure' },

                SET_SXT_CONFIG: { actions: 'setSxtConfig' },
                EXEC_SXT_SUCCESS: { actions: 'setSxtSuccess' },
                EXEC_SXT_FAILURE: { actions: 'setSxtFailure' },
                CLAIM_MERIT_SUCCESS: { actions: 'setMeritSuccess' },
                CLAIM_MERIT_FAILURE: { actions: 'setMeritFailure' },

                SET_DAO_APP_CONFIG: { actions: 'setDaoAppConfig' },
                ANCHOR_DAO_APP_SUCCESS: { actions: 'setDaoAnchorSuccess' },
                ANCHOR_DAO_APP_FAILURE: { actions: 'setDaoAnchorFailure' },
                VERIFY_DAO_APP_SUCCESS: { actions: 'setDaoVerifySuccess' },
                VERIFY_DAO_APP_FAILURE: { actions: 'setDaoVerifyFailure' },
                SET_DAO_HISTORY: { actions: 'setDaoHistory' },

                SET_SIGNAL_CONFIG: { actions: 'setSignalConfig' },
                INSCRIBE_SIGNAL_SUCCESS: { actions: 'setSignalSuccess' },
                INSCRIBE_SIGNAL_FAILURE: { actions: 'setSignalFailure' },

                SET_ZKMERIT_CONFIG: { actions: 'setZkMeritConfig' },
                GEN_ZKMERIT_SUCCESS: { actions: 'setZkMeritProofSuccess' },
                GEN_ZKMERIT_FAILURE: { actions: 'setZkMeritProofFailure' },
                SUBMIT_GUARDED_SUCCESS: { actions: 'setGuardedSuccess' },
                SUBMIT_GUARDED_FAILURE: { actions: 'setGuardedFailure' },

                SET_ZANZIBAR_CONFIG: { actions: 'setZanzibarConfig' },
                ZANZIBAR_INSCRIBE_SUCCESS: { actions: 'setZanzibarInscribeSuccess' },
                ZANZIBAR_INSCRIBE_FAILURE: { actions: 'setZanzibarInscribeFailure' },
                ZANZIBAR_CHECK_SUCCESS: { actions: 'setZanzibarCheckSuccess' },
                ZANZIBAR_CHECK_FAILURE: { actions: 'setZanzibarCheckFailure' },

                RESET: { actions: 'resetContext' },
            },
        },
    },
});

export type StorageActor = ActorRefFrom<typeof storageMachine>;

export class StorageStateMachine {
    private actor = createActor(storageMachine);

    constructor(initialCtx?: Partial<StorageContext>) {
        this.actor.start();
        if (initialCtx?.connectedAddress) {
            this.send({ type: 'SET_CONNECTED_ADDRESS', address: initialCtx.connectedAddress });
        }
    }

    getSnapshot(): { value: string; context: StorageContext } {
        const snap = this.actor.getSnapshot();
        return {
            value: snap.value as string,
            context: snap.context,
        };
    }

    subscribe(callback: (snapshot: { value: string; context: StorageContext }) => void): () => void {
        const sub = this.actor.subscribe((snap) => {
            callback({
                value: snap.value as string,
                context: snap.context,
            });
        });
        return () => sub.unsubscribe();
    }

    send(event: StorageEvent): void {
        this.actor.send(event);
    }

    stop(): void {
        this.actor.stop();
    }
}
