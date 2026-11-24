/* ===== 状态切片：侧栏（纯 reducer）=====
 * 侧栏自己要记得的只有“当前展开的是哪个入口”：
 *   团队 + 节点/连线 + 停在哪一屏（default / product / result）。
 * 团队列表、节点、连线、会话都属于 ReadModel / 画布，不在这里镜像。
 *
 * 行为对齐旧 business/team.js 的 TEAM_FOCUS：
 *   - 再点同一个入口（同团队 + 同节点 + 同连线 + 同屏）→ 收起；
 *   - 换节点或换屏只切换，不收起（副本本质上是两个节点）；
 *   - 没有团队就没有入口，直接收起。
 * 另外跟随工作区生命周期：离开工作区、单人模式进入时收起侧栏，
 * 与旧 workspace.js 的两处 focus 清零保持一致。
 */

import { EVENTS } from '../../contracts/events.js';

const PANES = new Set(['default', 'products', 'result']);

function noChange(state) {
  return { state, commands: [] };
}

/** 可选字符串：空串与非法值都当作“没有”。 */
function optionalId(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function normalizePane(value) {
  return PANES.has(value) ? value : 'default';
}

function cleared() {
  return { teamId: null, nodeId: null, edgeId: null, pane: 'default' };
}

function currentFocus(state) {
  return state.sidebar?.focus || cleared();
}

function sameFocus(a, b) {
  return a.teamId === b.teamId
    && a.nodeId === b.nodeId
    && a.edgeId === b.edgeId
    && a.pane === b.pane;
}

function setFocus(state, focus) {
  if (sameFocus(currentFocus(state), focus)) return noChange(state);
  return {
    state: { ...state, sidebar: { ...state.sidebar, focus } },
    commands: [],
  };
}

function clearFocus(state) {
  return setFocus(state, cleared());
}

/**
 * @param {import('../../contracts/state.js').UiState} state
 * @param {import('../../contracts/events.js').UiEvent} event
 * @returns {import('../../contracts/state.js').UiTransition}
 */
export function reduce(state, event) {
  const type = event?.type;
  const payload = event?.payload || {};

  switch (type) {
    /* 点入口：同入口再点一次就收起；换视图 / 换节点只切换。 */
    case EVENTS.TEAM_FOCUS_CHANGED: {
      const teamId = optionalId(payload.teamId);
      const nodeId = optionalId(payload.nodeId);
      const edgeId = optionalId(payload.edgeId);
      const pane = teamId ? normalizePane(payload.pane) : 'default';
      const cur = currentFocus(state);

      if (!teamId) return clearFocus(state);

      const collapsing = cur.teamId === teamId
        && cur.nodeId === nodeId
        && cur.edgeId === edgeId
        && cur.pane === pane;

      return collapsing
        ? clearFocus(state)
        : setFocus(state, { teamId, nodeId, edgeId, pane });
    }

    /* 团队被删：只清理属于它的展开态，别的团队不受影响。 */
    case EVENTS.TEAM_REMOVED: {
      const teamId = optionalId(payload.teamId ?? payload.id);
      const cur = currentFocus(state);
      if (!cur.teamId) return noChange(state);
      if (teamId && cur.teamId !== teamId) return noChange(state);
      return clearFocus(state);
    }

    /* 离开工作区：侧栏立刻收回（旧业务也是在这里清 focus）。 */
    case EVENTS.WORKSPACE_LEFT:
      return clearFocus(state);

    /* 单人模式没有团队画布，进入后同样收起侧栏。 */
    case EVENTS.WORKSPACE_ENTERED:
      return payload.mode === 'solo' ? clearFocus(state) : noChange(state);

    default:
      return noChange(state);
  }
}
