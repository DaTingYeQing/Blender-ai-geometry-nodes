/* ===== 组装根：画布控制器 =====
 * 4.3：画布只发“用户做了什么”，规则在 `ui/effects/canvas.js`，这里把规则
 * 算出的新节点 / 连线数组用 CANVAS_PATCHED 写回画布切片，并按需打“未保存”标记。
 *
 * 除手势外，侧栏与拖拽落点也走这里：新建节点、任务/上游产物/会话模式/连线文件、
 * 运行与中止。旧 `business/canvas.js` 已整块删除，避免同一次交互走两条路径。
 *
 * 过渡期分工：
 *   - 画布区域：手势 + 渲染，只发事件；
 *   - 本控制器：被采纳的事件 → Effects 规则 → CANVAS_PATCHED（画布切片是事实源）；
 *   - 团队颜色来自 TeamReadModel（由组装根注入 getTeams）。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { createCanvasEffects } from '../ui/effects/canvas.js';
import { hsl } from '../ui/platform/theme.js';

/* 节点 / 连线只是本地视图对象，后端只认整份流程。
 * 页面内自增 id：组装根没注入 makeId 时的兜底；跨刷新唯一由组装根注入
 * （时间戳 + 自增），控制器本身不读时钟。 */
let localSeq = 0;
function nextLocalId(prefix) {
  localSeq += 1;
  return `${prefix}-${localSeq}`;
}

function teamColorsOf(teams) {
  return (Array.isArray(teams) ? teams : []).map((team) => ({
    id: team.id,
    color: hsl(team),
  }));
}

/**
 * @param {{
 *   store: {
 *     getState: () => any,
 *     dispatch: (event: any) => any,
 *     subscribeEvent: (fn: (info: { event: any, accepted: boolean }) => void) => () => void,
 *   },
 *   getTeams?: () => Array<Object>,
 *   saveFlow?: () => void,
 *   translate?: (text: string) => string,
 *   onError?: (message: string) => void,
 *   effects?: ReturnType<typeof createCanvasEffects>,
 *   startRun?: (nodeId: string) => Promise<any>,
 *   stopRun?: (nodeId: string) => Promise<any>,
 * }} options
 */
