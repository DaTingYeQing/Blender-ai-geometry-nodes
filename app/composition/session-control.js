/* ===== 组装根：会话控制器 =====
 * 侧栏结果屏只发“看 / 改名 / 删”三种意图；命令由 `ui/effects/session.js`
 * 走 AgentApi，结果事件再回到新状态。
 *
 * 这里只补状态层不做的三件事：
 *   1. 改名成功 → 把新标题合并进 AgentReadModel（团队会话下拉与行标题）；
 *   2. 删除成功 → 从读模型摘掉会话，并把复用它的画布节点改回“新会话”后保存；
 *   3. 读模型变化后通知组装根重画侧栏（状态层不会为这类更新额外派发事件）。
 *
 * 正文不在这里镜像：结果屏按 `session.view` 直接读 SessionReadModel 的缓存。
 * 过期回包只凭 requestId 判断：状态层先更新请求，再通知事件，所以这里读到的
 * `session.requests.*.requestId` 就是“当前还在等的那一次”。不是它的一律不写。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { createSessionEffects } from '../ui/effects/session.js';

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   agentReadModel: {
 *     peekAgents: () => Array<Object>,
 *     patchSession: (agentId: string, sessionId: string, patch: Object) => void,
 *     removeSession: (agentId: string, sessionId: string) => void,
 *   },
 *   agentApi: import('../ui/contracts/ports.js').AgentApi,
 *   sessionReadModel?: ReturnType<typeof import('../ui/effects/session-read-model.js').createSessionReadModel>,
 *   saveFlow?: () => void,
 *   onReadModelChange?: () => void,
 * }} options
 */
export function mountSessionControl({
  kernel,
  agentReadModel,
  agentApi,
  sessionReadModel,
  saveFlow = () => {},
  onReadModelChange = () => {},
}) {
  if (!kernel || typeof kernel.dispatch !== 'function' || !kernel.store) {
    throw new Error('mountSessionControl: 需要 kernel');
  }
  if (!agentReadModel || typeof agentReadModel.patchSession !== 'function'
    || typeof agentReadModel.removeSession !== 'function') {
    throw new Error('mountSessionControl: 需要 AgentReadModel 的会话更新方法');
  }
  if (!agentApi || typeof agentApi.getSession !== 'function' || typeof agentApi.deleteSession !== 'function') {
    throw new Error('mountSessionControl: 需要 AgentApi');
  }

  const { store, dispatch } = kernel;

  const effects = createSessionEffects({
    agentApi,
    sessionReadModel,
    emit: (event) => void dispatch(event),
  });

  /** 这条结果是不是当前请求的（状态层已先把 request 更新到同一个 requestId）。 */
  function isCurrent(key, event) {
    const request = store.getState().session?.requests?.[key];
    return event?.requestId != null && request?.requestId === event.requestId;
  }

  /** 内部 id → 那一行会话记录（带 piSessionId），读模型里没有就返回 null。 */
  function sessionOf(agentId, sessionId) {
    const agent = agentReadModel.peekAgents().find((item) => item.id === agentId) || null;
    const sessions = Array.isArray(agent?.sessions) ? agent.sessions : [];
    return sessions.find((item) => item.id === sessionId) || null;
  }

  const mirrors = {
    [EVENTS.SESSION_RENAMED](event) {
      if (!isCurrent('rename', event)) return;
      const { agentId, sessionId } = event.payload || {};
      if (!agentId || !sessionId) return;
      const title = String(event.payload.title ?? '');
      agentReadModel.patchSession(agentId, sessionId, { title });
      onReadModelChange();
    },

    [EVENTS.SESSION_REMOVED](event) {
      if (!isCurrent('remove', event)) return;
      const { agentId, sessionId } = event.payload || {};
      if (!agentId || !sessionId) return;

      /* 有节点复用它就改回“新会话”，流程要跟着存。 */
      const canvas = store.getState().canvas || {};
      const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
      let touched = false;
      const nextNodes = nodes.map((node) => {
        if (node.sessionId !== sessionId) return node;
        touched = true;
        return { ...node, sessionId: null, sessionMode: 'new' };
      });

      agentReadModel.removeSession(agentId, sessionId);
      onReadModelChange();

      if (touched) {
        void dispatch({
          type: EVENTS.CANVAS_PATCHED,
          kind: 'mutate',
          payload: { nodes: nextNodes },
        });
      }
      saveFlow();
    },
  };

  const offResults = store.subscribeEvent(({ event, accepted }) => {
    if (!accepted) return;
    const mirror = mirrors[event?.type];
    if (!mirror) return;
    mirror(event);
  });

  let destroyed = false;
  return {
    effects,
    execute: effects.execute,
    sessionOf,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offResults();
    },
  };
}
