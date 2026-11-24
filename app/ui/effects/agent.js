/* ===== Effects：Agent 配置面板的用例 =====
 * 消费 State 产出的命令，调用注入的 Port，再把结果变回 UI 事件。
 *
 * 纪律（effects.md）：
 *   - 不碰 DOM，不直接改 State。
 *   - 只认注入的 Port，不 import 具体 Adapter。
 *   - 不偷偷读 state；命令载荷带齐执行所需的数据。
 *   - 请求编号原样带回事件里，由状态层决定是否采纳。
 */

import { EVENTS, EVENT_KINDS, COMMANDS } from '../contracts/events.js';
import { createAgentReadModel } from './read-model.js';

function messageOf(error) {
  return String(error?.message || error || '');
}

/**
 * @param {{
 *   agentApi: import('../contracts/ports.js').AgentApi,
 *   readModel?: ReturnType<typeof createAgentReadModel>,
 *   emit: (event: import('../contracts/events.js').UiEvent) => void,
 * }} deps
 */
export function createAgentEffects({ agentApi, readModel, emit }) {
  if (typeof emit !== 'function') {
    throw new Error('createAgentEffects: 需要注入 emit(event)');
  }
  const model = readModel || createAgentReadModel({ agentApi });

  function succeed(type, requestId, payload = {}) {
    emit({ type, kind: EVENT_KINDS[type] || 'mutate', requestId, payload });
  }

  function fail(type, requestId, error) {
    /* code / status 来自 TransportError，供状态层判断是否值得弹全局提示；普通 Error 不带。 */
    const payload = { error: messageOf(error) };
    if (error?.code) payload.code = error.code;
    if (error?.status) payload.status = error.status;

    emit({
      type,
      kind: EVENT_KINDS[type] || 'mutate',
      requestId,
      payload,
    });
  }

  const handlers = {
    /* 工具目录：成功的数据同时进 ReadModel；事件只报告请求结果。 */
    [COMMANDS.TOOLS_LOAD]: async (payload, command) => {
      const requestId = payload.requestId ?? command.requestId;
      try {
        const data = await model.getTools();
        succeed(EVENTS.TOOLS_LOADED, requestId, {
          tools: data?.tools || [],
          profiles: data?.profiles || {},
        });
      } catch (error) {
        fail(EVENTS.TOOLS_LOAD_FAILED, requestId, error);
      }
    },

    /* 读取单个 Agent 的配置，原样交给状态层判断该不该覆盖草稿。 */
    [COMMANDS.AGENT_CONFIG_LOAD]: async (payload, command) => {
      const requestId = payload.requestId ?? command.requestId;
      const { agentId } = payload;
      try {
        const data = await model.getAgentConfig(agentId);
        succeed(EVENTS.AGENT_CONFIG_LOADED, requestId, {
          agentId,
          agent: data?.agent,
          config: data?.config,
        });
      } catch (error) {
        fail(EVENTS.AGENT_CONFIG_LOAD_FAILED, requestId, error);
      }
    },

    /* 新建 Agent：这是写操作，不走缓存；成功后才合并进 Agent 列表。 */
    [COMMANDS.AGENT_CREATE]: async (payload, command) => {
      const requestId = payload.requestId ?? command.requestId;
      const { name, tools } = payload;
      try {
        const agent = await agentApi.createAgent({ name, tools });
        model.upsertAgent(agent);
        model.invalidateConfig(agent?.id);
        succeed(EVENTS.AGENT_CREATED, requestId, { agent });
      } catch (error) {
        fail(EVENTS.AGENT_CREATE_FAILED, requestId, error);
      }
    },

    /* 保存配置：成功后才更新权威展示；缓存的配置作废，下次读取重新拉。 */
    [COMMANDS.AGENT_CONFIG_SAVE]: async (payload, command) => {
      const requestId = payload.requestId ?? command.requestId;
      const { agentId, name, tools } = payload;
      try {
        const data = await agentApi.saveAgentConfig({ agentId, name, tools });
        const agent = data?.agent || { id: agentId, name };
        model.upsertAgent(agent);
        model.invalidateConfig(agentId);
        succeed(EVENTS.AGENT_SAVED, requestId, { agent });
      } catch (error) {
        fail(EVENTS.AGENT_SAVE_FAILED, requestId, error);
      }
    },
  };

  /** 执行一条命令。未登记的命令返回 false，方便发现漏接。 */
  async function execute(command) {
    const handler = handlers[command?.type];
    if (!handler) return false;
    await handler(command.payload || {}, command);
    return true;
  }

  return { execute, readModel: model };
}
