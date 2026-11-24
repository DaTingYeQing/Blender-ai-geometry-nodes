/* ===== 区域：画布 =====
 * 做四件事：把世界层挂进容器、按快照渲染场景、把视口变换写到 world、
 * 把手势落定后的意图交给 RegionHost。业务规则、接口调用都不在这里。
 *
 * 节点/连线的数据由组装根从旧 business 投影后注入；视口由组装根读写旧
 * `view.canvas`（平移缩放每帧都变，不进 UiState）。等画布业务迁完，
 * 组装根只需换掉 `getScene` / `setViewport`，这里的结构不用动。
 */

import { createRegionHost } from './region-host.js';
import { createErrorBoundary } from './error-boundary.js';
import { transformOf, screenToWorld as toWorld, normalizeView } from './canvas-viewport.js';
import { createCanvasGestures } from './canvas-gestures.js';
import { EVENTS } from '../contracts/events.js';
import { CANVAS_COMPONENT } from '../contracts/component-types.js';

const REGION_ID = 'canvas';

/* 点阵分级：每层是固定的世界间距，屏幕间距（世界间距 × zoom）决定可见度。
 *
 * 目标屏幕间距 T = 28px，层级按 2 倍细分（世界间距 4…128）。
 * 每一层：
 *   - s ∈ [T, 2T)        主层，始终保持不透明（任意缩放都必然有一层落在这里）
 *   - s ∈ [0.75T, T)     细层淡入：放大时新点一点点长出来
 *   - 其余               隐藏
 * 因为细层的点包含粗层的所有点（2 倍关系），主层切换的瞬间旧点不会消失，
 * 只是新点补进来 / 去掉一半，所以放大缩小到任何程度都不会出现空档。 */
const DOT_WORLD = [4, 8, 16, 32, 64, 128];
const DOT_TARGET = 28;

/** 某一层在屏幕间距 size 下的可见度，size 以 T 为单位归一。 */
function dotOpacity(size) {
  const s = size / DOT_TARGET;
  if (!(s >= 0.75) || s >= 2) return 0;
  if (s < 1) return (s - 0.75) / 0.25;
  return 1;
}

/** 取模到 [0, size)，让背景从世界原点开始铺。 */
function wrap(value, size) {
  return ((value % size) + size) % size;
}

const NO_ANIMATION = Object.freeze({
  animate: () => Promise.resolve(),
  waitUntilDone: () => Promise.resolve(),
  prefersReducedMotion: () => true,
});

/**
 * @param {{
 *   parent: any,
 *   focus: any,
 *   dispatch: (event: any) => void,
 *   registry: any,
 *   store: { getState: () => any, subscribe: (fn: () => void) => () => void },
 *   container: HTMLElement,
 *   document: Document,
 *   world?: HTMLElement | null,
 *   window?: any,
 *   animation?: import('../contracts/ports.js').AnimationPort | null,
 *   getScene?: () => { nodes?: Array<Object>, edges?: Array<Object> },
 *   getViewport?: () => { panX?: number, panY?: number, zoom?: number },
 *   setViewport?: (patch: { panX?: number, panY?: number, zoom?: number }) => void,
 *   getRect?: () => { left?: number, top?: number },
 *   hitTest?: (clientX: number, clientY: number) => any,
 *   translate?: (text: string) => string,
 * }} options
 */
