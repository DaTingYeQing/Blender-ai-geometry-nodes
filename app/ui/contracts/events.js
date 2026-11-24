/* ===== 事件与命令契约 =====
 * 对应 common.md 4.2 / 8.1。
 *
 *   UI 事件：已经发生的事，用过去式（agent.name.changed）。
 *   UI 命令：希望外部执行的事，用祈使式（agent.create）。
 *
 * View 只能发这里登记过的事件；State 只能产出这里登记过的命令。
 * 新增一条必须同时登记名字和 kind，架构测试会校验。
 */

/**
 * @typedef {'mutate' | 'focus' | 'observe'} UiEventKind
 */

/**
 * @typedef {Object} UiEvent
 * @property {string} type
 * @property {UiEventKind} kind
 * @property {string} [regionId]   由 RegionHost 补上
 * @property {string[]} [regionPath] 由 RegionHost 补上（结构路径，不是聚焦路径）
 * @property {number} [requestId]  需要后端时由派发方补上
 * @property {Object} [payload]
 */

/**
 * @typedef {Object} UiCommand
 * @property {string} type
 * @property {Object} [payload]
 */

/** ---------------------------------------------------------------- 事件 */

export const EVENTS = Object.freeze({
  PANEL_OPEN_CLICKED: 'panel.open.clicked',
  PANEL_CLOSE_CLICKED: 'panel.close.clicked',
  PANEL_TAB_CLICKED: 'panel.tab.clicked',

  /* 聚焦路径变了。由 FocusManager 广播，任何可见区域都能发（kind = focus）。 */
  FOCUS_CHANGED: 'focus.changed',

  /* 应用可用状态变了（启动中/运行时缺失/后端未就绪/断网/会话丢失/就绪）。 */
  APP_STATUS_CHANGED: 'app.status.changed',

  /* 用户在设置面板选了语言：只说明“想换成哪个”，结果由 settings.lang.changed 回来。 */
  SETTINGS_LANG_SUBMITTED: 'settings.lang.submitted',
  /* 语言偏好变了（设置状态，只在设置切片里改）。 */
  SETTINGS_LANG_CHANGED: 'settings.lang.changed',
  SETTINGS_LANG_FAILED: 'settings.lang.failed',

  /* 全局提示：字段级错误不进这里。 */
  NOTICE_RAISED: 'notice.raised',
  NOTICE_DISMISSED: 'notice.dismissed',

  /* 过渡播完了。Animator 只上报，由 reducer 决定隐藏还是继续。 */
  ANIM_DONE: 'anim.done',

  /* 某个区域渲染失败，已就地降级。只做记录，不改变状态（kind = observe）。 */
  REGION_RENDER_FAILED: 'region.render.failed',

  /* 描述里出现了不认识的组件类型，已用占位跳过（kind = observe）。 */
  COMPONENT_SKIPPED: 'component.skipped',

  AGENT_NAME_CHANGED: 'agent.name.changed',
  AGENT_TOOL_TOGGLED: 'agent.tool.toggled',
  AGENT_CARD_CLICKED: 'agent.card.clicked',
  AGENT_CONFIRM_CLICKED: 'agent.confirm.clicked',

  TOOLS_LOADED: 'tools.loaded',
  TOOLS_LOAD_FAILED: 'tools.load.failed',

  AGENT_CONFIG_LOADED: 'agent.config.loaded',
  AGENT_CONFIG_LOAD_FAILED: 'agent.config.load.failed',

  AGENT_CREATED: 'agent.created',
  AGENT_CREATE_FAILED: 'agent.create.failed',

  /* ---------- 侧栏 / 画布对象（迁移 4.2 / 4.3 用） ---------- */

  /* 业务聚焦：打开了哪个团队/节点。与区域聚焦 focusPath 是两回事。 */
  TEAM_FOCUS_CHANGED: 'team.focus.changed',
  /* 把团队卡片拖进垃圾桶：只是“想删”，团队仍在列表里直到 team.removed 回来。 */
  TEAM_DELETE_SUBMITTED: 'team.delete.submitted',
  TEAM_REMOVED: 'team.removed',
  TEAM_REMOVE_FAILED: 'team.remove.failed',

  /* 拖拽落点：用户把团队卡片拖到画布上（世界坐标），节点由业务层创建。 */
  NODE_DROP_SUBMITTED: 'node.drop.submitted',
  NODE_MOVED: 'node.moved',
  NODE_TASK_CHANGED: 'node.task.changed',
  NODE_HANDOFF_CHANGED: 'node.handoff.changed',
  NODE_SESSION_CHANGED: 'node.session.changed',
  NODE_ALERT_CLEARED: 'node.alert.cleared',
  NODE_REMOVED: 'node.removed',

  NODE_RUN_CLICKED: 'node.run.clicked',
  NODE_RUN_STOP_CLICKED: 'node.run.stop.clicked',
  NODE_RUN_STARTED: 'node.run.started',
  NODE_RUN_STOPPED: 'node.run.stopped',
  /* 轮询结果：启动失败、转录有新内容、结束后补刷会话列表。 */
  NODE_RUN_FAILED: 'node.run.failed',
  NODE_RUN_TRANSCRIPT_APPENDED: 'node.run.transcript.appended',
  NODE_RUN_SESSIONS_LOADED: 'node.run.sessions.loaded',

  EDGE_CREATED: 'edge.created',
  EDGE_FILES_CHANGED: 'edge.files.changed',

  /* ---------- 画布切片 ---------- */

  /* 整份场景换掉：进入工作区时装上这份流程，离开时清空。 */
  CANVAS_REPLACED: 'canvas.replaced',
  /* 局部替换：控制器把规则算出的新节点 / 连线数组写回切片（未给的数组不动）。 */
  CANVAS_PATCHED: 'canvas.patched',

  /* ---------- 会话 / 产物 ---------- */

  /* 结果屏里换了“要看哪段对话”：纯界面意图，由切片/效果去发 session.load。 */
  SESSION_VIEW_CHANGED: 'session.view.changed',
  /* 会话行的两个动作：点铅笔/垃圾桶只说明用户想改哪一段，具体结果回 renamed/removed。 */
  SESSION_RENAME_SUBMITTED: 'session.rename.submitted',
  SESSION_DELETE_CLICKED: 'session.delete.clicked',
  SESSION_LOADED: 'session.loaded',
  SESSION_LOAD_FAILED: 'session.load.failed',
  SESSION_RENAMED: 'session.renamed',
  SESSION_RENAME_FAILED: 'session.rename.failed',
  SESSION_REMOVED: 'session.removed',
  SESSION_DELETE_FAILED: 'session.delete.failed',

  /* 用户点了侧栏里的产物文件：打开右侧查看器，并由切片产出 artifact.read。 */
  ARTIFACT_OPEN_CLICKED: 'artifact.open.clicked',
  /* 正文已读到（previewable=false 表示类型不支持预览，面板照常打开）。 */
  ARTIFACT_OPENED: 'artifact.opened',
  ARTIFACT_OPEN_FAILED: 'artifact.open.failed',
  ARTIFACT_CLOSE_CLICKED: 'artifact.close.clicked',

  /* ---------- 工作区 / 设置（迁移 4.1 用） ---------- */

  /* 面板里的用户动作：选中、进入、新增、删除。只改界面状态或产出命令。 */
  WORKSPACE_SELECT_CLICKED: 'workspace.select.clicked',
  WORKSPACE_ENTER_CLICKED: 'workspace.enter.clicked',
  WORKSPACE_ADD_CLICKED: 'workspace.add.clicked',
  WORKSPACE_REMOVE_CLICKED: 'workspace.remove.clicked',
  WORKSPACE_RENAME_SUBMITTED: 'workspace.rename.submitted',
  /* 标题（hero）请求离开工作区：保存确认后由组装根落回旧业务。 */
  WORKSPACE_LEAVE_CLICKED: 'workspace.leave.clicked',
  /* 手动保存按钮：动作由组装根的保存控制器调 saver.flush()。 */
  WORKSPACE_SAVE_CLICKED: 'workspace.save.clicked',

  /* entered 是业务事实：决定要不要拉这个工作区的 nodes/edges。 */
  WORKSPACE_ENTERED: 'workspace.entered',
  WORKSPACE_ENTER_FAILED: 'workspace.enter.failed',
  WORKSPACE_LEFT: 'workspace.left',
  WORKSPACE_SELECTED: 'workspace.selected',
  WORKSPACE_ADDED: 'workspace.added',
  WORKSPACE_ADD_FAILED: 'workspace.add.failed',
  WORKSPACE_REMOVED: 'workspace.removed',
  WORKSPACE_REMOVE_FAILED: 'workspace.remove.failed',
  /* 保存器生命周期（idle / dirty / saving / saved / failed）镜像进新状态。 */
  WORKSPACE_SAVE_STATE_CHANGED: 'workspace.save.state.changed',
  WORKSPACE_SAVED: 'workspace.saved',
  WORKSPACE_SAVE_FAILED: 'workspace.save.failed',
  WORKSPACE_RENAMED: 'workspace.renamed',
  WORKSPACE_RENAME_FAILED: 'workspace.rename.failed',

  /* 模式只改本地选择；单人终端在“进入工作区”时才真正启动。 */
  SETTINGS_MODE_CHANGED: 'settings.mode.changed',

  AGENT_SAVED: 'agent.saved',
  AGENT_SAVE_FAILED: 'agent.save.failed',
});

