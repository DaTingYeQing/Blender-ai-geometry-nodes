/* ===== 初始状态 =====
 * 只有形状，没有逻辑。谁写这一块、谁读这一块，在 core/store.js 里说清了。
 *
 * business —— 业务状态：可序列化，跨 API 传，将来落库。
 * view     —— 界面状态：引擎私有，不上后端。
 */

export function initialState() {
  return {
    business: {
      teams: [],                                   // { id, name, h, s, l, sessions }  sessions = 该 Agent 的对话列表
      nodes: [],                                   // { id, agentId, x, y, task, handoffEnabled, sessionMode, sessionId, alert, running, runId, artifacts, artifactsLoaded }
      edges: [],                                   // { id, from, to, color, bow, files }
      sessionView: { agentId: null, sessionId: null, entries: [], missing: false, error: '', loading: false },  // 结果屏正在看的对话
      workspaces: [],                              // 工作区面板里的方框条目（首屏从 /api/state 填）
      settings: { lang: 'en', mode: 'team' },      // 'zh'|'en' / 'team'|'solo'
      focus: { teamId: null, nodeId: null, edgeId: null, pane: 'default' },  // 侧栏聚焦：哪个节点/连线打开的 + 它的团队 + 停在哪一屏
      workspace: { entered: false, selectedId: null },  // 是否已进入工作区视图 / 面板里选中的方框 id
    },
    view: {
      panels: { logoPanel: false, addPanel: false },
      nav: 'lang',                                 // logoPanel 左栏停在'语言'还是'工作区'
      canvas: { panX: 0, panY: 0, zoom: 1 },
      saveState: 'idle',                           // 手动保存：'idle' | 'dirty' | 'saving' | 'saved' | 'failed'
    },
  };
}
