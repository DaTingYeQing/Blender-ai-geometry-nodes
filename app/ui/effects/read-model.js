/* ===== ReadModel / ResourceCache（由 Effects 拥有）=====
 * UI State 管“界面想怎样”，这里管“后端现在是什么”。
 *
 * 职责：
 *   - 缓存后端只读数据：Agent 列表、工具目录、单个 Agent 配置。
 *   - 同一 key 的并发请求合并成一次（去重）。
 *   - force / invalidate 后重新拉取；force 会真正中止上一轮传输。
 *   - 用 seq 丢弃“旧请求晚到”的写入，避免把新数据覆盖回旧值。
 *   - abort / abortAll / abortWhere：换屏或销毁时停掉不再需要的请求。
 *
 * 这里可以持有 Promise / AbortController（属于 Effects，不是 UiState），
 * 所以不受“可序列化”约束。
 */

/**
 * @typedef {Object} CacheEntry
 * @property {'loading' | 'success' | 'error'} status
 * @property {unknown} [data]
 * @property {string} [error]
 * @property {Promise<unknown>} [promise]
 * @property {AbortController} [controller]
 * @property {number} seq
 */

export function createResourceCache() {
  /** @type {Map<string, CacheEntry>} */
  const entries = new Map();

  /** 取消并清掉一个 key：在途请求会以 aborted 拒绝，调用方负责丢弃。 */
  function abort(key) {
    const entry = entries.get(key);
    if (!entry) return false;
    entry.controller?.abort();
    entries.delete(key);
    return true;
  }

  /**
   * 取数据：成功过就直接返回；正在加载就复用同一个 Promise。
   * force 时先中止上一轮同 key 请求，保证只有最新一轮在传输。
   * @param {string} key
   * @param {(signal: AbortSignal) => Promise<any>} loader
   * @param {{ force?: boolean }} [options]
   */
  function load(key, loader, { force = false } = {}) {
    const current = entries.get(key);

    if (!force && current?.status === 'success') {
      return Promise.resolve(current.data);
    }
    if (!force && current?.status === 'loading' && current.promise) {
      return current.promise;
    }

    /* force 换新：旧的那一轮（如果有）直接中止，晚到也不会再写缓存。 */
    if (current?.status === 'loading') current.controller?.abort();

    const seq = (current?.seq || 0) + 1;
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const data = await loader(controller.signal);
        /* 只有还是自己这一轮，才允许写缓存（旧请求晚到 / 已取消都丢掉）。 */
        if (entries.get(key)?.seq === seq) {
          entries.set(key, { status: 'success', data, seq });
        }
        return data;
      } catch (error) {
        if (entries.get(key)?.seq === seq) {
          entries.set(key, {
            status: 'error',
            error: String(error?.message || error || ''),
            seq,
          });
        }
        throw error;
      }
    })();

    entries.set(key, { status: 'loading', promise, controller, seq });
    return promise;
  }

  function peek(key) {
    return entries.get(key) || null;
  }

  function setData(key, data) {
    entries.get(key)?.controller?.abort();
    const seq = (entries.get(key)?.seq || 0) + 1;
    entries.set(key, { status: 'success', data, seq });
  }

  function invalidate(key) {
    abort(key);
  }

  /** 按 key 规则批量取消（例如只停某个前缀的屏幕级请求）。 */
  function abortWhere(predicate) {
    if (typeof predicate !== 'function') return 0;
    let count = 0;
    for (const key of [...entries.keys()]) {
      if (predicate(key) && abort(key)) count += 1;
    }
    return count;
  }

  /** 全部取消：换屏 / 销毁时调用，在途请求不会再把结果写回来。返回取消的条数。 */
  function abortAll() {
    let count = 0;
    for (const entry of entries.values()) {
      if (entry.controller) {
        entry.controller.abort();
        count += 1;
      }
    }
    entries.clear();
    return count;
  }

  function clear() {
    return abortAll();
  }

  return { load, peek, setData, invalidate, abort, abortWhere, abortAll, clear };
}

/**
 * Agent 领域的读模型。key 规则集中在这里，Effects 和 Selectors 不用自己拼字符串。
 *
 * @param {{ agentApi: import('../contracts/ports.js').AgentApi, cache?: ReturnType<typeof createResourceCache> }} deps
 */