/**
 * 每个事件能否改状态。当前接口结果都会更新 requests/草稿，所以都是 mutate；
 * 纯提示类（toast、动画结束）走 observe，聚焦类走 focus，后续按需登记。
 * @type {Record<string, UiEventKind>}
 */
export const EVENT_KINDS = Object.freeze({
  [EVENTS.PANEL_OPEN_CLICKED]: 'mutate',
  [EVENTS.PANEL_CLOSE_CLICKED]: 'mutate',
  [EVENTS.PANEL_TAB_CLICKED]: 'mutate',
  [EVENTS.FOCUS_CHANGED]: 'focus',
  [EVENTS.APP_STATUS_CHANGED]: 'mutate',
  [EVENTS.SETTINGS_LANG_CHANGED]: 'mutate',
  [EVENTS.SETTINGS_LANG_SUBMITTED]: 'mutate',
  [EVENTS.SETTINGS_LANG_FAILED]: 'mutate',
  [EVENTS.NOTICE_RAISED]: 'mutate',
  [EVENTS.NOTICE_DISMISSED]: 'mutate',
  [EVENTS.ANIM_DONE]: 'mutate',
  [EVENTS.REGION_RENDER_FAILED]: 'observe',
  [EVENTS.COMPONENT_SKIPPED]: 'observe',
  [EVENTS.AGENT_NAME_CHANGED]: 'mutate',
  [EVENTS.AGENT_TOOL_TOGGLED]: 'mutate',
  [EVENTS.AGENT_CARD_CLICKED]: 'mutate',
  [EVENTS.AGENT_CONFIRM_CLICKED]: 'mutate',
  [EVENTS.TOOLS_LOADED]: 'mutate',
  [EVENTS.TOOLS_LOAD_FAILED]: 'mutate',
  [EVENTS.AGENT_CONFIG_LOADED]: 'mutate',
  [EVENTS.AGENT_CONFIG_LOAD_FAILED]: 'mutate',
  [EVENTS.AGENT_CREATED]: 'mutate',
  [EVENTS.AGENT_CREATE_FAILED]: 'mutate',
  [EVENTS.AGENT_SAVED]: 'mutate',
  [EVENTS.AGENT_SAVE_FAILED]: 'mutate',

  /* 侧栏 / 画布：业务数据变化都进状态；聚焦是业务选中，不是区域聚焦。 */
  [EVENTS.TEAM_FOCUS_CHANGED]: 'mutate',
  [EVENTS.TEAM_DELETE_SUBMITTED]: 'mutate',
  [EVENTS.TEAM_REMOVED]: 'mutate',
  [EVENTS.TEAM_REMOVE_FAILED]: 'mutate',
  [EVENTS.NODE_DROP_SUBMITTED]: 'mutate',
  [EVENTS.NODE_MOVED]: 'mutate',
  [EVENTS.NODE_TASK_CHANGED]: 'mutate',
  [EVENTS.NODE_HANDOFF_CHANGED]: 'mutate',
  [EVENTS.NODE_SESSION_CHANGED]: 'mutate',
  [EVENTS.NODE_ALERT_CLEARED]: 'mutate',
  [EVENTS.NODE_REMOVED]: 'mutate',
  [EVENTS.NODE_RUN_CLICKED]: 'mutate',
  [EVENTS.NODE_RUN_STOP_CLICKED]: 'mutate',
  [EVENTS.NODE_RUN_STARTED]: 'mutate',
  [EVENTS.NODE_RUN_STOPPED]: 'mutate',
  [EVENTS.NODE_RUN_FAILED]: 'mutate',
  [EVENTS.NODE_RUN_TRANSCRIPT_APPENDED]: 'mutate',
  [EVENTS.NODE_RUN_SESSIONS_LOADED]: 'mutate',
  [EVENTS.EDGE_CREATED]: 'mutate',
  [EVENTS.EDGE_FILES_CHANGED]: 'mutate',
  [EVENTS.CANVAS_REPLACED]: 'mutate',
  [EVENTS.CANVAS_PATCHED]: 'mutate',
  [EVENTS.SESSION_VIEW_CHANGED]: 'mutate',
  [EVENTS.SESSION_RENAME_SUBMITTED]: 'mutate',
  [EVENTS.SESSION_DELETE_CLICKED]: 'mutate',
  [EVENTS.SESSION_LOADED]: 'mutate',
  [EVENTS.SESSION_LOAD_FAILED]: 'mutate',
  [EVENTS.SESSION_RENAMED]: 'mutate',
  [EVENTS.SESSION_RENAME_FAILED]: 'mutate',
  [EVENTS.SESSION_REMOVED]: 'mutate',
  [EVENTS.SESSION_DELETE_FAILED]: 'mutate',
  [EVENTS.ARTIFACT_OPEN_CLICKED]: 'mutate',
  [EVENTS.ARTIFACT_OPENED]: 'mutate',
  [EVENTS.ARTIFACT_OPEN_FAILED]: 'mutate',
  [EVENTS.ARTIFACT_CLOSE_CLICKED]: 'mutate',

  [EVENTS.WORKSPACE_SELECT_CLICKED]: 'mutate',
  [EVENTS.WORKSPACE_ENTER_CLICKED]: 'mutate',
  [EVENTS.WORKSPACE_ADD_CLICKED]: 'mutate',
  [EVENTS.WORKSPACE_REMOVE_CLICKED]: 'mutate',
  [EVENTS.WORKSPACE_RENAME_SUBMITTED]: 'mutate',
  [EVENTS.WORKSPACE_LEAVE_CLICKED]: 'mutate',
  [EVENTS.WORKSPACE_SAVE_CLICKED]: 'mutate',
  [EVENTS.WORKSPACE_ENTERED]: 'mutate',
  [EVENTS.WORKSPACE_ENTER_FAILED]: 'mutate',
  [EVENTS.WORKSPACE_LEFT]: 'mutate',
  [EVENTS.WORKSPACE_SELECTED]: 'mutate',
  [EVENTS.WORKSPACE_ADDED]: 'mutate',
  [EVENTS.WORKSPACE_ADD_FAILED]: 'mutate',
  [EVENTS.WORKSPACE_REMOVED]: 'mutate',
  [EVENTS.WORKSPACE_REMOVE_FAILED]: 'mutate',
  [EVENTS.WORKSPACE_SAVE_STATE_CHANGED]: 'mutate',
  [EVENTS.WORKSPACE_SAVED]: 'mutate',
  [EVENTS.WORKSPACE_SAVE_FAILED]: 'mutate',
  [EVENTS.WORKSPACE_RENAMED]: 'mutate',
  [EVENTS.WORKSPACE_RENAME_FAILED]: 'mutate',
  [EVENTS.SETTINGS_MODE_CHANGED]: 'mutate',
});

