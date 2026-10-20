import {installValidation} from './validation.js';
import {createWorkspaceViews} from './views/workspaces.js';
import {createState} from './state.js';
import {createApi} from './api.js';
import {createBalanceJournal} from './balance-journal.js';
import {createNavigation} from './navigation.js';
import {installActions} from './actions.js';
import {createShell} from './views/shell.js';
import {createTenantViews} from './views/tenants.js';
import {createPlatformViews} from './views/platform.js';
import {createHelpViews} from './views/help.js';

export function createConsole(environment) {
  const state = createState();
  const shell = createShell({state, ...environment});
  const views = {
    ...shell,
    ...createWorkspaceViews({state, shell:shell.shell}),
    ...createTenantViews({state, shell: shell.shell}),
    ...createPlatformViews({state, shell: shell.shell}),
    ...createHelpViews({state, location: environment.location}),
  };
  const api = createApi({state, fetch: environment.fetch, onSessionEnd: views.login});
  const balanceJournal = createBalanceJournal({state, storage: environment.sessionStorage});
  const navigation = createNavigation({state, api, views, balanceJournal, location: environment.location, history: environment.history});
  installValidation(shell.root);
  installActions({state, api, navigation, views, balanceJournal, ...environment});
  return navigation;
}
