import { setup, assign, createActor, ActorRefFrom } from 'xstate';

export type AppTab = 'profile' | 'activitypub' | 'explorer' | 'market' | 'storage' | 'debugger';

export interface NavigationContext {
    activeTab: AppTab;
    devMode: boolean;
    subRoute: string | null;
}

export type NavigationEvent =
    | { type: 'SWITCH_TAB'; tab: AppTab }
    | { type: 'SET_DEV_MODE'; devMode: boolean }
    | { type: 'ROUTE_HASH'; hash: string };

export const initialNavigationContext: NavigationContext = {
    activeTab: 'profile',
    devMode: false,
    subRoute: null,
};

function normalizeTab(raw: string, devMode: boolean): AppTab {
    const clean = raw.replace(/^tab-/, '').replace(/^#/, '').toLowerCase();
    if (clean === 'storage' || clean === 'debugger') {
        return devMode ? (clean as AppTab) : 'profile';
    }
    if (['profile', 'activitypub', 'explorer', 'market'].includes(clean)) {
        return clean as AppTab;
    }
    return 'profile';
}

export const navigationMachine = setup({
    types: {
        context: {} as NavigationContext,
        events: {} as NavigationEvent,
    },
    actions: {
        setDevMode: assign({
            devMode: ({ event }) => event.type === 'SET_DEV_MODE' ? event.devMode : false,
            activeTab: ({ context, event }) => {
                if (event.type === 'SET_DEV_MODE' && !event.devMode) {
                    if (context.activeTab === 'storage' || context.activeTab === 'debugger') {
                        return 'profile';
                    }
                }
                return context.activeTab;
            },
        }),
        switchTab: assign({
            activeTab: ({ context, event }) => {
                if (event.type === 'SWITCH_TAB') {
                    return normalizeTab(event.tab, context.devMode);
                }
                return context.activeTab;
            },
            subRoute: () => null,
        }),
        routeHash: assign({
            activeTab: ({ context, event }) => {
                if (event.type === 'ROUTE_HASH') {
                    const raw = event.hash.replace(/^#/, '').trim();
                    if (!raw) return context.activeTab;
                    if (raw.startsWith('account/') || raw.startsWith('commitment/') || raw.startsWith('node/') || raw.startsWith('tx/')) {
                        return 'explorer';
                    }
                    if (raw.startsWith('debugger')) {
                        return context.devMode ? 'debugger' : 'profile';
                    }
                    return normalizeTab(raw, context.devMode);
                }
                return context.activeTab;
            },
            subRoute: ({ event }) => {
                if (event.type === 'ROUTE_HASH') {
                    const raw = event.hash.replace(/^#/, '').trim();
                    if (raw.startsWith('account/') || raw.startsWith('commitment/') || raw.startsWith('node/') || raw.startsWith('tx/')) {
                        return raw;
                    }
                }
                return null;
            },
        }),
    },
}).createMachine({
    id: 'navigation',
    initial: 'ready',
    context: initialNavigationContext,
    states: {
        ready: {
            on: {
                SWITCH_TAB: {
                    actions: 'switchTab',
                },
                SET_DEV_MODE: {
                    actions: 'setDevMode',
                },
                ROUTE_HASH: {
                    actions: 'routeHash',
                },
            },
        },
    },
});

export type NavigationActor = ActorRefFrom<typeof navigationMachine>;

export function createNavigationActor(initialDevMode: boolean = false): NavigationActor {
    const actor = createActor(navigationMachine, {
        input: {},
    });
    actor.start();
    if (initialDevMode) {
        actor.send({ type: 'SET_DEV_MODE', devMode: true });
    }
    return actor;
}