export function createAgentReadModel({ agentApi, cache = createResourceCache() }) {
  const AGENTS = 'agents';
  const TOOLS = 'tools';
  const configKey = (agentId) => `agentConfig:${agentId}`;

  return {
    /* ---------- 读取 ---------- */

    getAgents() {
      return cache.load(AGENTS, (signal) => agentApi.listAgents({ signal }));
    },

    getTools() {
      return cache.load(TOOLS, (signal) => agentApi.getTools({ signal }));
    },

    getAgentConfig(agentId) {
      return cache.load(
        configKey(agentId),
        (signal) => agentApi.getAgentConfig({ agentId, signal }),
      );
    },

    /* ---------- 给 Selectors / View 的快照（不触发请求） ---------- */

    peekAgents() {
      const entry = cache.peek(AGENTS);
      return entry?.status === 'success' && Array.isArray(entry.data) ? entry.data : [];
    },

    peekTools() {
      const entry = cache.peek(TOOLS);
      return entry?.status === 'success' && entry.data
        ? entry.data
        : { tools: [], profiles: {} };
    },

    peekAgentConfig(agentId) {
      const entry = cache.peek(configKey(agentId));
      return entry?.status === 'success' ? entry.data : null;
    },

    requestState(key) {
      const entry = cache.peek(key);
      return entry ? { status: entry.status, error: entry.error } : { status: 'idle' };
    },

    /* ---------- 失效 / 局部更新 ---------- */

    invalidateConfig(agentId) {
      cache.invalidate(configKey(agentId));
    },

    /** 换屏 / 关面板：只停在途的 Agent 配置读取，列表与工具目录都还要用。 */
    abortScreenScoped() {
      return cache.abortWhere((key) => key.startsWith('agentConfig:'));
    },

    /** 创建 / 保存成功后，把服务端返回的 agent 合并进已缓存的列表。 */
    upsertAgent(agent) {
      if (!agent?.id) return;
      const entry = cache.peek(AGENTS);
      if (entry?.status !== 'success' || !Array.isArray(entry.data)) return;

      const exists = entry.data.some((item) => item.id === agent.id);
      const data = exists
        ? entry.data.map((item) => (item.id === agent.id ? { ...item, ...agent } : item))
        : [...entry.data, agent];
      cache.setData(AGENTS, data);
    },

    /** 删除成功后从缓存里摘掉；没缓存过就什么都不做（下次读会重新拉）。 */
    removeAgent(agentId) {
      if (!agentId) return;
      const entry = cache.peek(AGENTS);
      if (entry?.status !== 'success' || !Array.isArray(entry.data)) return;
      cache.setData(AGENTS, entry.data.filter((item) => item.id !== agentId));
    },

    /** 改名 / 其它字段更新后合并进已缓存的 Agent（含 sessions 列表）。 */
    patchSession(agentId, sessionId, patch) {
      if (!agentId || !sessionId || !patch) return;
      const entry = cache.peek(AGENTS);
      if (entry?.status !== 'success' || !Array.isArray(entry.data)) return;
      cache.setData(AGENTS, entry.data.map((agent) => {
        if (agent.id !== agentId || !Array.isArray(agent.sessions)) return agent;
        return {
          ...agent,
          sessions: agent.sessions.map((session) => (
            session.id === sessionId ? { ...session, ...patch } : session
          )),
        };
      }));
    },

    /** 删除成功后同步摘掉会话；Agent 本身保留。 */
    removeSession(agentId, sessionId) {
      if (!agentId || !sessionId) return;
      const entry = cache.peek(AGENTS);
      if (entry?.status !== 'success' || !Array.isArray(entry.data)) return;
      cache.setData(AGENTS, entry.data.map((agent) => {
        if (agent.id !== agentId || !Array.isArray(agent.sessions)) return agent;
        return { ...agent, sessions: agent.sessions.filter((item) => item.id !== sessionId) };
      }));
    },

    /** 运行收尾拿到整份会话列表时直接替换（后端是权威来源）。 */
    setSessions(agentId, sessions) {
      if (!agentId) return;
      const entry = cache.peek(AGENTS);
      if (entry?.status !== 'success' || !Array.isArray(entry.data)) return;
      const next = Array.isArray(sessions) ? sessions : [];
      cache.setData(AGENTS, entry.data.map((agent) => (
        agent.id === agentId ? { ...agent, sessions: next } : agent
      )));
    },
  };
}
