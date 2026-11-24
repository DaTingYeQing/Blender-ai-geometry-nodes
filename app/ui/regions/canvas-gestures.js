/* ===== 区域：画布手势 =====
 * 只看鼠标，不做业务判断：拖节点、Alt 拉线、点击（聚焦 / 删除）、悬停清提醒。
 * 每条手势最后只做两件事：改画布局部状态（拖动中的临时坐标 / 预览线），
 * 以及把落定后的意图交给 RegionHost.emit。能不能改状态由入口守卫决定。
 *
 * 拖动过程不每帧发事件：临时坐标只进 `state.live`，松手才发 node.moved；
 * 否则拖一个节点会往总线灌几百条移动意图。
 *
 * 所有监听都登记在返回的 destroy 里，区域卸载时一起摘掉；
 * 拉到一半切走窗口也有 blur 兜底，不留虚线和粘在鼠标上的节点。
 */

import { EVENTS } from '../contracts/events.js';
import { normalizeView, zoomAt, ZOOM_STEP } from './canvas-viewport.js';

const DRAG_THRESHOLD = 4;   // 屏幕位移超过这个值才算“拖动过”，不算点击

function closestClass(node, name) {
  let current = node;
  while (current) {
    if (current.classList?.contains?.(name)) return current;
    current = current.parentNode;
  }
  return null;
}

function collectByClass(root, name, out = []) {
  for (const child of root?.children || []) {
    if (child.classList?.contains?.(name)) out.push(child);
    collectByClass(child, name, out);
  }
  return out;
}

