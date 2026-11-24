/* ===== 组装根：侧栏数据快照 =====
 * 侧栏区域只认 props，不认识任何状态实现。这里把新状态里的画布切片、
 * 会话视图与会话读模型投影成组件要的那几项：activeNode / activeEdge /
 * artifacts / runId / downstreamTask / sessionView / transcript。
 *
 * 纯函数：输入 state、focus 与两个只读查询，输出稳定形状（缺什么给 null /
 * 空数组），便于在测试里直接断言。会话正文来自 SessionReadModel，不在 UiState 里镜像。
 */

/**
 * @param {any} state UiState（只读 canvas / session 切片）
 * @param {{ teamId?: string|null, nodeId?: string|null, edgeId?: string|null, pane?: string }} focus
 * @param {{
 *   peekSession?: (agentId: string, sessionId: string) => any,
 *   sessionsOf?: (teamId: string) => Array<any>,
 * }} [read]
 */
export function selectSidebarExtras(state, focus, read = {}) {
  const peekSession = typeof read.peekSession === 'function' ? read.peekSession : () => null;
  const sessionsOf = typeof read.sessionsOf === 'function' ? read.sessionsOf : () => [];

  const empty = {
    activeNode: null,
    activeEdge: null,
    artifacts: [],
    runId: '',
    downstreamTask: '',
    sessionView: null,
    viewSessionId: '',
    transcript: null,
  };
  if (!state || !focus) return empty;

  const nodes = Array.isArray(state.canvas?.nodes) ? state.canvas.nodes : [];
  const edges = Array.isArray(state.canvas?.edges) ? state.canvas.edges : [];
  const node = focus.nodeId ? nodes.find((item) => item.id === focus.nodeId) || null : null;
  if (!node) return empty;

  const edge = focus.edgeId ? edges.find((item) => item.id === focus.edgeId) || null : null;
  /* 产物属于“这条线起点的最近一次运行”；没有连线时退回当前节点。 */
  const source = edge ? nodes.find((item) => item.id === edge.from) || null : node;
  const target = edge ? nodes.find((item) => item.id === edge.to) || null : null;

  return {
    activeNode: node,
    activeEdge: edge,
    artifacts: Array.isArray(source?.artifacts) ? source.artifacts : [],
    runId: source?.runId || '',
    downstreamTask: target?.task || '',
    ...sessionExtras(state, sessionsOf, peekSession),
    /* 运行中才显示实时转录；跑完回到完整会话。 */
    transcript: node.running ? (Array.isArray(node.transcript) ? node.transcript : []) : null,
  };
}

/**
 * 侧栏组件的完整快照：团队列表 + 展开目标 + 三个屏的额外数据。
 * 区域只认这份纯数据，不再直接读 TeamReadModel。
 *
 * @param {any} state UiState
 * @param {{ teamId?: string|null, nodeId?: string|null, edgeId?: string|null, pane?: string } | null} focus
 * @param {{
 *   teams?: Array<any>,
 *   peekSession?: (agentId: string, sessionId: string) => any,
 *   sessionsOf?: (teamId: string) => Array<any>,
 * }} [read]
 */
export function selectSidebarView(state, focus, read = {}) {
  const teams = Array.isArray(read.teams) ? read.teams : [];
  const activeTeamId = focus?.teamId ?? null;
  const activeTeam = activeTeamId
    ? teams.find((team) => team.id === activeTeamId) || null
    : null;

  return {
    teams,
    activeTeamId,
    pane: focus?.pane || 'default',
    sessions: Array.isArray(activeTeam?.sessions) ? activeTeam.sessions : [],
    ...selectSidebarExtras(state, focus, read),
  };
}

/** 结果屏要看的会话：视图指向哪一段就读哪一段的缓存正文。 */
function sessionExtras(state, sessionsOf, peekSession) {
  const view = state.session?.view || null;
  if (!view?.agentId || !view?.sessionId) {
    return { sessionView: null, viewSessionId: '' };
  }

  /* 会话被删后读模型里就没有这一段了：别再显示旧正文，视为“没有选中”。
   * 列表尚未加载（长度为 0）时不据此判空，避免首屏把正文藏掉。 */
  const sessions = sessionsOf(view.agentId);
  const alive = sessions.length === 0
    || sessions.some((item) => item.piSessionId === view.sessionId);
  if (!alive) return { sessionView: null, viewSessionId: '' };

  const request = state.session?.requests?.load || { status: 'idle' };
  const body = peekSession(view.agentId, view.sessionId);
  const entries = Array.isArray(body?.entries) ? body.entries : [];

  return {
    viewSessionId: view.sessionId,
    sessionView: {
      agentId: view.agentId,
      sessionId: view.sessionId,
      /* 换会话时先清空旧正文，等结果回来再显示（与服务端强制刷新一致）。 */
      entries: request.status === 'loading' ? [] : entries,
      missing: request.status === 'success' ? Boolean(body?.missing) : false,
      error: request.status === 'error' ? String(request.error || '') : '',
      loading: request.status === 'loading',
    },
  };
}

/**
 * 组装根用：把 UiState + 读模型读成“给 focus 的快照函数”。
 * @param {{
 *   kernel: { store: { getState: () => any } },
 *   sessionReadModel: { peekSession: (agentId: string, sessionId: string) => any },
 *   teamReadModel?: {
 *     peekTeams?: () => Array<any>,
 *     sessionsOf?: (teamId: string) => Array<any>,
 *   },
 * }} deps
 */
export function createSidebarSnapshot({ kernel, sessionReadModel, teamReadModel }) {
  if (!kernel?.store || typeof kernel.store.getState !== 'function') {
    throw new Error('createSidebarSnapshot: 需要 kernel.store.getState()');
  }
  if (!sessionReadModel || typeof sessionReadModel.peekSession !== 'function') {
    throw new Error('createSidebarSnapshot: 需要 SessionReadModel.peekSession()');
  }
  const sessionsOf = typeof teamReadModel?.sessionsOf === 'function'
    ? teamReadModel.sessionsOf
    : () => [];
  const peekTeams = typeof teamReadModel?.peekTeams === 'function'
    ? teamReadModel.peekTeams
    : () => [];

  return function snapshot(focus) {
    return selectSidebarView(kernel.store.getState(), focus, {
      teams: peekTeams(),
      peekSession: sessionReadModel.peekSession,
      sessionsOf,
    });
  };
}
