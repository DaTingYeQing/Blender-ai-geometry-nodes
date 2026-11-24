/* ===== 状态切片：会话（纯 reducer）=====
 * 侧栏结果屏只发“想看哪段 / 想改哪段 / 想删哪段”，这里把它们变成命令，
 * 并用 requestId 记住在飞请求。对话正文与团队列表属于 ReadModel，
 * 不在这里镜像；结果由 composition/session-control.js 写回读模型与画布切片。
 *
 * 行为对齐旧 business/agent.js：
 *   - 换会话总是重新拉一次（不因已有缓存跳过）；
 *   - 改名 / 删除不阻塞后续操作，最新请求说了算，过期回包按 requestId 丢弃；
 *   - 删除正在看的那段会话时，视图清空（正文缓存由控制器摘掉）。
 */

import { EVENTS, COMMANDS } from '../../contracts/events.js';

function noChange(state) {
  return { state, commands: [] };
}

function optionalId(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function withRequest(state, key, value) {
  return {
    ...state,
    session: {
      ...state.session,
      requests: { ...state.session.requests, [key]: value },
    },
  };
}

function requestOf(state, key) {
  return state.session?.requests?.[key] || { status: 'idle' };
}

/** 只有“正在等这个 requestId”的结果才算数，其余一律过期。 */
function isCurrent(request, requestId) {
  return requestId != null
    && request.status === 'loading'
    && request.requestId === requestId;
}


/** 视图只记“正在看哪一段”；同一段重复上报不产生新对象。 */
function setView(state, agentId, sessionId) {
  const view = state.session?.view || {};
  if (view.agentId === agentId && view.sessionId === sessionId) return state;
  return { ...state, session: { ...state.session, view: { agentId, sessionId } } };
}

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
    /* ---------- 读取一段对话 ---------- */

    case EVENTS.SESSION_VIEW_CHANGED: {
      const agentId = optionalId(payload.agentId) ?? optionalId(payload.teamId);
      const sessionId = optionalId(payload.sessionId);
      if (!agentId || !sessionId || requestId == null) return noChange(state);

      return {
        state: withRequest(
          setView(state, agentId, sessionId),
          'load',
          { status: 'loading', requestId },
        ),
        commands: [{
          type: COMMANDS.SESSION_LOAD,
          payload: { requestId, agentId, sessionId },
        }],
      };
    }

    case EVENTS.SESSION_LOADED: {
      if (!isCurrent(requestOf(state, 'load'), requestId)) return noChange(state);
      return {
        state: withRequest(state, 'load', { status: 'success', requestId }),
        commands: [],
      };
    }

    case EVENTS.SESSION_LOAD_FAILED: {
      if (!isCurrent(requestOf(state, 'load'), requestId)) return noChange(state);
      /* 换屏取消：在途请求被真正中止，收尾回 idle，不显示成失败。 */
      if (payload.code === 'aborted') {
        return {
          state: withRequest(state, 'load', { status: 'idle' }),
          commands: [],
        };
      }
      return {
        state: withRequest(state, 'load', {
          status: 'error',
          requestId,
          error: String(payload.error ?? ''),
        }),
        commands: [],
      };
    }

    /* ---------- 改名 ---------- */

    case EVENTS.SESSION_RENAME_SUBMITTED: {
      const agentId = optionalId(payload.agentId) ?? optionalId(payload.teamId);
      const sessionId = optionalId(payload.sessionId);
      const title = typeof payload.title === 'string' ? payload.title.trim() : '';
      if (!agentId || !sessionId || !title || requestId == null) return noChange(state);

      return {
        state: withRequest(state, 'rename', { status: 'loading', requestId }),
        commands: [{
          type: COMMANDS.SESSION_RENAME,
          payload: { requestId, agentId, sessionId, title },
        }],
      };
    }

    case EVENTS.SESSION_RENAMED: {
      if (!isCurrent(requestOf(state, 'rename'), requestId)) return noChange(state);
      return {
        state: withRequest(state, 'rename', { status: 'success', requestId }),
        commands: [],
      };
    }

    case EVENTS.SESSION_RENAME_FAILED: {
      if (!isCurrent(requestOf(state, 'rename'), requestId)) return noChange(state);
      return {
        state: withRequest(state, 'rename', {
          status: 'error',
          requestId,
          error: String(payload.error ?? ''),
        }),
        commands: [],
      };
    }

    /* ---------- 删除 ---------- */

    case EVENTS.SESSION_DELETE_CLICKED: {
      const agentId = optionalId(payload.agentId) ?? optionalId(payload.teamId);
      const sessionId = optionalId(payload.sessionId);
      if (!agentId || !sessionId || requestId == null) return noChange(state);

      return {
        state: withRequest(state, 'remove', { status: 'loading', requestId }),
        commands: [{
          type: COMMANDS.SESSION_DELETE,
          payload: { requestId, agentId, sessionId },
        }],
      };
    }

    case EVENTS.SESSION_REMOVED: {
      if (!isCurrent(requestOf(state, 'remove'), requestId)) return noChange(state);

      const sessionId = optionalId(payload.sessionId);
      const next = sessionId && state.session?.view?.sessionId === sessionId
        ? setView(state, null, null)
        : state;

      return {
        state: withRequest(next, 'remove', { status: 'success', requestId }),
        commands: [],
      };
    }

    case EVENTS.SESSION_DELETE_FAILED: {
      if (!isCurrent(requestOf(state, 'remove'), requestId)) return noChange(state);
      return {
        state: withRequest(state, 'remove', {
          status: 'error',
          requestId,
          error: String(payload.error ?? ''),
        }),
        commands: [],
      };
    }

    default:
      return noChange(state);
  }
}
