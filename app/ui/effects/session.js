/* ===== Effects：会话读取 / 改名 / 删除 =====
 * 命令 → Port → 结果事件；不碰 DOM、不直接改 State。
 *
 * 读取走 SessionReadModel（强制刷新：每次换会话都要拿最新正文，缓存只作后续复用），
 * 改名 / 删除是写操作，直接调 AgentApi。requestId 原样带回，状态层据此丢弃过期结果。
 *
 * 失败也发结果事件（error / code / status），由状态层决定是否弹全局提示；
 * 旧业务“失败写进 sessionView、不抛错”的展示由组装根会话控制器负责。
 */

import { EVENTS, EVENT_KINDS, COMMANDS } from '../contracts/events.js';
import { createSessionReadModel } from './session-read-model.js';

function messageOf(error) {
  return String(error?.message || error || '');
}

/**
 * @param {{
 *   agentApi: import('../contracts/ports.js').AgentApi,
 *   sessionReadModel?: ReturnType<typeof createSessionReadModel>,
 *   emit: (event: import('../contracts/events.js').UiEvent) => void,
 * }} deps
 */
export function createSessionEffects({ agentApi, sessionReadModel, emit }) {
  if (typeof emit !== 'function') {
    throw new Error('createSessionEffects: 需要注入 emit(event)');
  }
  if (!agentApi || typeof agentApi.getSession !== 'function') {
    throw new Error('createSessionEffects: 需要 agentApi');
  }
  const model = sessionReadModel || createSessionReadModel({ agentApi });

  function succeed(type, requestId, payload = {}) {
    emit({ type, kind: EVENT_KINDS[type] || 'mutate', requestId, payload });
  }

  function fail(type, requestId, error, extra = {}) {
    /* code / status 来自 TransportError，供状态层判断是否值得弹全局提示；普通 Error 不带。
     * extra 带 agentId / sessionId，供结果事件把失败归到具体那一段。 */
    const payload = { ...extra, error: messageOf(error) };
    if (error?.code) payload.code = error.code;
    if (error?.status) payload.status = error.status;
    emit({ type, kind: EVENT_KINDS[type] || 'mutate', requestId, payload });
  }

  const handlers = {
    /* 结果屏下拉可能反复选同一段；每次都 force，保证看到的是最新正文。
     * ReadModel 仍会缓存最后一次结果，供区域/选择器复用。 */
    [COMMANDS.SESSION_LOAD]: async ({ requestId, agentId, sessionId }) => {
      try {
        const data = await model.getSession(agentId, sessionId, { force: true });
        succeed(EVENTS.SESSION_LOADED, requestId, {
          agentId,
          sessionId,
          entries: Array.isArray(data?.entries) ? data.entries : [],
          missing: Boolean(data?.missing),
        });
      } catch (error) {
        fail(EVENTS.SESSION_LOAD_FAILED, requestId, error, { agentId, sessionId });
      }
    },

    /* 后端是标题的权威来源；没回标题时退回用户输入（与旧业务一致）。 */
    [COMMANDS.SESSION_RENAME]: async ({ requestId, agentId, sessionId, title }) => {
      try {
        const data = await agentApi.renameSession({ agentId, sessionId, title });
        const next = String(data?.session?.title || title || '');
        succeed(EVENTS.SESSION_RENAMED, requestId, { agentId, sessionId, title: next });
      } catch (error) {
        fail(EVENTS.SESSION_RENAME_FAILED, requestId, error, { agentId, sessionId });
      }
    },

    /* 只删注册记录，不碰 pi 的会话文件；引用清理属于组装根控制器。 */
    [COMMANDS.SESSION_DELETE]: async ({ requestId, agentId, sessionId }) => {
      try {
        await agentApi.deleteSession({ agentId, sessionId });
        succeed(EVENTS.SESSION_REMOVED, requestId, { agentId, sessionId });
      } catch (error) {
        fail(EVENTS.SESSION_DELETE_FAILED, requestId, error, { agentId, sessionId });
      }
    },
  };

  /** 未登记的命令返回 false，方便发现漏接。 */
  async function execute(command) {
    const handler = handlers[command?.type];
    if (!handler) return false;
    await handler(command.payload || {}, command);
    return true;
  }

  return { execute, readModel: model };
}
