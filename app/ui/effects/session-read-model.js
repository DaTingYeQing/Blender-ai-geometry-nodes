/* ===== 会话读模型（Effects 拥有）=====
 * 只读缓存：一段对话的正文按 agentId + sessionId 缓存；同一段并发只请求一次。
 * 轮询/转录追加走 appendEntries：缓存里还没有就不写，等下一次 getSession 拉全量。
 */

import { createResourceCache } from './read-model.js';

/**
 * @param {{
 *   agentApi: import('../contracts/ports.js').AgentApi,
 *   cache?: ReturnType<typeof createResourceCache>,
 * }} deps
 */
export function createSessionReadModel({ agentApi, cache = createResourceCache() }) {
  const keyOf = (agentId, sessionId) => `session:${agentId}:${sessionId}`;

  function assertIds(agentId, sessionId) {
    if (!agentId || !sessionId) throw new Error('session: 需要 agentId 与 sessionId');
  }

  function peek(agentId, sessionId) {
    const entry = cache.peek(keyOf(agentId, sessionId));
    return entry?.status === 'success' ? entry.data : null;
  }

  return {
    /** @param {{ force?: boolean }} [options] */
    getSession(agentId, sessionId, { force = false } = {}) {
      assertIds(agentId, sessionId);
      return cache.load(
        keyOf(agentId, sessionId),
        (signal) => agentApi.getSession({ agentId, sessionId, signal }),
        { force },
      );
    },

    /** 不触发请求的快照；没读过或失败时返回 null。 */
    peekSession(agentId, sessionId) {
      return peek(agentId, sessionId);
    },

    requestState(agentId, sessionId) {
      const entry = cache.peek(keyOf(agentId, sessionId));
      return entry ? { status: entry.status, error: entry.error } : { status: 'idle' };
    },

    /**
     * 轮询拿到新转录时追加。只在已缓存时生效，避免凭空造出半段对话。
     * @param {Array<Object>} entries
     */
    appendEntries(agentId, sessionId, entries) {
      if (!Array.isArray(entries) || entries.length === 0) return;
      const current = peek(agentId, sessionId);
      if (!current || !Array.isArray(current.entries)) return;
      cache.setData(keyOf(agentId, sessionId), {
        ...current,
        entries: [...current.entries, ...entries],
      });
    },

    invalidate(agentId, sessionId) {
      cache.invalidate(keyOf(agentId, sessionId));
    },

    clear() {
      cache.clear();
    },

    /** 换屏 / 销毁：会话正文只对当前屏幕有意义，在途请求直接中止。 */
    abortScreenScoped() {
      return cache.abortAll();
    },
  };
}