/** ---------------------------------------------------------------- 命令 */

export const COMMANDS = Object.freeze({
  TOOLS_LOAD: 'tools.load',                 // { requestId }
  AGENT_CONFIG_LOAD: 'agent.config.load',   // { requestId, agentId }
  AGENT_CREATE: 'agent.create',             // { requestId, name, tools }
  AGENT_CONFIG_SAVE: 'agent.config.save',   // { requestId, agentId, name, tools }

  /* 画布本地编辑（新建 / 移动 / 字段 / 连线）不是命令：
   * 规则在 ui/effects/canvas.js，控制器直接产出 canvas.patched；
   * 落盘统一由保存器负责，不需要 requestId。 */

  /* 后端动作：requestId 由 store 补，Effects 原样带回结果事件。
   * 运行（runNode / abortRun）与流程保存不经过命令链：组装根控制器直接调用
   * Run Effects 与保存器。这里列出的命令都必须有切片在产出。 */
  TEAM_REMOVE: 'team.remove',               // { requestId, teamId }
  SESSION_LOAD: 'session.load',             // { requestId, agentId, sessionId }
  SESSION_RENAME: 'session.rename',         // { requestId, agentId, sessionId, title }
  SESSION_DELETE: 'session.delete',         // { requestId, agentId, sessionId }
  ARTIFACT_READ: 'artifact.read',           // { requestId, path }

  /* ---------- 设置（迁移 4.5 用） ---------- */
  /* 语言偏好落盘是本地动作，不需要 requestId（将来同步用户偏好时再加）。 */
  SETTINGS_LANG_SET: 'settings.lang.set',   // { lang }

  /* ---------- 工作区（迁移 4.1 用） ---------- */
  WORKSPACE_ENTER: 'workspace.enter',       // { requestId, mode, workspaceId? }
  WORKSPACE_ADD: 'workspace.add',           // { requestId, name? }
  WORKSPACE_REMOVE: 'workspace.remove',     // { requestId, workspaceId }
  WORKSPACE_RENAME: 'workspace.rename',     // { requestId, workspaceId, name }
});

