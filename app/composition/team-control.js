/* ===== 组装根：团队控制器 =====
 * 拖拽层只发 `team.delete.submitted`；删除请求由 `ui/effects/team.js` 走 Ports
 * （先删 Agent，再让服务端剪掉所有流程里的相关节点），结果回到新状态。
 *
 * 这里只补状态层不做的两件事：
 *   1. 结果落到画布切片：删掉该团队的节点以及落在这些节点上的线
 *      （其它流程由服务端的 pruneFlows 处理），并保存当前流程；
 *   2. 团队列表由 Effects 从 TeamReadModel 摘掉，侧栏聚焦由 sidebar 切片在
 *      `team.removed` 时自己收起，这里不再镜像任何字段。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { createTeamEffects } from '../ui/effects/team.js';

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   agentApi: import('../ui/contracts/ports.js').AgentApi,
 *   flowApi: import('../ui/contracts/ports.js').FlowApi,
 *   teamReadModel: ReturnType<typeof import('../ui/effects/team-read-model.js').createTeamReadModel>,
 *   saveFlow?: () => void,
 * }} options
 */
export function mountTeamControl({
  kernel,
  agentApi,
  flowApi,
  teamReadModel,
  saveFlow = () => {},
}) {
  if (!kernel || typeof kernel.dispatch !== 'function' || !kernel.store) {
    throw new Error('mountTeamControl: 需要 kernel');
  }

  const { store, dispatch } = kernel;

  const effects = createTeamEffects({
    agentApi,
    flowApi,
    teamReadModel,
    emit: (event) => void dispatch(event),
  });

  /* 结果事件 → 画布切片。删团队时连带删掉它的节点，以及落在这些
   * 节点上的线；其他流程由服务端的 pruneFlows 处理，本地只保存当前这一份。 */
  const mirrors = {
    [EVENTS.TEAM_REMOVED](payload) {
      const teamId = typeof payload.teamId === 'string' ? payload.teamId : '';
      if (!teamId) return;

      const canvas = store.getState().canvas || {};
      const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
      const edges = Array.isArray(canvas.edges) ? canvas.edges : [];
      const nextNodes = nodes.filter((node) => node.agentId !== teamId);

      if (nextNodes.length !== nodes.length) {
        const alive = new Set(nextNodes.map((node) => node.id));
        const nextEdges = edges.filter((edge) => alive.has(edge.from) && alive.has(edge.to));
        void dispatch({
          type: EVENTS.CANVAS_PATCHED,
          kind: 'mutate',
          payload: { nodes: nextNodes, edges: nextEdges },
        });
      }

      saveFlow();
    },
  };

  const offResults = store.subscribeEvent(({ event, accepted }) => {
    if (!accepted) return;
    const mirror = mirrors[event?.type];
    if (!mirror) return;
    mirror(event.payload || {});
  });

  let destroyed = false;
  return {
    effects,
    execute: effects.execute,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offResults();
    },
  };
}
