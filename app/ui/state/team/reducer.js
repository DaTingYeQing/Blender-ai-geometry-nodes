/* ===== 状态切片：团队（纯 reducer）=====
 * 团队卡片拖进垃圾桶只是“想删”：这里把它变成 team.remove 命令，
 * 并用 requestId 记住在飞请求。团队列表属于 TeamReadModel，
 * 节点 / 连线在 canvas 切片，聚焦在 sidebar 切片；
 * 删除结果由 composition/team-control.js 写回画布并保存当前流程。
 *
 * 行为对齐旧 business/team.js 的 TEAM_REMOVE：
 *   - 先删 Agent，再让服务端把所有流程里指向它的节点一起清掉；
 *   - 本地清掉团队、它的节点，以及连着这些节点的线；
 *   - 删的正好是当前聚焦的团队就收起侧栏（侧栏切片处理）。
 */

import { EVENTS, COMMANDS } from '../../contracts/events.js';

function noChange(state) {
  return { state, commands: [] };
}

function optionalId(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function requestOf(state) {
  return state.team?.requests?.remove || { status: 'idle' };
}

function isCurrent(request, requestId) {
  return requestId != null
    && request.status === 'loading'
    && request.requestId === requestId;
}

function withRequest(state, value) {
  return {
    ...state,
    team: { ...state.team, requests: { ...state.team?.requests, remove: value } },
  };
}

const IDLE = Object.freeze({ status: 'idle' });

/**
 * @param {import('../../contracts/state.js').UiState} state
 * @param {import('../../contracts/events.js').UiEvent} event
 * @returns {import('../../contracts/state.js').UiTransition}
 */
export function reduce(state, event) {
  const type = event?.type;
  const payload = event?.payload || {};
  const requestId = event?.requestId;

  switch (type) {
    case EVENTS.TEAM_DELETE_SUBMITTED: {
      const teamId = optionalId(payload.teamId);
      if (!teamId || requestId == null) return noChange(state);
      /* 同一条卡片被连点：只认在飞的那一次。 */
      if (requestOf(state).status === 'loading') return noChange(state);
      return {
        state: withRequest(state, { status: 'loading', requestId, teamId }),
        commands: [{
          type: COMMANDS.TEAM_REMOVE,
          payload: { requestId, teamId },
        }],
      };
    }

    case EVENTS.TEAM_REMOVED: {
      const request = requestOf(state);
      if (request.status !== 'loading') return noChange(state);
      if (!isCurrent(request, requestId)) return noChange(state);
      return { state: withRequest(state, IDLE), commands: [] };
    }

    case EVENTS.TEAM_REMOVE_FAILED: {
      const request = requestOf(state);
      if (!isCurrent(request, requestId)) return noChange(state);
      return { state: withRequest(state, IDLE), commands: [] };
    }

    default:
      return noChange(state);
  }
}
