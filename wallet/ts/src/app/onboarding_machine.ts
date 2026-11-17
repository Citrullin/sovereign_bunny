import { setup, assign, createActor, ActorRefFrom } from 'xstate';

export interface OnboardingContext {
    step: 1 | 2 | 3;
    connectedAddress: string | null;
    siweSignature: string | null;
    storageMode: 'native' | 'file_api' | null;
    directoryHandle: any;
    directoryName: string | null;
    statusMessage: string;
    error: string | null;
    password: string;
    isPasswordVisible: boolean;
    isSubmitting: boolean;
    existingKeystoreFound: string | null;
    existingAddress: string | null;
    existingDoc: any;
}

export type OnboardingEvent =
    | { type: 'SET_CONNECTED_ADDRESS'; address: string; signature?: string }
    | { type: 'SET_STORAGE_MODE'; mode: 'native' | 'file_api'; handle?: any; name?: string }
    | { type: 'KEYSTORE_DETECTED'; keystore: string; address?: string; doc?: any }
    | { type: 'SET_PASSWORD'; password: string }
    | { type: 'TOGGLE_PASSWORD_VISIBILITY' }
    | { type: 'NEXT_STEP' }
    | { type: 'PREV_STEP' }
    | { type: 'GOTO_STEP'; step: 1 | 2 | 3 }
    | { type: 'SUBMIT' }
    | { type: 'SUBMIT_SUCCESS' }
    | { type: 'SUBMIT_ERROR'; error: string }
    | { type: 'RESET' };

export const initialOnboardingContext: OnboardingContext = {
    step: 1,
    connectedAddress: null,
    siweSignature: null,
    storageMode: null,
    directoryHandle: null,
    directoryName: null,
    statusMessage: 'No wallet linked',
    error: null,
    password: '',
    isPasswordVisible: false,
    isSubmitting: false,
    existingKeystoreFound: null,
    existingAddress: null,
    existingDoc: null,
};

