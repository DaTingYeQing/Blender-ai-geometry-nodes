/* ===== 初始 UI 状态 =====
 * 只有形状和默认值，不含逻辑。字段含义见 contracts/state.js。
 *
 * 每次返回全新对象：调用方可以放心改，不需要深拷贝。
 */

/**
 * @returns {import('../contracts/state.js').UiState}
 */
export function createInitialUiState() {
  return {
    route: { name: 'team', params: {} },
    app: { status: 'starting' },
    notices: [],
    noticeSeq: 0,
    panels: {
      logoPanel: false,
      agentPanel: false,
    },
    panelTabs: {
      logoPanel: 'lang',
      agentPanel: 'new',
    },
    transitions: {
      logoPanel: 'idle',
      agentPanel: 'idle',
    },
    nav: 'lang',
    focusPath: ['app'],
    sidebar: {
      focus: { teamId: null, nodeId: null, edgeId: null, pane: 'default' },
    },
    team: {
      requests: {
        remove: { status: 'idle' },
      },
    },
    settings: { lang: 'en', mode: 'team' },
    save: { status: 'idle' },
    session: {
      view: { agentId: null, sessionId: null },
      requests: {
        load: { status: 'idle' },
        rename: { status: 'idle' },
        remove: { status: 'idle' },
      },
    },
    canvas: {
      nodes: [],
      edges: [],
      loaded: false,
    },
    artifact: {
      open: false,
      name: '',
      path: '',
      color: '',
      previewable: true,
      status: 'idle',
      error: '',
    },
    workspace: {
      selectedId: null,
      entered: null,
      requests: {
        enter: { status: 'idle' },
        add: { status: 'idle' },
        remove: { status: 'idle' },
        rename: { status: 'idle' },
      },
    },
    requests: {
      tools: { status: 'idle' },
      agentConfig: { status: 'idle' },
      agentCreate: { status: 'idle' },
      agentSave: { status: 'idle' },
    },
    drafts: {
      agentNew: { name: '', tools: [] },
      agentExisting: {
        agentId: null,
        name: '',
        tools: [],
        loadedFor: null,
        dirty: false,
      },
    },
  };
}