function colorOf(team) {
  const h = Number(team?.h) || 0;
  const s = Number(team?.s) || 0;
  const l = Number.isFinite(Number(team?.l)) ? Number(team.l) : 60;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/**
 * @param {{
 *   container: HTMLElement,
 *   window?: any,
 *   document: Document,
 *   state: { live: Map<string, {x:number,y:number}>, preview: any, drag: any, link: any, pan: any, suppressClick: boolean },
 *   getScene: () => { nodes?: Array<any>, edges?: Array<any> },
 *   getViewport: () => { panX?: number, panY?: number, zoom?: number },
 *   setViewport: (patch: { panX?: number, panY?: number, zoom?: number }) => void,
 *   applyViewport: () => void,
 *   screenToWorld: (clientX: number, clientY: number) => { x: number, y: number },
 *   getRect?: () => { left?: number, top?: number },
 *   hitTest?: (clientX: number, clientY: number) => any,
 *   render: () => void,
 *   emit: (event: any) => boolean,
 *   requestFocus: () => boolean,
 *   animation: { animate: Function, waitUntilDone: Function },
 * }} options
 */
export function createCanvasGestures(options) {
  const {
    container,
    document: doc,
    state,
    getScene,
    getViewport,
    setViewport,
    applyViewport,
    screenToWorld,
    getRect = () => container.getBoundingClientRect?.() || { left: 0, top: 0 },
    hitTest,
    render,
    emit,
    requestFocus,
    animation,
  } = options;

  const win = options.window
    || doc.defaultView
    || (typeof globalThis.addEventListener === 'function' ? globalThis : null);

  if (!container) throw new Error('createCanvasGestures: 需要容器');
  if (!state?.live) throw new Error('createCanvasGestures: 需要手势状态');
  if (typeof emit !== 'function') throw new Error('createCanvasGestures: 需要 emit');

  function snapshot() {
    return getScene() || {};
  }

  function findNode(nodeId) {
    const nodes = Array.isArray(snapshot().nodes) ? snapshot().nodes : [];
    return nodes.find((node) => node.id === nodeId) || null;
  }

  function zoom() {
    return normalizeView(getViewport()).zoom;
  }

  function cardUnder(e) {
    const hit = typeof hitTest === 'function'
      ? hitTest(e.clientX, e.clientY)
      : doc.elementFromPoint?.(e.clientX, e.clientY);
    if (!hit) return null;
    return closestClass(hit, 'team-card') || (hit.classList?.contains?.('team-card') ? hit : null);
  }

  /* ---------- 平移 ---------- */

  function startPan(e) {
    requestFocus();
    const view = normalizeView(getViewport());
    state.pan = {
      x0: e.clientX,
      y0: e.clientY,
      panX0: view.panX,
      panY0: view.panY,
    };
    container.classList?.add?.('dragging');
    e.preventDefault?.();
  }

  function stopPan() {
    if (!state.pan) return;
    state.pan = null;
    container.classList?.remove?.('dragging');
  }

  /* ---------- 拖节点 ---------- */

  function startDrag(card, nodeId, e) {
    const node = findNode(nodeId);
    if (!node) return;

    state.drag = {
      anchor: card.parentNode,
      card,
      nodeId,
      startWorld: screenToWorld(e.clientX, e.clientY),
      startNode: { x: Number(node.x) || 0, y: Number(node.y) || 0 },
      moved: false,
    };
    state.suppressClick = false;
    state.drag.anchor?.classList?.add?.('dragging');
    card.style.cursor = 'grabbing';
  }

  function endDragVisual(drag) {
    drag.card.style.cursor = '';
    drag.anchor?.classList?.remove?.('dragging');
    drag.anchor?.classList?.remove?.('moving');
  }

  /* ---------- 拉线 ---------- */

  function beginLink(card, nodeId) {
    const node = findNode(nodeId);
    if (!node) return;

    const color = colorOf(node.team);
    state.link = {
      fromId: nodeId,
      agentId: node.agentId,
      color,
      point: { x: Number(node.x) || 0, y: Number(node.y) || 0 },
    };
    state.preview = { fromId: nodeId, x: Number(node.x) || 0, y: Number(node.y) || 0, color };
    if (card) card.style.cursor = '';
    if (container.style) container.style.cursor = 'crosshair';
    render();
  }

  function highlightTarget(targetId) {
    const link = state.link;
    if (!link) return;

    for (const card of collectByClass(container, 'team-card')) {
      const id = card.dataset?.nodeId;
      const node = findNode(id);
      const on = Boolean(
        targetId
        && id === targetId
        && id !== link.fromId
        && node
        && node.agentId !== link.agentId,
      );
      card.classList?.toggle?.('link-target', on);
    }
  }

  function clearLinkVisual() {
    for (const card of collectByClass(container, 'team-card')) {
      card.classList?.remove?.('link-target');
    }
    state.preview = null;
    state.link = null;
    if (container.style) container.style.cursor = '';
  }

  /* ---------- 点击后的两条动作 ---------- */

  async function pressThenFocus(card, nodeId) {
    card.classList?.remove?.('drop-in');
    try {
      await animation.animate(
        card,
        [
          { transform: 'scale(1)' },
          { transform: 'scale(0.82)', offset: 0.4 },
          { transform: 'scale(1)' },
        ],
        { duration: 350, easing: 'ease' },
      );
    } catch {
      /* 被打断（节点被删等）就静默收场，聚焦照发。 */
    }

    const node = findNode(nodeId);
    if (!node) return;
    requestFocus();
    emit({
      type: EVENTS.TEAM_FOCUS_CHANGED,
      kind: 'mutate',
      payload: { teamId: node.agentId, nodeId, pane: 'default' },
    });
  }

  async function removeWithAnimation(card, nodeId) {
    /* 入场 cardPop（.drop-in）与退场 nodeOut（.removing）都写在 .team-card 的
     * animation 上；两条规则特异性相同，drop-in 后定义会盖掉 nodeOut。
     * 先摘掉 drop-in，退场动画才播得出来（否则只能等 600ms 超时后直接消失）。 */
    card.classList?.remove?.('drop-in');
    card.classList?.add?.('removing');
    try {
      await animation.waitUntilDone(card, { animationName: 'nodeOut', timeoutMs: 600 });
    } catch {
      /* 兜底在 AnimationPort 里，这里只保证意图一定会发。 */
    }
    requestFocus();
    emit({
      type: EVENTS.NODE_REMOVED,
      kind: 'mutate',
      payload: { nodeId },
    });
  }

  /* ---------- 事件 ---------- */

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;

    /* 连线（整条命中带或中点圆点）只当按钮用，别让画布跟着平移。 */
    if (closestClass(e.target, 'edge-hit') || closestClass(e.target, 'edge-dot')) {
      e.preventDefault?.();
      return;
    }

    const card = closestClass(e.target, 'team-card');
    if (!card) {
      startPan(e);
      return;
    }

    e.preventDefault?.();
    e.stopPropagation?.();

    const nodeId = card.dataset?.nodeId;
    if (!nodeId) return;

    requestFocus();
    if (e.altKey) {
      beginLink(card, nodeId);
      return;
    }
    startDrag(card, nodeId, e);
  }

  function onMove(e) {
    if (state.drag) {
      const drag = state.drag;

      /* 拖到一半按下 Alt：从“移动节点”切成“拉线”。 */
      if (e.altKey) {
        endDragVisual(drag);
        state.drag = null;
        beginLink(drag.card, drag.nodeId);
        return;
      }

      const current = screenToWorld(e.clientX, e.clientY);
      const x = drag.startNode.x + (current.x - drag.startWorld.x);
      const y = drag.startNode.y + (current.y - drag.startWorld.y);

      state.live.set(drag.nodeId, { x, y });
      render();

      if (Math.hypot(x - drag.startNode.x, y - drag.startNode.y) * zoom() > DRAG_THRESHOLD) {
        if (!drag.moved) drag.anchor?.classList?.add?.('moving');
        drag.moved = true;
      }
      return;
    }

    if (state.link) {
      const point = screenToWorld(e.clientX, e.clientY);
      state.link.point = point;
      state.preview = {
        fromId: state.link.fromId,
        x: point.x,
        y: point.y,
        color: state.link.color,
      };
      render();
      highlightTarget(cardUnder(e)?.dataset?.nodeId || null);
      return;
    }

    if (state.pan) {
      setViewport({
        panX: state.pan.panX0 + (e.clientX - state.pan.x0),
        panY: state.pan.panY0 + (e.clientY - state.pan.y0),
      });
      applyViewport();
    }
  }

  function onUp(e) {
    if (state.drag) {
      const drag = state.drag;
      state.drag = null;
      endDragVisual(drag);

      if (!drag.moved) {
        state.live.delete(drag.nodeId);
        render();
        return;                       /* 没动过，交给 click 处理 */
      }

      state.suppressClick = true;
      const position = state.live.get(drag.nodeId) || drag.startNode;
      state.live.delete(drag.nodeId);

      requestFocus();
      emit({
        type: EVENTS.NODE_MOVED,
        kind: 'mutate',
        payload: { nodeId: drag.nodeId, x: position.x, y: position.y },
      });
      /* 提交成功时旧状态已经更新，这里画的是最终位置；失败时退回原处。 */
      render();
      return;
    }

    if (state.link) {
      const link = state.link;
      const source = findNode(link.fromId);
      const targetId = cardUnder(e)?.dataset?.nodeId || null;
      const target = targetId ? findNode(targetId) : null;

      state.suppressClick = true;
      clearLinkVisual();

      /* 同一个团队自己的节点之间不连线；业务层也拦，这里别发注定失败的请求。 */
      if (
        targetId
        && targetId !== link.fromId
        && source
        && target
        && target.agentId !== source.agentId
      ) {
        requestFocus();
        emit({
          type: EVENTS.EDGE_CREATED,
          kind: 'mutate',
          payload: { from: link.fromId, to: targetId },
        });
      }
      render();
      return;
    }

    stopPan();
  }

  function onClick(e) {
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    if (e.altKey) return;

    const edgeEl = closestClass(e.target, 'edge-dot') || closestClass(e.target, 'edge-hit');
    if (edgeEl) {
      const edgeId = edgeEl.dataset?.edgeId;
      const scene = snapshot();
      const edge = (scene.edges || []).find((item) => item.id === edgeId);
      const source = edge && (scene.nodes || []).find((node) => node.id === edge.from);
      if (source) {
        requestFocus();
        emit({
          type: EVENTS.TEAM_FOCUS_CHANGED,
          kind: 'mutate',
          payload: {
            teamId: source.agentId,
            nodeId: source.id,
            edgeId,
            pane: 'products',
          },
        });
      }
      return;
    }

    const card = closestClass(e.target, 'team-card');
    if (!card || card.classList?.contains?.('removing')) return;

    const nodeId = card.dataset?.nodeId;
    if (!nodeId) return;

    if (closestClass(e.target, 'node-dot')) {
      removeWithAnimation(card, nodeId);
      return;
    }
    pressThenFocus(card, nodeId);
  }

  /* 鼠标在节点上移动 → 解除提醒。悬停不抢聚焦：
   * 画布不是当前区域时这条意图会被守卫丢掉，提醒留到下次真正操作画布。 */
  function onHover(e) {
    if (state.drag || state.link || state.pan) return;

    const card = closestClass(e.target, 'team-card');
    if (!card) return;

    const anchor = card.parentNode;
    if (anchor?.classList?.contains?.('just-born')) {
      anchor.classList.remove('just-born');
      return;
    }

    const node = findNode(card.dataset?.nodeId);
    if (!node?.alert) return;

    emit({
      type: EVENTS.NODE_ALERT_CLEARED,
      kind: 'mutate',
      payload: { nodeId: node.id },
    });
  }

  function onWheel(e) {
    e.preventDefault?.();

    /* 调用方可能显式传 null（例如区域用“没传就用容器矩形”的默认值），
     * 那种情况下不能直接调用来取矩形，退回到容器自身的矩形。 */
    const rect = (typeof getRect === 'function' ? getRect() : container.getBoundingClientRect?.()) || {};
    const point = {
      x: Number(e.clientX) - (Number(rect.left) || 0),
      y: Number(e.clientY) - (Number(rect.top) || 0),
    };
    const factor = (Number(e.deltaY) || 0) < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const next = zoomAt(normalizeView(getViewport()), point, factor);

    setViewport({ panX: next.panX, panY: next.panY, zoom: next.zoom });
    applyViewport();
  }

  function onBlur() {
    stopPan();

    if (state.drag) {
      const drag = state.drag;
      state.drag = null;
      endDragVisual(drag);
      state.live.delete(drag.nodeId);
      render();
    }

    if (state.link) {
      clearLinkVisual();
      render();
    }
  }

  container.addEventListener('mousedown', onDown);
  container.addEventListener('click', onClick);
  container.addEventListener('mousemove', onHover);
  container.addEventListener('wheel', onWheel, { passive: false });
  win?.addEventListener?.('mousemove', onMove);
  win?.addEventListener?.('mouseup', onUp);
  win?.addEventListener?.('blur', onBlur);

  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      container.removeEventListener('mousedown', onDown);
      container.removeEventListener('click', onClick);
      container.removeEventListener('mousemove', onHover);
      container.removeEventListener('wheel', onWheel);
      win?.removeEventListener?.('mousemove', onMove);
      win?.removeEventListener?.('mouseup', onUp);
      win?.removeEventListener?.('blur', onBlur);
    },
  };
}