export function createCanvasController({
  store,
  getTeams = () => [],
  saveFlow = () => {},
  translate = (text) => text,
  onError = (message) => console.warn('[画布]', message),
  makeId = nextLocalId,
  effects = createCanvasEffects({
    makeEdgeId: () => makeId('e'),
    makeNodeId: () => makeId('n'),
  }),
  startRun = null,
  stopRun = null,
} = {}) {
  if (!store || typeof store.subscribeEvent !== 'function' || typeof store.getState !== 'function') {
    throw new Error('createCanvasController: 需要 store.getState/subscribeEvent');
  }
  if (typeof getTeams !== 'function') {
    throw new Error('createCanvasController: 需要 getTeams()');
  }

  const uiState = () => store.getState();
  const nodes = () => {
    const list = uiState()?.canvas?.nodes;
    return Array.isArray(list) ? list : [];
  };
  const edges = () => {
    const list = uiState()?.canvas?.edges;
    return Array.isArray(list) ? list : [];
  };
  const focus = () => uiState()?.sidebar?.focus;

  /** 连线颜色跟着起点团队走；团队字段只存在于读模型，转换放在这里。 */
  function teamColors() {
    return teamColorsOf(getTeams());
  }

  function fail(message) {
    onError?.(translate(message));
    return false;
  }

  /** 把算好的数组写回切片；需要落盘的改动顺手打“未保存”。 */
  function patch(next, { save = true } = {}) {
    void store.dispatch({
      type: EVENTS.CANVAS_PATCHED,
      kind: 'mutate',
      payload: next,
    });
    if (save) saveFlow();
    return true;
  }

  function patchNode(nodeId, fields, options) {
    const list = nodes();
    let hit = false;
    const next = list.map((node) => {
      if (node.id !== nodeId) return node;
      hit = true;
      return { ...node, ...fields };
    });
    if (!hit) return false;
    return patch({ nodes: next }, options);
  }

  function nodeIdOf(payload) {
    const id = payload?.nodeId;
    return typeof id === 'string' && id ? id : null;
  }

  /** 运行/中止失败回提示；成功与否都不影响事件已被处理。 */
  function run(payload, action, missing) {
    const id = nodeIdOf(payload);
    if (!id) return fail('节点不存在');
    if (typeof action !== 'function') return fail(missing);
    void Promise.resolve(action(id)).catch((error) => {
      onError?.(String(error?.message || error || '运行失败'));
    });
    return true;
  }

  const handlers = {
    [EVENTS.NODE_DROP_SUBMITTED](payload) {
      const result = effects.createNode({
        agentId: payload?.agentId,
        x: payload?.x,
        y: payload?.y,
      });
      if (!result.ok) return fail(result.error);

      return patch({ nodes: [...nodes(), result.data] });
    },

    [EVENTS.NODE_TASK_CHANGED](payload) {
      const result = effects.setTask({ nodeId: nodeIdOf(payload), task: payload?.task, nodes: nodes() });
      if (!result.ok) return fail(result.error);

      return patchNode(result.data.nodeId, { task: result.data.task });
    },

    [EVENTS.NODE_HANDOFF_CHANGED](payload) {
      const result = effects.setHandoff({
        nodeId: nodeIdOf(payload),
        handoffEnabled: payload?.handoffEnabled,
        nodes: nodes(),
      });
      if (!result.ok) return fail(result.error);

      return patchNode(result.data.nodeId, { handoffEnabled: result.data.handoffEnabled });
    },

    [EVENTS.NODE_SESSION_CHANGED](payload) {
      const mode = effects.setSessionMode({
        nodeId: nodeIdOf(payload),
        sessionMode: payload?.sessionMode,
        nodes: nodes(),
      });
      if (!mode.ok) return fail(mode.error);

      const { nodeId, sessionMode } = mode.data;
      if (!patchNode(nodeId, { sessionMode })) return false;

      /* 复用下拉换了具体一段：模式切换之后再记 sessionId。 */
      if (sessionMode !== 'reuse' || !payload?.sessionId) return true;
      const picked = effects.setSessionId({
        nodeId,
        sessionId: payload.sessionId,
        nodes: nodes(),
      });
      if (!picked.ok) return fail(picked.error);

      return patchNode(picked.data.nodeId, { sessionId: picked.data.sessionId });
    },

    [EVENTS.EDGE_FILES_CHANGED](payload) {
      const result = effects.setEdgeFiles({
        edgeId: payload?.edgeId,
        files: payload?.files,
        edges: edges(),
        nodes: nodes(),
      });
      if (!result.ok) return fail(result.error);

      const { edgeId, files, targetNodeId } = result.data;
      const next = edges().map((edge) => (edge.id === edgeId ? { ...edge, files } : edge));
      if (!patch({ edges: next })) return false;

      /* 连线确认 = 把文件交给下游并立刻激活它；下游没填任务会被运行侧拦下。 */
      if (targetNodeId) run({ nodeId: targetNodeId }, startRun, '运行控制器未接线');
      return true;
    },

    [EVENTS.NODE_RUN_CLICKED](payload) {
      return run(payload, startRun, '运行控制器未接线');
    },

    [EVENTS.NODE_RUN_STOP_CLICKED](payload) {
      return run(payload, stopRun, '运行控制器未接线');
    },

    [EVENTS.NODE_MOVED](payload) {
      const result = effects.moveNode({ ...payload, nodes: nodes() });
      if (!result.ok) return fail(result.error);

      const { nodeId, x, y } = result.data;
      return patchNode(nodeId, { x, y });
    },

    [EVENTS.NODE_REMOVED](payload) {
      const result = effects.removeNode({
        nodeId: payload?.nodeId,
        nodes: nodes(),
        edges: edges(),
        focus: focus(),
      });
      if (!result.ok) return fail(result.error);

      const { nodeId, focus: nextFocus } = result.data;
      const hadFocus = Boolean(focus()?.teamId);
      const alive = new Set(result.data.nodeIds);
      const nextEdges = edges().filter((edge) => alive.has(edge.from) && alive.has(edge.to));
      if (!patch({ nodes: nodes().filter((node) => node.id !== nodeId), edges: nextEdges })) {
        return false;
      }

      /* 删掉的正好是当前展开的入口：新状态也要收起（旧字段由 team-control 镜像）。 */
      if (hadFocus && !nextFocus?.teamId) {
        void store.dispatch({
          type: EVENTS.TEAM_FOCUS_CHANGED,
          kind: 'mutate',
          payload: { teamId: null },
        });
      }
      return true;
    },

    [EVENTS.NODE_ALERT_CLEARED](payload) {
      const result = effects.clearAlert({ nodeId: payload?.nodeId, nodes: nodes() });
      if (!result.ok) return fail(result.error);

      /* 提醒是纯运行态，不写进流程。 */
      return patchNode(result.data.nodeId, { alert: result.data.alert }, { save: false });
    },

    [EVENTS.EDGE_CREATED](payload) {
      const result = effects.createEdge({
        from: payload?.from,
        to: payload?.to,
        nodes: nodes(),
        edges: edges(),
        teams: teamColors(),
      });
      if (!result.ok) return fail(result.error);
      /* 同方向的线已经在了：静默忽略，与原业务一致。 */
      if (result.duplicate) return true;

      const { edge, bows } = result;
      const byId = new Map(bows.map((item) => [item.edgeId, item.bow]));
      const next = edges().map((item) => (
        byId.has(item.id) ? { ...item, bow: byId.get(item.id) } : item
      ));
      return patch({ edges: [...next, edge] });
    },
  };

  const off = store.subscribeEvent(({ event, accepted }) => {
    if (!accepted) return;
    const handler = handlers[event?.type];
    if (!handler) return;
    handler(event.payload || {});
  });

  let destroyed = false;
  return {
    effects,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      off();
    },
  };
}
