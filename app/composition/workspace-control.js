/* ===== 组装根：工作区控制器 =====
 * 设置面板只发命令；真正的进入 / 新增 / 删除 / 改名由 `ui/effects/workspace.js`
 * 走 Ports，结果事件再回到新状态。
 *
 * 这里只补状态层不做的两件事：
 *   1. 团队模式进入后，把整份 flow 经 `fromFlow` 装进画布切片；
 *   2. 改名改的是当前打开的流程时补一次保存（后端没有独立改名端点，名字随整份 PUT）。
 *
 * 工作区列表、选中与模式都写进新状态与 FlowReadModel，不再镜像任何旧字段。
 * 单人模式只启动外部终端，不进入团队画布（切片由 reducer 清空）。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { createWorkspaceEffects } from '../ui/effects/workspace.js';
import { fromFlow } from '../ui/state/canvas/codec.js';

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   flowReadModel: ReturnType<typeof import('../ui/effects/flow-read-model.js').createFlowReadModel>,
 *   teamReadModel: { peekTeams: () => Array<Object> },
 *   flowApi: import('../ui/contracts/ports.js').FlowApi,
 *   singleApi: import('../ui/contracts/ports.js').SingleApi,
 *   saveFlow?: () => void,
 * }} options
 */
export function mountWorkspaceControl({
  kernel,
  flowReadModel,
  teamReadModel,
  flowApi,
  singleApi,
  saveFlow = () => {},
}) {
  if (!kernel || typeof kernel.dispatch !== 'function' || !kernel.store) {
    throw new Error('mountWorkspaceControl: 需要 kernel');
  }
  if (!flowReadModel || typeof flowReadModel.getFlow !== 'function') {
    throw new Error('mountWorkspaceControl: 需要 FlowReadModel');
  }
  if (typeof teamReadModel?.peekTeams !== 'function') {
    throw new Error('mountWorkspaceControl: 需要 TeamReadModel.peekTeams()');
  }

  const { store, dispatch } = kernel;

  const effects = createWorkspaceEffects({
    flowApi,
    singleApi,
    flowReadModel,
    emit: (event) => void dispatch(event),
  });

  /* 结果事件 → 新状态 / 画布切片。团队进入把整份流程换进切片；
   * 单人模式只收起画布（entered 置空、切片清空都由 reducer 负责）。 */
  const mirrors = {
    [EVENTS.WORKSPACE_ENTERED](payload) {
      if (payload.mode === 'solo') return;
      const flow = payload.workspace;
      const loaded = flow ? fromFlow(flow, teamReadModel.peekTeams()) : null;
      if (!loaded) return;
      void dispatch({
        type: EVENTS.CANVAS_REPLACED,
        kind: 'mutate',
        payload: loaded,
      });
    },

    [EVENTS.WORKSPACE_RENAMED](payload) {
      const workspaceId = payload.workspaceId;
      const name = String(payload.name ?? '').trim();
      if (!workspaceId || !name) return;
      /* 改名也走整份保存（流程名跟着一起 PUT）；只有当前打开的流程会被保存。 */
      if (store.getState().workspace?.selectedId === workspaceId) saveFlow();
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
