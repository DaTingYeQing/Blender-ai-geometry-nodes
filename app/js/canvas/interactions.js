/* ===== 画布手势：只读鼠标，不做决定 =====
 * 拖节点、Alt 拉线、点击（聚焦 / 删除）。
 * 这里的每一条最后都只有一个动作：bus.send(...)。
 * "能不能连第二条线""删了节点要不要收起侧栏"这类判断，一条都不在这里。
 *
 * 分界：拖拽过程中每帧改 DOM、写临时位置，但只有松手落定才发意图 ——
 * 否则拖一个节点会往总线上灌几百条 node.move。
 *
 * 手势绑在世界层上；平移缩放绑在画布层（view.js），靠卡片上的
 * stopPropagation 隔开 —— 按在卡片上不滚画布，按在空地上滚画布。
 */

import { BIZ } from '../core/intent.js';

const DRAG_THRESHOLD = 4;   // 超过这个位移才算"拖动过"，不算点击

export function bindInteractions({ store, bus, scene, view, canvasEl, worldEl }) {
  let drag = null;    // { anchor, card, nodeId, startWorld, startNode, moved }
  let link = null;    // { fromId, color }
  let lastDragMoved = false;

  /* ---------- 按下 ---------- */

  function onDown(e) {
    if (e.button !== 0) return;

    // 连线（含中点圆点和整条命中带）只当按钮用，别让画布跟着平移
    if (e.target.closest?.('.edge-dot') || e.target.closest?.('.edge-hit')) { e.stopPropagation(); return; }

    const card = e.target.closest('.team-card');
    if (!card) return;        // 按在空地：冒泡给 view.js 去平移画布

    e.stopPropagation();
    e.preventDefault();

    const nodeId = card.dataset.nodeId;
    if (e.altKey) { beginLink(nodeId, card); return; }

    const node = store.getState().business.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    drag = {
      anchor: card.parentElement,       // .node-anchor
      card,
      nodeId,
      startWorld: view.screenToWorld(e.clientX, e.clientY),
      startNode: { x: node.x, y: node.y },
      moved: false,
    };
    lastDragMoved = false;
    drag.anchor.classList.add('dragging');
    card.style.cursor = 'grabbing';
  }

  function beginLink(fromId, card) {
    const team = teamOf(fromId);
    if (!team) return;
    link = { fromId, agentId: team.id, color: `hsl(${team.h}, ${team.s}%, ${team.l}%)` };
    scene.showPreview(link.color);
    canvasEl.style.cursor = 'crosshair';
    if (card) card.style.cursor = '';
  }

  /* ---------- 移动 ---------- */

  function onMove(e) {
    if (drag) {
      // 拖到一半按下 Alt：从"移动节点"切成"拉线"
      if (e.altKey) {
        drag.anchor.classList.remove('dragging');
        drag.anchor.classList.remove('moving');
        drag.card.style.cursor = '';
        beginLink(drag.nodeId, drag.card);
        drag = null;
        return;
      }

      const cur = view.screenToWorld(e.clientX, e.clientY);
      const x = drag.startNode.x + (cur.x - drag.startWorld.x);
      const y = drag.startNode.y + (cur.y - drag.startWorld.y);

      drag.anchor.style.left = x + 'px';
      drag.anchor.style.top = y + 'px';
      scene.setLivePos(drag.nodeId, x, y);   // 让连线也能跟着走
      scene.redraw();

      if (Math.hypot(cur.x - drag.startWorld.x, cur.y - drag.startWorld.y) * zoom() > DRAG_THRESHOLD) {
        if (!drag.moved) drag.anchor.classList.add('moving');   // 真正拖起来了：括号往中间靠
        drag.moved = true;
      }
      return;
    }

    if (link) {
      scene.updatePreview(link.fromId, view.screenToWorld(e.clientX, e.clientY));
      scene.highlightTarget(cardUnder(e), link.fromId, link.agentId);
    }
  }

  /* ---------- 松开 ---------- */

  async function onUp(e) {
    if (drag) {
      const d = drag;
      drag = null;
      lastDragMoved = d.moved;
      d.card.style.cursor = '';

      if (!d.moved) {
        d.anchor.classList.remove('dragging');
        return;                        // 没动过，交给 click 处理
      }

      const x = parseFloat(d.anchor.style.left);
      const y = parseFloat(d.anchor.style.top);
      const res = await bus.send(BIZ.NODE_MOVE, { id: d.nodeId, x, y });

      scene.clearLivePos(d.nodeId);
      d.anchor.classList.remove('dragging');
      d.anchor.classList.remove('moving');
      // 提交失败 → 状态没变，让渲染把节点放回原处
      if (!res.ok) store.notify();
      return;
    }

    if (link) {
      const target = cardUnder(e);
      const targetId = target?.dataset.nodeId;
      if (targetId && targetId !== link.fromId) {
        // 同一团队的节点不算目标（业务层也拦，这里只是别发注定失败的请求）
        const targetNode = store.getState().business.nodes.find((n) => n.id === targetId);
        if (!targetNode || targetNode.agentId !== link.agentId) {
          bus.send(BIZ.EDGE_CREATE, { from: link.fromId, to: targetId });
        }
      }
      scene.clearHighlight();
      scene.hidePreview();
      canvasEl.style.cursor = '';
      link = null;
    }
  }

  /* ---------- 点击 ---------- */

  function onClick(e) {
    if (e.altKey) return;             // Alt+点击属于拉线流程

    // 连线（中点圆点或整条线）：聚焦"发出这条线"的团队，并切到产物视图
    const edgeTarget = e.target.closest?.('.edge-dot') || e.target.closest?.('.edge-hit');
    if (edgeTarget) {
      const edge = store.getState().business.edges.find((x) => x.id === edgeTarget.dataset.edgeId);
      const node = edge && store.getState().business.nodes.find((n) => n.id === edge.from);
      if (node) bus.send(BIZ.TEAM_FOCUS, { teamId: node.agentId, nodeId: node.id, edgeId: edge.id, pane: 'products' });
      return;
    }

    const card = e.target.closest?.('.team-card');
    if (!card || lastDragMoved || card.classList.contains('removing')) return;

    const nodeId = card.dataset.nodeId;

    // 立方体右上角那个圆点：删除节点（先播退场，播完再发意图）
    if (e.target.closest?.('.node-dot')) {
      removeWithAnimation(card, nodeId);
      return;
    }

    pressThenFocus(card, nodeId);
  }

  function pressThenFocus(card, nodeId) {
    // 用 WAAPI 而不是加 class 走 CSS 动画：
    // 1) 刚拖进画布的节点可能还挂着入场动画（cardPop），两个都写 transform 会打架
    // 2) CSS 动画只能靠 animationend，它会冒泡、分不清是谁结束的
    card.classList.remove('drop-in');
    const anim = card.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(0.82)', offset: 0.4 },
        { transform: 'scale(1)' },
      ],
      { duration: 350, easing: 'ease' }
    );

    anim.finished
      .then(() => {
        anim.cancel();               // 收掉动画，别把 transform 留在元素上
        const teamId = card.dataset.agentId;
        if (teamId) bus.send(BIZ.TEAM_FOCUS, { teamId, nodeId, pane: 'default' });
      })
      .catch(() => {});              // 中途被打断（节点被删等）就静默收场
  }

  function removeWithAnimation(card, nodeId) {
    card.classList.add('removing');
    let fired = false;

    const fire = () => {
      if (fired) return;
      fired = true;
      card.removeEventListener('animationend', onEnd);
      clearTimeout(timer);
      bus.send(BIZ.NODE_REMOVE, { id: nodeId });
    };
    const onEnd = (ev) => {
      if (ev.animationName && ev.animationName !== 'nodeOut') return;
      fire();
    };
    // 兜底：动画因为任何原因没跑（元素被提前移除、浏览器跳过动画），也不能卡死
    const timer = setTimeout(fire, 600);

    card.addEventListener('animationend', onEnd);
  }

  /* ---------- 工具 ---------- */

  function zoom() {
    return store.getState().view.canvas.zoom;
  }

  function teamOf(nodeId) {
    const { nodes, teams } = store.getState().business;
    const node = nodes.find((n) => n.id === nodeId);
    return node && teams.find((t) => t.id === node.agentId);
  }

  function cardUnder(e) {
    return document.elementFromPoint(e.clientX, e.clientY)?.closest('.team-card') || null;
  }

  /* 鼠标在节点上移动 → 解除提醒。
   * 用 mousemove 而不是 mouseover：节点是在松手那一刻"出现在鼠标底下"的，
   * 浏览器会立刻补一个 mouseover，气泡还没画出来就被解掉了。
   * mousemove 只在真的动了才触发，语义上更接近"把鼠标放上去"。
   * just-born 是出生保护期：拖完手抖一两像素，也不该立刻消掉。 */
  function onHover(e) {
    if (drag || link) return;
    const card = e.target.closest?.('.team-card');
    if (!card) return;
    const anchor = card.parentElement;
    if (!anchor || anchor.classList.contains('just-born')) return;
    if (!anchor.querySelector('.node-alert')) return;   // 没气泡就直接退出，省一次状态查询
    const node = store.getState().business.nodes.find((n) => n.id === card.dataset.nodeId);
    if (node?.alert) bus.send(BIZ.NODE_ALERT_CLEAR, { id: node.id });
  }

  /* 失焦兜底：拉线拉到一半切走窗口，回来别留一条虚线和一片高亮 */
  function onBlur() {
    if (!link) return;
    scene.clearHighlight();
    scene.hidePreview();
    canvasEl.style.cursor = '';
    link = null;
  }

  worldEl.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  worldEl.addEventListener('click', onClick);
  worldEl.addEventListener('mousemove', onHover);
  window.addEventListener('blur', onBlur);
}
