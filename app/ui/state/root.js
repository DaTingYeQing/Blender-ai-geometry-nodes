/* ===== 根 reducer =====
 * 把事件分给对应的状态切片。目前有四块：
 *   - 聚焦路径 / 派生路由 / 应用状态 / 提示（跨区域，root 自己管）
 *   - 设置切片（语言、模式）
 *   - Agent 面板切片
 *   - 设置面板切片（logoPanel 的页签与关闭过渡）
 *   - 工作区切片（选中 / 进入 / 新增 / 删除）
 *   - 侧栏切片（展开哪个入口）
 *   - 团队切片（删除请求）
 *   - 会话切片（读取 / 改名 / 删除的结果屏请求）
 *   - 画布切片（节点 / 连线事实）
 *
 * 入口先过 guard：不合法的 mutate 直接丢弃，状态引用保持不变。
 * 新增切片时在这里登记，切片自己保持纯函数。
 */

import { EVENTS } from '../contracts/events.js';
import { shouldAccept } from './guard.js';
import { applyFocusChanged } from './focus.js';
import { syncRoute } from './route.js';
import { applyAppStatusChanged } from './app-status.js';
import {
  applyNoticeRaised,
  applyNoticeDismissed,
  withFailureNotice,
} from './notices.js';
import { reduce as reducePanels } from './panels.js';
import { reduce as reduceAgentPanel } from './agent-panel/reducer.js';
import { reduce as reduceLogoPanel } from './logo-panel.js';
import { reduce as reduceWorkspace } from './workspace/reducer.js';
import { reduce as reduceSidebar } from './sidebar/reducer.js';
import { reduce as reduceTeam } from './team/reducer.js';
import { reduce as reduceSession } from './session/reducer.js';
import { reduce as reduceCanvas } from './canvas/reducer.js';
import { reduce as reduceSave } from './save.js';
import { reduce as reduceArtifact } from './artifact/reducer.js';
import { applyLangChanged, applyModeChanged, reduce as reduceSettings } from './settings.js';

/**
 * 根 reducer 直接处理的跨区域事件；其余事件必须交给区域切片。
 * 架构测试会比对这份清单与下面的分支，防止根 reducer 悄悄长成万能 reducer。
 */
export const ROOT_EVENTS = Object.freeze([
  EVENTS.FOCUS_CHANGED,
  EVENTS.APP_STATUS_CHANGED,
  EVENTS.NOTICE_RAISED,
  EVENTS.NOTICE_DISMISSED,
  EVENTS.SETTINGS_LANG_CHANGED,
  EVENTS.SETTINGS_MODE_CHANGED,
]);

/**
 * @param {import('../contracts/state.js').UiState} state
 * @param {import('../contracts/events.js').UiEvent} event
 * @returns {import('../contracts/state.js').UiTransition}
 */
export function reduce(state, event) {
  if (!shouldAccept(state, event)) return { state, commands: [] };

  /* observe 只给记录员看，绝不进切片。 */
  if (event.kind === 'observe') return { state, commands: [] };

  if (event.type === EVENTS.FOCUS_CHANGED) {
    return { state: applyFocusChanged(state, event), commands: [] };
  }

  /* 应用可用状态是跨区域事实：只由组装根/Effects 上报。 */
  if (event.type === EVENTS.APP_STATUS_CHANGED) {
    return { state: applyAppStatusChanged(state, event), commands: [] };
  }

  /* 全局提示是跨区域事实。 */
  if (event.type === EVENTS.NOTICE_RAISED) {
    return { state: applyNoticeRaised(state, event.payload), commands: [] };
  }
  if (event.type === EVENTS.NOTICE_DISMISSED) {
    return { state: applyNoticeDismissed(state, event.payload), commands: [] };
  }

  /* 设置是全局事实：语言/模式一变，各区域按需重绘（它们自己订阅 store）。
   * 模式会影响屏幕，所以这里要同步派生路由。 */
  if (event.type === EVENTS.SETTINGS_LANG_CHANGED) {
    return { state: applyLangChanged(state, event.payload?.lang), commands: [] };
  }
  if (event.type === EVENTS.SETTINGS_MODE_CHANGED) {
    const modeChanged = applyModeChanged(state, event.payload?.mode);
    /* 模式一变：离开团队工作区、作废跨模式进入请求、清掉团队画布。 */
    const workspace = reduceWorkspace(modeChanged, event);
    const canvas = reduceCanvas(workspace.state, event);
    return {
      state: syncRoute(canvas.state),
      commands: [...(workspace.commands || []), ...(canvas.commands || [])],
    };
  }

  /* 其余事件按域分给切片；都忽略时状态引用不变。
   * 面板外壳（显隐 / 过渡）先跑，面板业务切片只处理自己的页签与草稿。 */
  const panels = reducePanels(state, event);
  const agent = reduceAgentPanel(panels.state, event);
  const logo = reduceLogoPanel(agent.state, event);
  const settings = reduceSettings(logo.state, event);
  const workspace = reduceWorkspace(settings.state, event);
  const sidebar = reduceSidebar(workspace.state, event);
  const team = reduceTeam(sidebar.state, event);
  const session = reduceSession(team.state, event);
  const save = reduceSave(session.state, event);
  const artifact = reduceArtifact(save.state, event);
  const canvas = reduceCanvas(artifact.state, event);
  const transition = {
    /* 路由是派生值：所有切片跑完后，用 workspace/mode 的事实对齐一次。
     * 只改 route，不动面板、焦点或在飞请求；子树挂载在 Phase 2。 */
    state: syncRoute(canvas.state),
    commands: [
      ...(panels.commands || []),
      ...(agent.commands || []),
      ...(logo.commands || []),
      ...(settings.commands || []),
      ...(workspace.commands || []),
      ...(sidebar.commands || []),
      ...(team.commands || []),
      ...(session.commands || []),
      ...(save.commands || []),
      ...(artifact.commands || []),
      ...(canvas.commands || []),
    ],
  };
  return withFailureNotice(state, transition, event);
}
