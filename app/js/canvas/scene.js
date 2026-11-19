/* ===== 画布场景：把 nodes/edges 投影成 DOM =====
 * 只负责"画布上有什么、长什么样"，不处理鼠标手势（那是 interactions），
 * 也不决定"能不能连、连几条"（那是 business/canvas.js）。
 *
 * 连线 SVG 放在世界层内部，用世界坐标绘制 → 平移缩放零成本，无需重算。
 *
 * 节点结构分两层：
 *   .node-anchor  位置层，left/top = 世界坐标，translate(-50%,-50%) 让中心对准落点
 *   .team-card    造型层，入场/按下/删除的 transform 动画都作用在这里
 * 分开是因为 transform 会互相覆盖 —— 以前位置靠 left: x-80 硬减，尺寸一变就偏。
 */

import { cubeSvg } from '../cube.js';
import { svgEl } from '../core/dom.js';
import { anchorToward, bezierPath, bezierMidpoint } from './geometry.js';

const EDGE_LAYER = 20000;   // 连线层显式尺寸，世界原点在中心

export function createScene({ store, worldEl, boxOf }) {
  const nodesEl = new Map();   // nodeId -> { anchor, card }
  const edgesEl = new Map();   // edgeId -> { path, dot }
  const markers = new Map();   // color -> marker id
  const livePos = new Map();   // nodeId -> { x, y }，拖拽中的临时位置（还没提交）

  /* ---------- 连线层 ---------- */

  const layer = svgEl('svg', {
    class: 'canvas-edges',
    width: EDGE_LAYER,
    height: EDGE_LAYER,
    viewBox: `${-EDGE_LAYER / 2} ${-EDGE_LAYER / 2} ${EDGE_LAYER} ${EDGE_LAYER}`,
  });
  layer.style.left = -EDGE_LAYER / 2 + 'px';
  layer.style.top = -EDGE_LAYER / 2 + 'px';
  layer.appendChild(svgEl('defs'));   // 箭头 marker 的容器

  const previewPath = svgEl('path', {
    fill: 'none', stroke: '#71717a', 'stroke-width': 2, 'stroke-dasharray': '6 5',
  });
  previewPath.style.display = 'none';
  layer.appendChild(previewPath);

  worldEl.insertBefore(layer, worldEl.firstChild);

  /* ---------- 渲染 ---------- */

  function render(state) {
    syncNodes(state.business);
    syncEdges(state.business);
    paintEdges(state.business);
  }

  function syncNodes({ nodes, teams }) {
    const alive = new Set(nodes.map((n) => n.id));

    for (const [id, rec] of nodesEl) {
      if (!alive.has(id)) {
        rec.anchor.remove();
        nodesEl.delete(id);
        livePos.delete(id);        // 拖拽中的临时坐标也要跟着清，别留一个死的 key
      }
    }

    for (const node of nodes) {
      let rec = nodesEl.get(node.id);
      if (!rec) {
        const team = teams.find((t) => t.id === node.agentId);
        if (!team) continue;                       // 团队已被删，节点等着被业务层清掉
        rec = createNode(node, team);
        nodesEl.set(node.id, rec);
      }
      // 拖拽中的节点由手势层直接写 DOM，这里别覆盖它
      if (!rec.anchor.classList.contains('dragging')) {
        rec.anchor.style.left = node.x + 'px';
        rec.anchor.style.top = node.y + 'px';
      }
      syncAlert(rec, node);
      syncRun(rec, node);
      syncTitle(rec, node);
    }
  }

  /* 节点下方那行字：真实流程里的节点自带 title，本地新建的还没有，就用团队名兜底。
   * 只改文字，不重建元素 —— 否则拖拽中会被打断。 */
  function syncTitle(rec, node) {
    const label = node.title || rec.team.name || '';
    if (rec.titleEl.textContent !== label) rec.titleEl.textContent = label;
  }

  /* ---- 下面是立方体右上角那个"状态位"的两位占用者 ----
   * 提醒（感叹号竖条）和运行中（扩散环）争的是同一个点，同一时刻只能有一个。
   * 互斥目前由 business 侧保证：api.createNode 让 running 和 alert 不同时为真。
   * 将来两种状态可能确实会同时成立（在跑的节点也需要你看一眼），
   * 那时候要在这里定谁优先 —— 别再让两样东西叠在同一个点上。 */

  /* 提醒标记：节点右上角那顆圆点是感叹号下面的那个点，
   * 这里只在它上方接一根竖条 —— 两截拼起来才是完整的感叹号，没有方框。
   * 动画全靠 CSS，所以这里不需要管"跳没跳"，只决定它存不存在。 */
  function syncAlert(rec, node) {
    if (node.alert && !rec.alert) {
      rec.alert = createAlert(rec.team);
      rec.anchor.appendChild(rec.alert);
    } else if (!node.alert && rec.alert) {
      rec.alert.remove();
      rec.alert = null;
    }
  }

  function createAlert(team) {
    const wrap = document.createElement('div');
    wrap.className = 'node-alert';
    wrap.style.setProperty('--alert', colorOf(team));
    wrap.innerHTML = '<div class="alert-bar"></div>';
    return wrap;
  }

  /* 运行中：节点右上角那颗圆点往外扩散的环，循环冒。
   * 和提醒一样只决定"存不存在"，扩散的节奏全在 CSS 里。
   * 一个圈，放大到看不见 → 从中心重新冒。要更连续就再加一个、
   * 用 animation-delay 错开半个周期（CSS 里留了位置，见 canvas.css）。 */
  function syncRun(rec, node) {
    if (node.running && !rec.run) {
      rec.run = createRun(rec.team);
      rec.anchor.appendChild(rec.run);
    } else if (!node.running && rec.run) {
      rec.run.remove();
      rec.run = null;
    }
  }

  function createRun(team) {
    const wrap = document.createElement('div');
    wrap.className = 'node-run';
    wrap.style.setProperty('--run', colorOf(team));
    wrap.innerHTML = '<span class="run-ring"></span>';
    return wrap;
  }

  function syncEdges({ edges }) {
    const alive = new Set(edges.map((e) => e.id));
    for (const [id, rec] of edgesEl) {
      if (!alive.has(id)) {
        shrinkEdge(rec);
        edgesEl.delete(id);      // 立刻从表里摘掉：这只是退场动画，不再参与状态
      }
    }
    for (const edge of edges) {
      if (!edgesEl.has(edge.id)) edgesEl.set(edge.id, createEdge(edge));
    }
  }

  /* 线消失：原地淡出，淡完再摘元素。
   * 线（含箭头）和那颗圆点用同一份时长/曲线一起淡，别一前一后。 */
  function shrinkEdge(rec) {
    rec.hit.remove();          // 命中带直接撤掉：这条线已不在状态里，不该再响应点击
    const fade = { duration: 240, easing: 'ease', fill: 'forwards' };
    const anim = rec.path.animate([{ opacity: 1 }, { opacity: 0 }], fade);
    rec.dot.animate([{ opacity: 1 }, { opacity: 0 }], fade);
    anim.finished
      .then(() => { rec.path.remove(); rec.dot.remove(); })
      .catch(() => {});          // 被打断（比如整块画布重建）就静默收场
  }

  /* ---------- 节点 ---------- */

  function createNode(node, team) {
    const anchor = document.createElement('div');
    anchor.className = 'node-anchor';
    anchor.dataset.nodeId = node.id;
    anchor.dataset.agentId = node.agentId;
    anchor.style.left = node.x + 'px';
    anchor.style.top = node.y + 'px';

    const card = document.createElement('div');
    card.className = 'canvas-card team-card drop-in';
    card.dataset.nodeId = node.id;
    card.dataset.agentId = node.agentId;
    card.innerHTML = `
      <div class="ghost-cube-lockup">
        <span class="ghost-bracket" style="color:${colorOf(team)}">&lt;</span>
        ${cubeSvg(team)}
        <span class="ghost-bracket" style="color:${colorOf(team)}">&gt;</span>
      </div>`;

    /* 立方体下面的名字。绝对定位挂在卡片外侧下方，不参与布局 ——
     * .node-anchor 靠 translate(-50%,-50%) 把立方体中心对准坐标，
     * 一旦让文字进流，整块会往上偏。 */
    const titleEl = document.createElement('div');
    titleEl.className = 'node-title';
    titleEl.textContent = node.title || team.name || '';
    card.appendChild(titleEl);

    // 入场动画结束只认 cardPop —— 卡片内别的动画结束时不该把它摘掉
    const onPopEnd = (ev) => {
      if (ev.animationName !== 'cardPop') return;
      card.removeEventListener('animationend', onPopEnd);
      card.classList.remove('drop-in');
    };
    card.addEventListener('animationend', onPopEnd);

    anchor.appendChild(card);
    worldEl.appendChild(anchor);

    // 出生保护期：节点是"出现在鼠标底下"的，刚落地那一下手抖不该消掉提醒
    anchor.classList.add('just-born');
    setTimeout(() => anchor.classList.remove('just-born'), 700);

    return { anchor, card, team, titleEl, alert: null, run: null };
  }

  function colorOf(team) {
    return `hsl(${team.h}, ${team.s}%, ${team.l}%)`;
  }

  /* ---------- 连线 ---------- */

  function createEdge(edge) {
    const path = svgEl('path', {
      fill: 'none',
      stroke: edge.color,
      'stroke-width': 2.5,
      'stroke-opacity': 0.9,
      'marker-end': `url(#${markerFor(edge.color)})`,
    });
    layer.insertBefore(path, previewPath);   // 线压在预览虚线之上

    // 透明命中带：和曲线同一条 d、加宽到 16px，让整条线都能点，
    // 不用非点中那颗 6px 的圆点。pointer-events 由 canvas.css 只开 stroke。
    const hit = svgEl('path', {
      class: 'edge-hit', fill: 'none', stroke: 'transparent', 'stroke-width': 16,
    });
    hit.dataset.edgeId = edge.id;
    layer.insertBefore(hit, previewPath);

    // 连线上那颗可点的圆点：点它 = 聚焦"发出这条线"的团队并切到产物视图
    const dot = svgEl('g', { class: 'edge-dot' });
    dot.style.setProperty('--dot', edge.color);
    dot.dataset.edgeId = edge.id;
    dot.appendChild(svgEl('circle', { class: 'edge-dot-hit', r: 14 }));   // 透明大命中区
    dot.appendChild(svgEl('circle', { class: 'edge-dot-core', r: 6, stroke: edge.color }));
    layer.appendChild(dot);

    return { path, hit, dot };
  }

  function markerFor(color) {
    if (markers.has(color)) return markers.get(color);
    const id = 'arrow-' + markers.size;
    const marker = svgEl('marker', {
      id, viewBox: '0 0 10 10', markerWidth: 13, markerHeight: 13,
      refX: 9, refY: 5, orient: 'auto', markerUnits: 'userSpaceOnUse',   // 箭尖正好落在节点边缘
    });
    marker.innerHTML = `<path d="M0,0 L10,5 L0,10 Z" fill="${color}"/>`;
    layer.querySelector('defs').appendChild(marker);
    markers.set(color, id);
    return id;
  }

  /** 重画所有连线与中点圆点。纯算术，不读 DOM —— 拖动时每帧都能跑 */
  function paintEdges({ nodes, edges }) {
    const byId = new Map(nodes.map((n) => [n.id, n]));

    for (const edge of edges) {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) continue;

      const rec = edgesEl.get(edge.id);
      if (!rec) continue;

      const pa = posOf(a);
      const pb = posOf(b);
      const p1 = anchorToward(boxOf(pa.x, pa.y), { x: pb.x, y: pb.y });
      const p2 = anchorToward(boxOf(pb.x, pb.y), { x: pa.x, y: pa.y });

      const d = bezierPath(p1, p2, edge.bow);
      rec.path.setAttribute('d', d);
      rec.hit.setAttribute('d', d);
      const mid = bezierMidpoint(p1, p2, edge.bow);
      rec.dot.setAttribute('transform', `translate(${mid.x}, ${mid.y})`);
    }
  }

  function posOf(node) {
    return livePos.get(node.id) || node;
  }

  /* ---------- 供手势层使用的几个动作 ----------
   * 拖拽和拉线是"过程"，过程中每帧都改变量、写 DOM，但不该每帧发意图
   * （拖一个节点会发出几百条 node.move）。所以过程留在这一层，落定才发。 */

  function setLivePos(id, x, y) {
    livePos.set(id, { x, y });
  }

  function clearLivePos(id) {
    livePos.delete(id);
  }

  function showPreview(color) {
    /* 先清掉上一次留下的路径数据。
     * 不清的话，这条虚线会带着上一次的 d 显示一帧 —— 那条 d 是旧连线的位置，
     * 看到的就是"别的地方闪一下"。第一次 mousemove 会把它改到正确位置，
     * 所以只有在这次之前拉过线时才闪，表现成"有时候"。 */
    previewPath.setAttribute('d', '');
    previewPath.style.display = '';
    previewPath.setAttribute('stroke', color);
  }

  function updatePreview(fromId, worldPoint) {
    const node = store.getState().business.nodes.find((n) => n.id === fromId);
    if (!node) return;
    const p = posOf(node);
    const p1 = anchorToward(boxOf(p.x, p.y), worldPoint);
    previewPath.setAttribute('d', bezierPath(p1, worldPoint));
  }

  function hidePreview() {
    previewPath.style.display = 'none';
    previewPath.setAttribute('d', '');
  }

  function highlightTarget(card, fromId, fromAgentId) {
    for (const [id, rec] of nodesEl) {
      const isTarget = !!card && rec.card === card;
      rec.card.classList.toggle('link-target', isTarget && id !== fromId && rec.team.id !== fromAgentId);
    }
  }

  function clearHighlight() {
    for (const rec of nodesEl.values()) rec.card.classList.remove('link-target');
  }

  return {
    render,
    redraw: () => paintEdges(store.getState().business),
    setLivePos, clearLivePos,
    showPreview, updatePreview, hidePreview,
    highlightTarget, clearHighlight,
  };
}
