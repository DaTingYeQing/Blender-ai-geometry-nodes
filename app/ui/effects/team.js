/* ===== Effects：团队 =====
 * 命令 → Port → 结果事件；不碰 DOM、不直接改 State。
 *
 * 删除团队对齐旧 business/team.js：
 *   1. 删掉后端的 Agent；
 *   2. 让服务端把所有流程里指向它的节点一起清掉（pruneFlows）；
 *   3. 本地缓存摘掉这个团队，结果事件交给 state / 控制器收尾。
 * requestId 原样带回，状态层据此丢弃过期结果。
 */

import { EVENTS, EVENT_KINDS, COMMANDS } from '../contracts/events.js';

function messageOf(error) {
  return String(error?.message || error || '');
}

/**
 * @param {{
 *   agentApi: import('../contracts/ports.js').AgentApi,
 *   flowApi: import('../contracts/ports.js').FlowApi,
 *   teamReadModel: ReturnType<typeof import('./team-read-model.js').createTeamReadModel>,
 *   emit: (event: import('../contracts/events.js').UiEvent) => void,
 * }} deps
 */
export function createTeamEffects({ agentApi, flowApi, teamReadModel, emit }) {
  if (typeof emit !== 'function') throw new Error('createTeamEffects: 需要注入 emit(event)');

  function succeed(type, requestId, payload = {}) {
    emit({ type, kind: EVENT_KINDS[type] || 'mutate', requestId, payload });
  }

  function fail(type, requestId, error, extra = {}) {
    const payload = { ...extra, error: messageOf(error) };
    if (error?.code) payload.code = error.code;
    if (error?.status) payload.status = error.status;
    emit({ type, kind: EVENT_KINDS[type] || 'mutate', requestId, payload });
  }

  const handlers = {
    [COMMANDS.TEAM_REMOVE]: async ({ requestId, teamId }) => {
      if (!teamId) {
        fail(EVENTS.TEAM_REMOVE_FAILED, requestId, new Error('团队不存在'));
        return;
      }

      try {
        await agentApi.deleteAgent({ id: teamId });
        await flowApi.pruneFlows({ agentId: teamId });
        teamReadModel?.removeTeam?.(teamId);
        succeed(EVENTS.TEAM_REMOVED, requestId, { teamId });
      } catch (error) {
        fail(EVENTS.TEAM_REMOVE_FAILED, requestId, error, { teamId });
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

  return { execute };
}
