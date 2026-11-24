/* ===== 组件类型名 =====
 * 区域按名字向注册表取组件，所以名字必须放在契约里，
 * 不能让区域 import 具体组件实现（component.md）。
 */

export const AGENT_PANEL_COMPONENT = Object.freeze({
  TABS: 'agent-tabs',
  LIST: 'agent-list',
  HEADING: 'agent-heading',
  NAME_FIELD: 'agent-name-field',
  TOOL_PICKER: 'agent-tool-picker',
  STATUS: 'agent-status',
  ACTIONS: 'agent-actions',
});

/* 设置面板（logoPanel）：左栏导航 + 语言/模式滑块 + 工作区列表 + 底栏。 */
export const LOGO_PANEL_COMPONENT = Object.freeze({
  NAV: 'logo-nav',
  LANG_TOGGLE: 'lang-toggle',
  MODE_TOGGLE: 'mode-toggle',
  WORKSPACE_LIST: 'workspace-list',
  WORKSPACE_ACTIONS: 'workspace-actions',
});

/* 侧栏：团队列表（卡片由组件内部按 key 复用）。 */
export const SIDEBAR_COMPONENT = Object.freeze({
  TEAM_LIST: 'sidebar-team-list',
});

/* 画布：场景容器 + 连线层 + 单个节点。 */
export const CANVAS_COMPONENT = Object.freeze({
  SCENE: 'canvas-scene',
  EDGE_LAYER: 'canvas-edge-layer',
  NODE: 'canvas-node',
});

/* 产物查看器：右侧面板的头部与正文（宽度拖拽属于区域本地行为）。 */
export const ARTIFACT_COMPONENT = Object.freeze({
  VIEW: 'artifact-view',
});
