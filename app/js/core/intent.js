/* ===== 意图名（契约层）=====
 * 这里只有名字，没有任何实现。
 * UI 组件发名字，业务 handler 收名字，两边互不相见 —— 这份表是唯一的共同语言。
 *
 * 分两组：
 *   BIZ —— 业务意图。有后端语义，将来每一条对应一个 REST 端点。
 *   UI  —— 界面意图。只改界面自身状态（面板开关、导航页），不上后端。
 *
 * 命名约定：名词.动词。动词一律用原形，不带时态。
 */

export const BIZ = {
  /* ---- 团队 ---- */
  TEAM_CREATE: 'team.create',          // { name }                    → 新团队
  TEAM_FOCUS: 'team.focus',            // { teamId, nodeId, pane }    → 聚焦某个节点（侧栏展开；nodeId 记归属）
  TEAM_REMOVE: 'team.remove',          // { teamId }                  → 删团队（连带节点与连线）

  /* ---- 画布对象 ---- */
  NODE_CREATE: 'node.create',          // { agentId, x, y }           → 在画布放一个节点
  NODE_MOVE: 'node.move',              // { id, x, y }                → 节点落位
  NODE_TASK_SET: 'node.task.set',      // { id, task }                → 节点的任务描述（后端运行时必填）
  NODE_HANDOFF_SET: 'node.handoff.set', // { id, handoffEnabled }     → 是否把上游产物目录传给下游
  NODE_SESSION_SET: 'node.session.set', // { id, sessionMode }        → 新开会话 'new' / 复用 'reuse'
  NODE_SESSION_SELECT: 'node.session.select', // { id, sessionId }     → 复用哪一段对话
  NODE_REMOVE: 'node.remove',          // { id }                      → 删节点（连带连线）
  EDGE_CREATE: 'edge.create',          // { from, to }                → 拉一条线
  EDGE_FILES_SET: 'edge.files.set',    // { id, files }               → 这条线往下游传哪些产物

  /* ---- 节点提醒 ---- */
  NODE_ALERT_RAISE: 'node.alert.raise', // { id }                     → 该节点需要处理（冒感叹号）
  NODE_ALERT_CLEAR: 'node.alert.clear', // { id }                     → 处理完了（感叹号消失）

  /* ---- 节点运行状态 ---- */
  NODE_RUN_START: 'node.run.start',    // { id }                      → 开始干活（右上角冒扩散环）
  NODE_RUN_STOP: 'node.run.stop',      // { id }                      → 干完了（环消失）

  /* ---- 工作区 ---- */
  WORKSPACE_ENTER: 'workspace.enter',  // {}                          → 进入工作区视图
  WORKSPACE_LEAVE: 'workspace.leave',  // {}                          → 退回首页
  WORKSPACE_SET_MODE: 'workspace.setMode', // { mode }                → 团队 / 单人
  WORKSPACE_SELECT: 'workspace.select', // { id }                     → 面板里选中某个方框
  WORKSPACE_ADD: 'workspace.add',       // {}                         → 新增一个工作区方框
  WORKSPACE_REMOVE: 'workspace.remove', // { id }                     → 删除一个工作区方框
  WORKSPACE_RENAME: 'workspace.rename', // { id, name }               → 重命名一个工作区方框

  /* ---- agent ---- */
  AGENT_REGISTER: 'agent.register',    // { address }                 → 注册 agent
  SESSION_LOAD: 'session.load',        // { agentId, sessionId }      → 读取一段对话，结果屏显示
  SESSION_RENAME: 'session.rename',    // { agentId, sessionId, title } → 重命名对话
  SESSION_DELETE: 'session.delete',    // { agentId, sessionId }      → 删除对话记录
  ARTIFACTS_LOAD: 'artifacts.load',    // { id }                      → 读节点最近一次运行的产物列表

  /* ---- 设置 ---- */
  SETTINGS_SET_LANG: 'settings.setLang', // { lang }                  → 切换语言
};

export const UI = {
  PANEL_OPEN: 'ui.panel.open',         // { id }                      → 打开面板
  PANEL_CLOSE: 'ui.panel.close',       // { id }                      → 关闭面板
  PANEL_NAV: 'ui.panel.nav',           // { nav }                     → 切换面板左栏页
};
