export function createState() {
  const state = {
    me: null,
    current: null,
    section: 'team',
    details: null,
    organizations: [],
    credentials: [],
    defaultModel: '',
    connections: [],
    downloadFiles: [],
    pendingBalances: new Map(),
    invitationDrafts: new Map(),
    balanceJournalError: '',
    sessionVersion: 0,
    navigationVersion: 0,
  };

  state.snapshot = () => ({
    session: state.sessionVersion,
    navigation: state.navigationVersion,
  });

  state.isCurrent = snapshot =>
    snapshot.session === state.sessionVersion &&
    snapshot.navigation === state.navigationVersion;

  state.navigate = (section, tenant = null) => {
    state.navigationVersion += 1;
    state.section = section;
    state.current = tenant;
    state.details = null;
    return state.snapshot();
  };

  state.endSession = () => {
    state.sessionVersion += 1;
    state.navigate('home');
    state.me = null;
    state.organizations = [];
    state.credentials = [];
    state.connections = [];
    state.defaultModel = '';
    state.downloadFiles = [];
    state.pendingBalances.clear();
    state.invitationDrafts.clear();
    state.balanceJournalError = '';
  };

  return state;
}
