/* ===== 组装根：画布 =====
 * 把新状态里的 `canvas.nodes/edges` 投影成组件快照，交给新画布区域接管
 * `#wsCanvas / #canvasWorld`。旧 `js/canvas/*` 已删除，渲染全部由
 * `ui/regions/canvas.js` 与组件承担。
 *
 * 分工：
 *   - 画布区域：渲染、平移缩放、拖节点 / 拉线 / 点击的手势；
 *   - 画布控制器：把落定后的新事件交给 Effects 规则并写回画布切片（见 ./canvas-control.js）；
 *   - 画布切片：节点 / 连线事实来源；
 *   - 团队颜色从 TeamReadModel 取；视口（平移缩放）是视图本地状态，不进 UiState。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { createComponentRegistry } from '../ui/components/registry.js';
import { registerCanvasComponents } from '../ui/components/canvas/index.js';
import { createCanvasRegion } from '../ui/regions/canvas.js';
import { createCanvasController } from './canvas-control.js';

/**
 * 新状态 → 组件快照：补齐团队颜色、丢掉孤儿节点、过滤非法坐标。
 * 纯函数，方便单测；不修改传入状态。
 * @param {any} state 新 UI 状态（只读 canvas 切片）
 * @param {Array<any>} teams TeamReadModel 的团队列表（颜色 / 名字来源）
 */
export function projectScene(state, teams = []) {
  const canvas = state?.canvas;
  if (!canvas) return { nodes: [], edges: [] };

  const byTeam = new Map((Array.isArray(teams) ? teams : []).map((team) => [team.id, team]));

  const nodes = [];
  for (const node of Array.isArray(canvas.nodes) ? canvas.nodes : []) {
    const team = byTeam.get(node.agentId);
    if (!team) continue;                       /* 团队已删，节点等业务层清理 */

    nodes.push({
      id: node.id,
      agentId: node.agentId,
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      title: typeof node.title === 'string' ? node.title : '',
      alert: Boolean(node.alert),
      running: Boolean(node.running),
      team: {
        id: team.id,
        name: team.name || '',
        h: Number(team.h) || 0,
        s: Number(team.s) || 0,
        l: Number(team.l) || 60,
      },
    });
  }

  const edges = [];
  for (const edge of Array.isArray(canvas.edges) ? canvas.edges : []) {
    edges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      color: typeof edge.color === 'string' ? edge.color : '#71717a',
      bow: Number(edge.bow) || 0,
    });
  }

  return { nodes, edges };
}

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   teamReadModel: { peekTeams: () => Array<Object> },
 *   saveFlow?: () => void,
 *   animation?: import('../ui/contracts/ports.js').AnimationPort | null,
 *   document?: Document,
 *   container?: HTMLElement | null,
 *   world?: HTMLElement | null,
 *   window?: any,
 *   translate?: (text: string) => string,
 *   makeId?: (prefix: string) => string,
 * }} options
 */
export function mountCanvasStage({
  kernel,
  teamReadModel,
  saveFlow = () => {},
  animation = null,
  startRun = null,
  stopRun = null,
  onError = null,
  document: doc = globalThis.document,
  container = null,
  world = null,
  window: win = null,
  translate = (text) => text,
  makeId = undefined,
}) {
  if (!doc) throw new Error('mountCanvasStage: 需要 document');
  if (!kernel) throw new Error('mountCanvasStage: 需要 kernel（由组装根创建）');
  if (typeof teamReadModel?.peekTeams !== 'function') {
    throw new Error('mountCanvasStage: 需要 TeamReadModel.peekTeams()');
  }

  const { store, focus, root, dispatch } = kernel;

  const reportedUnknown = new Set();
  const registry = createComponentRegistry({
    document: doc,
    onUnknown: (type) => {
      if (reportedUnknown.has(type)) return;
      reportedUnknown.add(type);
      void dispatch({
        type: EVENTS.COMPONENT_SKIPPED,
        kind: 'observe',
        payload: { component: type },
      });
    },
  });
  registerCanvasComponents({ registry, document: doc });

  const viewportEl = container
    || doc.getElementById?.('wsCanvas')
    || doc.querySelector?.('#wsCanvas');
  if (!viewportEl) throw new Error('mountCanvasStage: 找不到 #wsCanvas');

  const worldEl = world
    || doc.getElementById?.('canvasWorld')
    || doc.querySelector?.('#canvasWorld')
    || null;

  /* 平移缩放是视图本地状态：每帧都变，放进 UiState 只会让所有订阅者白重绘。
   * 与旧 view.canvas 语义一致，但不再经过任何旧 store。 */
  const viewport = { panX: 0, panY: 0, zoom: 1 };
  function writeViewport(patch) {
    Object.assign(viewport, patch);
  }

  const region = createCanvasRegion({
    parent: root,
    focus,
    dispatch,
    registry,
    store,
    container: viewportEl,
    world: worldEl,
    window: win,
    animation,
    document: doc,
    getScene: () => projectScene(store.getState(), teamReadModel.peekTeams()),
    getViewport: () => viewport,
    setViewport: writeViewport,
    translate,
  });

  /* 落定后的手势 → Effects 规则 → 画布切片；画布规则不再走旧 BIZ。
   * 运行/中止交给运行控制器，错误走统一提示。 */
  const control = createCanvasController({
    store,
    getTeams: () => teamReadModel.peekTeams(),
    saveFlow,
    startRun,
    stopRun,
    onError,
    translate,
    /* 不传时由 canvas-control 用页内自增兜底；生产由组装根注入带时间戳的实现。 */
    ...(makeId ? { makeId } : {}),
  });

  /* 状态 → 重画只由区域自己的 store 订阅负责（createCanvasRegion 内）。
   * 组装根不再重复订阅：否则每次状态变化会渲染两遍场景。
   * 平移缩放是视口本地状态，不触发重画。 */

  let destroyed = false;
  return {
    region,
    control,
    viewportEl,
    worldEl,
    refresh: () => region.refresh(),
    applyViewport: () => region.applyViewport(),
    screenToWorld: (clientX, clientY) => region.screenToWorld(clientX, clientY),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      control.destroy();
      region.destroy();
    },
  };
}