export function createCanvasRegion(options) {
  const {
    parent,
    focus,
    dispatch,
    registry,
    store,
    container,
    document: doc,
    world = null,
    window: win = null,
    animation = null,
    getScene = () => ({ nodes: [], edges: [] }),
    getViewport = () => ({ panX: 0, panY: 0, zoom: 1 }),
    setViewport = () => {},
    getRect = null,
    hitTest = null,
    translate = (text) => text,
  } = options;

  if (!container) throw new Error('createCanvasRegion: 需要容器元素');
  if (!store) throw new Error('createCanvasRegion: 需要 store');

  const host = createRegionHost({ id: REGION_ID, parent, focus, dispatch });
  const ctx = {
    emit: host.emit,
    requestFocus: () => host.requestFocus(),
  };

  const boundary = createErrorBoundary({
    container,
    document: doc,
    regionId: REGION_ID,
    title: translate('画布暂时不可用'),
    onError: (error) => {
      console.error(`[区域] ${REGION_ID} 渲染失败`, error);
      void dispatch({
        type: EVENTS.REGION_RENDER_FAILED,
        kind: 'observe',
        payload: { regionId: REGION_ID, message: String(error?.message || error) },
      });
    },
  });

  /* 世界层可以由组装根提供（接管 #canvasWorld），也可以区域自建。
   * transform 只写这一层；容器（#wsCanvas）负责裁剪与滚动。 */
  const ownsWorld = !world;
  const worldEl = world || doc.createElement('div');
  worldEl.className = 'canvas-world';
  if (ownsWorld) container.replaceChildren(worldEl);
  else if (worldEl.parentNode !== container) container.appendChild(worldEl);
  host.scope.add(() => {
    if (ownsWorld) worldEl.remove();
  });

  const scene = registry.renderTree({
    type: CANVAS_COMPONENT.SCENE,
    key: 'scene',
    props: {},
    children: [],
  }, ctx);

  worldEl.appendChild(scene.el);
  host.registerChild(scene);

  /* 拖动中的临时坐标与拉线预览只属于这个过程，不进 store。 */
  const gestureState = {
    live: new Map(),
    preview: null,
    drag: null,
    link: null,
    pan: null,
    suppressClick: false,
  };

  function applyViewport() {
    const view = getViewport() || {};
    worldEl.style.transform = transformOf(view);
    applyDots(view);
  }

  /* 点阵只写 CSS 变量：位置按平移取模，所以点随画布一起走；
   * 缩放改变屏幕间距，层级可见度由 dotOpacity 交叉淡化。
   * 同一时刻最多两层同时可见（层级差 2 倍，可见区间跨度 2.67 倍），
   * 按“粗层在前”依次占用三个槽位，第三个槽位留给边界处的过渡层。 */
  function applyDots(view) {
    const style = container.style;
    if (typeof style?.setProperty !== 'function') return;
    const { panX, panY, zoom } = normalizeView(view || {});

    const layers = DOT_WORLD
      .map((world) => ({ world, size: world * zoom }))
      .map((item) => ({ ...item, opacity: dotOpacity(item.size) }))
      .filter((item) => item.opacity > 0)
      .sort((a, b) => b.size - a.size)
      .slice(0, 3);

    for (let index = 0; index < 3; index += 1) {
      const layer = layers[index];
      if (!layer) {
        style.setProperty(`--dot-size-${index}`, '0px');
        style.setProperty(`--dot-opacity-${index}`, '0');
        continue;
      }
      style.setProperty(`--dot-size-${index}`, `${layer.size.toFixed(2)}px`);
      style.setProperty(
        `--dot-pos-${index}`,
        `${wrap(panX, layer.size).toFixed(2)}px ${wrap(panY, layer.size).toFixed(2)}px`,
      );
      style.setProperty(`--dot-opacity-${index}`, layer.opacity.toFixed(3));
    }
  }

  function rectOf() {
    if (typeof getRect === 'function') return getRect() || {};
    return container.getBoundingClientRect?.() || { left: 0, top: 0 };
  }

  function screenToWorld(clientX, clientY) {
    return toWorld(getViewport() || {}, { x: clientX, y: clientY }, rectOf());
  }

  function renderInner() {
    applyViewport();

    const snapshot = getScene() || {};
    const rawNodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    const edges = Array.isArray(snapshot.edges) ? snapshot.edges : [];

    /* 节点被删后，它的临时坐标也要丢掉，别留一个死 key。 */
    const alive = new Set(rawNodes.map((node) => node.id));
    for (const id of gestureState.live.keys()) {
      if (!alive.has(id)) gestureState.live.delete(id);
    }

    /* 拖动中的节点用临时坐标参与渲染：节点本身与所有连线一起跟着走。 */
    const nodes = rawNodes.map((node) => {
      const live = gestureState.live.get(node.id);
      return live ? { ...node, x: live.x, y: live.y } : node;
    });

    const children = [
      {
        type: CANVAS_COMPONENT.EDGE_LAYER,
        key: 'edges',
        props: { nodes, edges, preview: gestureState.preview },
      },
    ];

    for (const node of nodes) {
      children.push({
        type: CANVAS_COMPONENT.NODE,
        key: `node:${node.id}`,
        props: { node, team: node.team || null },
      });
    }

    scene.update({
      type: CANVAS_COMPONENT.SCENE,
      key: 'scene',
      props: {},
      children,
    });
  }

  function render() {
    boundary.run(renderInner);
  }

  const gestures = createCanvasGestures({
    container,
    window: win,
    document: doc,
    state: gestureState,
    getScene,
    getViewport,
    setViewport,
    applyViewport,
    screenToWorld,
    getRect,
    hitTest,
    render,
    emit: host.emit,
    requestFocus: () => host.requestFocus(),
    animation: animation || NO_ANIMATION,
  });
  host.scope.add(gestures.destroy);

  host.scope.add(store.subscribe(render));
  render();

  return {
    id: REGION_ID,
    host,
    path: host.path,
    refresh: render,
    applyViewport,
    screenToWorld,
    destroy: host.destroy,
  };
}
