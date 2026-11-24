/* ===== Effects：工作区生命周期 =====
 * 命令 → Port → 结果事件；不碰 DOM、不直接改 State。
 *
 * 进入工作区分两条：
 *   - team：按 workspaceId 拉整份 flow（强制刷新，避免拿旧快照）；
 *   - solo：只启动外部终端，不进入团队画布。
 * requestId 原样带回，状态层据此丢弃过期结果。
 */

import { EVENTS, EVENT_KINDS, COMMANDS } from '../contracts/events.js';

function messageOf(error) {
  return String(error?.message || error || '');
}

/**
 * @param {{
 *   flowApi: import('../contracts/ports.js').FlowApi,
 *   singleApi: import('../contracts/ports.js').SingleApi,
 *   flowReadModel: ReturnType<typeof import('./flow-read-model.js').createFlowReadModel>,
 *   emit: (event: import('../contracts/events.js').UiEvent) => void,
 * }} deps
 */
export function createWorkspaceEffects({ flowApi, singleApi, flowReadModel, emit }) {
  if (typeof emit !== 'function') throw new Error('createWorkspaceEffects: 需要注入 emit(event)');

  function succeed(type, requestId, payload = {}) {
    emit({ type, kind: EVENT_KINDS[type] || 'mutate', requestId, payload });
  }

  function fail(type, requestId, error) {
    const payload = { error: messageOf(error) };
    if (error?.code) payload.code = error.code;
    if (error?.status) payload.status = error.status;
    emit({ type, kind: EVENT_KINDS[type] || 'mutate', requestId, payload });
  }

  const handlers = {
    [COMMANDS.WORKSPACE_ENTER]: async ({ requestId, mode, workspaceId }) => {
      /* 只认 'solo'，其余一律按团队模式处理，避免旧数据里的空值漏进事件。 */
      const enterMode = mode === 'solo' ? 'solo' : 'team';
      if (enterMode === 'solo') {
        try {
          await singleApi.launch();
          succeed(EVENTS.WORKSPACE_ENTERED, requestId, { mode: 'solo' });
        } catch (error) {
          fail(EVENTS.WORKSPACE_ENTER_FAILED, requestId, error);
        }
        return;
      }

      try {
        const workspace = workspaceId
          ? await flowReadModel.getFlow(workspaceId, { force: true })
          : null;
        succeed(EVENTS.WORKSPACE_ENTERED, requestId, { mode: enterMode, workspace });
      } catch (error) {
        fail(EVENTS.WORKSPACE_ENTER_FAILED, requestId, error);
      }
    },

    [COMMANDS.WORKSPACE_ADD]: async ({ requestId, name }) => {
      try {
        const workspace = await flowApi.createFlow(name ? { name } : undefined);
        flowReadModel.addFlow(workspace);
        succeed(EVENTS.WORKSPACE_ADDED, requestId, { workspace });
      } catch (error) {
        fail(EVENTS.WORKSPACE_ADD_FAILED, requestId, error);
      }
    },

    [COMMANDS.WORKSPACE_REMOVE]: async ({ requestId, workspaceId }) => {
      try {
        await flowApi.deleteFlow({ id: workspaceId });
        flowReadModel.removeFlow(workspaceId);
        succeed(EVENTS.WORKSPACE_REMOVED, requestId, { workspaceId });
      } catch (error) {
        fail(EVENTS.WORKSPACE_REMOVE_FAILED, requestId, error);
      }
    },

    /* 改名只改本地与读模型；后端没有单独的改名端点，流程名随整份保存一起 PUT。
     * 旧业务里“改的是当前打开的流程就顺手保存”由组装根控制器补上。
     * 空名在状态层已被拦下，这里再兜一次：不写读模型，但把请求收尾。 */
    [COMMANDS.WORKSPACE_RENAME]: async ({ requestId, workspaceId, name }) => {
      const trimmed = String(name ?? '').trim();
      if (workspaceId && trimmed) flowReadModel.renameFlow(workspaceId, trimmed);
      succeed(EVENTS.WORKSPACE_RENAMED, requestId, { workspaceId, name: trimmed });
    },
  };

  /** 未登记的命令返回 false，方便发现漏接。 */
  async function execute(command) {
    const handler = handlers[command?.type];
    if (!handler) return false;
    await handler(command.payload || {}, command);
    return true;
  }

  return { execute, readModel: flowReadModel };
}