export const onboardingMachine = setup({
    types: {
        context: {} as OnboardingContext,
        events: {} as OnboardingEvent,
    },
    actions: {
        setConnectedAddress: assign({
            connectedAddress: ({ event }) => event.type === 'SET_CONNECTED_ADDRESS' ? event.address : null,
            siweSignature: ({ event }) => event.type === 'SET_CONNECTED_ADDRESS' ? (event.signature || null) : null,
            statusMessage: ({ event }) => event.type === 'SET_CONNECTED_ADDRESS' ? `Linked to: ${event.address}` : '',
            error: () => null,
        }),
        setStorageMode: assign({
            storageMode: ({ event }) => event.type === 'SET_STORAGE_MODE' ? event.mode : null,
            directoryHandle: ({ event }) => event.type === 'SET_STORAGE_MODE' ? (event.handle || null) : null,
            directoryName: ({ event }) => event.type === 'SET_STORAGE_MODE' ? (event.name || null) : null,
            statusMessage: ({ event }) => {
                if (event.type === 'SET_STORAGE_MODE') {
                    return event.mode === 'native' && event.name
                        ? `📁 Root Storage Active: ${event.name}`
                        : '🌐 Storage: Sandbox / File API';
                }
                return '';
            },
            error: () => null,
        }),
        setKeystoreDetected: assign({
            existingKeystoreFound: ({ event }) => event.type === 'KEYSTORE_DETECTED' ? event.keystore : null,
            existingAddress: ({ event }) => event.type === 'KEYSTORE_DETECTED' ? (event.address || null) : null,
            existingDoc: ({ event }) => event.type === 'KEYSTORE_DETECTED' ? (event.doc || null) : null,
            statusMessage: () => '🔐 Existing Keystore Detected in folder!',
            step: () => 3 as const,
        }),
        setPassword: assign({
            password: ({ event }) => event.type === 'SET_PASSWORD' ? event.password : '',
        }),
        togglePasswordVisibility: assign({
            isPasswordVisible: ({ context }) => !context.isPasswordVisible,
        }),
        nextStep: assign({
            step: ({ context }) => {
                if (context.step === 1) {
                    return (context.directoryHandle && context.storageMode === 'native' ? 3 : 2) as 1 | 2 | 3;
                }
                if (context.step === 2) {
                    return 3 as const;
                }
                return 3 as const;
            }
        }),
        prevStep: assign({
            step: ({ context }) => {
                if (context.step === 3 && context.directoryHandle && context.storageMode === 'native') {
                    return 1 as const;
                }
                return Math.max(1, context.step - 1) as 1 | 2 | 3;
            }
        }),
        gotoStep: assign({
            step: ({ event }) => event.type === 'GOTO_STEP' ? event.step : 1,
        }),
        setSubmitting: assign({
            isSubmitting: () => true,
            error: () => null,
        }),
        setSubmitSuccess: assign({
            isSubmitting: () => false,
            error: () => null,
        }),
        setSubmitError: assign({
            isSubmitting: () => false,
            error: ({ event }) => event.type === 'SUBMIT_ERROR' ? event.error : 'Submission failed',
        }),
        resetContext: assign(() => ({ ...initialOnboardingContext })),
    },
}).createMachine({
    id: 'onboarding',
    initial: 'step1_connect',
    context: initialOnboardingContext,
    states: {
        step1_connect: {
            on: {
                SET_CONNECTED_ADDRESS: {
                    actions: 'setConnectedAddress',
                },
                SET_STORAGE_MODE: {
                    actions: 'setStorageMode',
                },
                KEYSTORE_DETECTED: {
                    actions: 'setKeystoreDetected',
                    target: 'step3_password',
                },
                NEXT_STEP: [
                    {
                        guard: ({ context }) => Boolean(context.connectedAddress && context.storageMode === 'native' && context.directoryHandle),
                        actions: 'nextStep',
                        target: 'step3_password',
                    },
                    {
                        guard: ({ context }) => Boolean(context.connectedAddress),
                        actions: 'nextStep',
                        target: 'step2_storage',
                    },
                ],
                GOTO_STEP: [
                    { guard: ({ event }) => event.step === 2, actions: 'gotoStep', target: 'step2_storage' },
                    { guard: ({ event }) => event.step === 3, actions: 'gotoStep', target: 'step3_password' },
                ],
            },
        },
        step2_storage: {
            on: {
                SET_STORAGE_MODE: {
                    actions: 'setStorageMode',
                },
                KEYSTORE_DETECTED: {
                    actions: 'setKeystoreDetected',
                    target: 'step3_password',
                },
                NEXT_STEP: {
                    guard: ({ context }) => Boolean(context.storageMode),
                    actions: 'nextStep',
                    target: 'step3_password',
                },
                PREV_STEP: {
                    actions: 'prevStep',
                    target: 'step1_connect',
                },
                GOTO_STEP: [
                    { guard: ({ event }) => event.step === 1, actions: 'gotoStep', target: 'step1_connect' },
                    { guard: ({ event }) => event.step === 3, actions: 'gotoStep', target: 'step3_password' },
                ],
            },
        },
        step3_password: {
            on: {
                SET_PASSWORD: {
                    actions: 'setPassword',
                },
                TOGGLE_PASSWORD_VISIBILITY: {
                    actions: 'togglePasswordVisibility',
                },
                PREV_STEP: {
                    actions: 'prevStep',
                    target: 'step2_storage',
                },
                SUBMIT: {
                    guard: ({ context }) => Boolean(context.password.length > 0),
                    actions: 'setSubmitting',
                    target: 'submitting',
                },
                GOTO_STEP: [
                    { guard: ({ event }) => event.step === 1, actions: 'gotoStep', target: 'step1_connect' },
                    { guard: ({ event }) => event.step === 2, actions: 'gotoStep', target: 'step2_storage' },
                ],
            },
        },
        submitting: {
            on: {
                SUBMIT_SUCCESS: {
                    actions: 'setSubmitSuccess',
                    target: 'completed',
                },
                SUBMIT_ERROR: {
                    actions: 'setSubmitError',
                    target: 'step3_password',
                },
            },
        },
        completed: {
            on: {
                RESET: {
                    actions: 'resetContext',
                    target: 'step1_connect',
                },
            },
        },
    },
});

export type OnboardingActor = ActorRefFrom<typeof onboardingMachine>;

export function createOnboardingActor(): OnboardingActor {
    const actor = createActor(onboardingMachine);
    actor.start();
    return actor;
}