/**
 * 每条命令执行所需的 payload 字段。只校验“形状”（字段在不在、requestId 是不是
 * store 补的正整数），业务合法性仍归后端。
 * 新增命令必须在这里登记，否则 store 会拒发（架构/单元测试会先拦下）。
 * 本地命令不要求 requestId；只有真正打后端的命令才带。
 * @type {Record<string, readonly string[]>}
 */
export const COMMAND_PAYLOAD_FIELDS = Object.freeze({
  [COMMANDS.TOOLS_LOAD]: Object.freeze(['requestId']),
  [COMMANDS.AGENT_CONFIG_LOAD]: Object.freeze(['requestId', 'agentId']),
  [COMMANDS.AGENT_CREATE]: Object.freeze(['requestId', 'name', 'tools']),
  [COMMANDS.AGENT_CONFIG_SAVE]: Object.freeze(['requestId', 'agentId', 'name', 'tools']),

  [COMMANDS.TEAM_REMOVE]: Object.freeze(['requestId', 'teamId']),
  [COMMANDS.SESSION_LOAD]: Object.freeze(['requestId', 'agentId', 'sessionId']),
  [COMMANDS.SESSION_RENAME]: Object.freeze(['requestId', 'agentId', 'sessionId', 'title']),
  [COMMANDS.SESSION_DELETE]: Object.freeze(['requestId', 'agentId', 'sessionId']),
  [COMMANDS.ARTIFACT_READ]: Object.freeze(['requestId', 'path']),

  [COMMANDS.SETTINGS_LANG_SET]: Object.freeze(['lang']),

  [COMMANDS.WORKSPACE_ENTER]: Object.freeze(['requestId', 'mode']),
  [COMMANDS.WORKSPACE_ADD]: Object.freeze(['requestId']),
  [COMMANDS.WORKSPACE_REMOVE]: Object.freeze(['requestId', 'workspaceId']),
  [COMMANDS.WORKSPACE_RENAME]: Object.freeze(['requestId', 'workspaceId', 'name']),
});

/**
 * 派发前的命令形状检查。
 * @param {UiCommand} command
 * @returns {string | null} null = 合法；否则是可直接进日志的原因
 */
export function commandPayloadProblem(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    return '命令必须是对象';
  }
  const fields = COMMAND_PAYLOAD_FIELDS[command.type];
  if (!fields) return `未登记的命令：${command.type}`;

  const payload = command.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return `${command.type}: 缺少 payload 对象`;
  }
  for (const key of fields) {
    if (payload[key] === undefined || payload[key] === null) {
      return `${command.type}: payload.${key} 缺失`;
    }
  }
  if (!fields.includes('requestId')) return null;
  return Number.isInteger(payload.requestId) && payload.requestId > 0
    ? null
    : `${command.type}: payload.requestId 必须是正整数`;
}

export {};
