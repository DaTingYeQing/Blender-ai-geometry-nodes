/* ===== 区域：果冻拖拽层 =====
 * 4.4：拖拽是纯表现 —— 指针事件 + 果冻滤镜 + 跟手幽灵，它不知道
 * “放下之后画布上会多一个什么”，只在松手时说两件事：
 *   - 落在画布上 → node.drop.submitted（世界坐标）
 *   - 落在垃圾桶上 → team.delete.submitted
 *
 * 规则不在这里记：
 *   - “没进工作区就弹回”由组装根通过 getDropTarget 回答（读状态 + 屏幕换世界）；
 *   - 能不能拖某张卡（展开态、卡片里的控件）是手势自己的边界。
 *
 * 区域不直接调 requestAnimationFrame / WAAPI：帧调度与填充动画都由组装根注入，
 * 保证测试可以逐帧驱动、reduced motion 下行为一致。
 */

import { EVENTS } from '../contracts/events.js';
import { createCubeSvg } from '../components/canvas/cube.js';

const DRAG_THRESHOLD = 6;   // 拖拽触发阈值（px）

const EXCLUDED_CLASSES = [
  'ti-toggle', 'ti-option', 'ti-check',
  'ti-folder', 'ti-session-edit', 'ti-session-trash',
];

const EXCLUDED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

function closestClass(node, name) {
  let current = node;
  while (current) {
    if (current.classList?.contains?.(name)) return current;
    current = current.parentNode;
  }
  return null;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function colorOf(team) {
  const h = Number(team?.h) || 0;
  const s = Number(team?.s) || 0;
  const l = Number.isFinite(Number(team?.l)) ? Number(team.l) : 60;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** 卡片里的输入框 / 下拉 / 按钮 / 图标不参与拖拽，展开态也不参与。 */
function isDraggable(item, target) {
  if (!item || item.classList?.contains?.('expanded')) return false;

  let current = target;
  while (current && current !== item) {
    if (EXCLUDED_CLASSES.some((name) => current.classList?.contains?.(name))) return false;
    if (EXCLUDED_TAGS.has(String(current.tagName || '').toUpperCase())) return false;
    current = current.parentNode;
  }
  return true;
}

const NS = 'http://www.w3.org/2000/svg';

function svgEl(doc, tag, attrs = {}) {
  const node = typeof doc.createElementNS === 'function'
    ? doc.createElementNS(NS, tag)
    : doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(name, String(value));
  }
  return node;
}

/** 果冻层：原位置的圆 + 跟随的圆 + 中间的“糖浆桥”。 */
function createGooLayer(doc) {
  const svg = svgEl(doc, 'svg', { class: 'goo-layer' });

  const defs = svgEl(doc, 'defs');
  const filter = svgEl(doc, 'filter', { id: 'goo' });
  filter.appendChild(svgEl(doc, 'feGaussianBlur', {
    in: 'SourceGraphic',
    stdDeviation: 7,
    result: 'blur',
  }));
  filter.appendChild(svgEl(doc, 'feColorMatrix', {
    in: 'blur',
    mode: 'matrix',
    values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10',
  }));
  defs.appendChild(filter);
  svg.appendChild(defs);

  const group = svgEl(doc, 'g', { filter: 'url(#goo)' });
  const origin = svgEl(doc, 'circle', { r: 0 });
  const cur = svgEl(doc, 'circle', { r: 0 });
  const bridge = svgEl(doc, 'polygon', { points: '' });
  group.appendChild(origin);
  group.appendChild(cur);
  group.appendChild(bridge);
  svg.appendChild(group);

  return { svg, origin, cur, bridge };
}

/**
 * @param {{
 *   document: Document,
 *   window?: any,
 *   layerRoot?: HTMLElement,
 *   teamListEl: HTMLElement,
 *   animation: { animate: Function },
 *   trash: { show: Function, hide: Function, hit: Function, mark: Function, center: Function, burst: Function },
 *   getTeams: () => Array<any>,
 *   getDropTarget: (clientX: number, clientY: number) => { x: number, y: number } | null,
 *   emit: (event: any) => any,
 *   requestFocus?: () => boolean,
 *   requestFrame: (fn: () => void) => any,
 *   cancelFrame: (id: any) => void,
 *   threshold?: number,
 * }} options
 */
export function createDragLayer(options) {
  const {
    document: doc,
    teamListEl,
    animation,
    trash,
    getTeams,
    getDropTarget,
    emit,
    requestFocus,
  } = options;

  const win = options.window || doc?.defaultView || globalThis;
  const root = options.layerRoot || doc?.body;
  const threshold = Number(options.threshold) || DRAG_THRESHOLD;
  const { requestFrame, cancelFrame } = options;

  if (!doc) throw new Error('createDragLayer: 需要 document');
  if (!teamListEl) throw new Error('createDragLayer: 需要团队列表');
  if (!animation || typeof animation.animate !== 'function') {
    throw new Error('createDragLayer: 需要 AnimationPort.animate');
  }
  if (!trash || typeof trash.hit !== 'function') throw new Error('createDragLayer: 需要垃圾桶');
  if (typeof getDropTarget !== 'function') throw new Error('createDragLayer: 需要 getDropTarget');
  if (typeof emit !== 'function') throw new Error('createDragLayer: 需要 emit');
  if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new Error('createDragLayer: 需要注入 requestFrame/cancelFrame');
  }

  const goo = createGooLayer(doc);
  const ghost = doc.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.style.display = 'none';
  root.appendChild(goo.svg);
  root.appendChild(ghost);

  let drag = null;
  let frame = null;

  function cancelFrameIfAny() {
    if (frame == null) return;
    cancelFrame(frame);
    frame = null;
  }

  /* 糖浆桥：两个圆 + 一个连接四边形，宽度随距离收窄。 */
  function setBridge(o, c, rO, rC) {
    goo.origin.setAttribute('cx', o.x);
    goo.origin.setAttribute('cy', o.y);
    goo.origin.setAttribute('r', rO);
    goo.cur.setAttribute('cx', c.x);
    goo.cur.setAttribute('cy', c.y);
    goo.cur.setAttribute('r', rC);

    const dx = c.x - o.x;
    const dy = c.y - o.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const wO = rO * 0.8;
    const wC = rC * 0.8;
    goo.bridge.setAttribute('points',
      `${o.x + nx * wO},${o.y + ny * wO}  ${c.x + nx * wC},${c.y + ny * wC}  `
      + `${c.x - nx * wC},${c.y - ny * wC}  ${o.x - nx * wO},${o.y - ny * wO}`);
  }

  function stepFollow(session, ease) {
    const { cur, prev } = session;
    session.prev = { ...cur };
    cur.x += (session.target.x - cur.x) * ease;
    cur.y += (session.target.y - cur.y) * ease;

    const vx = cur.x - prev.x;
    /* 被判定区吸住时把倾斜收回去 —— 方块要正着落进轮廓。 */
    session.rot = session.snapped ? session.rot * 0.7 : session.rot * 0.8 + vx * 0.6;
    session.rot = Math.max(-10, Math.min(10, session.rot));

    ghost.style.transform = `translate(${cur.x}px, ${cur.y}px) translate(-50%, -50%) rotate(${session.rot}deg)`;

    const rC = Math.max(9, 26 - dist(cur, session.origin) * 0.06);
    setBridge(session.origin, cur, 24, rC);
  }

  function loop(session, ease) {
    if (session.done) return;
    /* 松手时已经把 drag 置空：还在队列里的旧帧不能再跑，否则会叠出两条循环。 */
    if (!session.snapback && drag !== session) return;
    stepFollow(session, ease);
    if (session.snapback && dist(session.cur, session.target) < 3) {
      finishSnapback(session);
      return;
    }
    frame = requestFrame(() => loop(session, ease));
  }

  function startVisual(session) {
    session.started = true;
    /* 真拖起来了才把焦点交给拖拽层：普通点击不改聚焦；
     * 松手时的 drop / delete 事件因此能通过 mutate 守卫。 */
    requestFocus?.();
    session.item.classList?.add?.('dragging-source');
    trash.show();

    const color = colorOf(session.team);
    for (const circle of [goo.origin, goo.cur, goo.bridge]) {
      circle.setAttribute('fill', color);
    }

    const lockup = doc.createElement('div');
    lockup.className = 'ghost-cube-lockup';
    for (const side of ['before', 'after']) {
      const bracket = doc.createElement('span');
      bracket.className = 'ghost-bracket';
      bracket.style.color = color;
      bracket.textContent = side === 'before' ? '<' : '>';
      if (side === 'after') lockup.appendChild(createCubeSvg({ document: doc, team: session.team }));
      lockup.appendChild(bracket);
    }
    ghost.replaceChildren(lockup);
    ghost.style.display = 'block';
  }

  function hideOverlay() {
    ghost.style.display = 'none';
    goo.origin.setAttribute('r', 0);
    goo.cur.setAttribute('r', 0);
    goo.bridge.setAttribute('points', '');
  }

  /* 原位那圈“空心边框”填回实心：慢出，无回弹。
   * 展开态本来就是空心边框，不该被填成实心。 */
  function fillBack(item) {
    const bg = item.style?.background;
    item.classList?.remove?.('dragging-source');
    if (!bg || item.classList?.contains?.('expanded')) return;
    void animation.animate(
      item,
      [{ backgroundColor: 'rgba(0,0,0,0)' }, { backgroundColor: bg }],
      { duration: 800, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }

  function finishSnapback(session) {
    cancelFrameIfAny();
    session.done = true;
    hideOverlay();
    fillBack(session.item);
  }

  function startSnapback(session) {
    cancelFrameIfAny();
    session.snapback = true;
    session.ease = 0.22;
    session.target = { ...session.origin };
    frame = requestFrame(() => loop(session, session.ease));
  }

  function onDown(e) {
    if (e.button !== 0) return;

    const item = closestClass(e.target, 'team-item');
    if (!item) return;
    if (!isDraggable(item, e.target)) return;

    const teamId = item.dataset?.teamId;
    const teams = getTeams() || [];
    const team = teams.find((candidate) => candidate.id === teamId);
    if (!team) return;

    const rect = item.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
    drag = {
      item,
      team,
      origin: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      target: { x: e.clientX, y: e.clientY },
      cur: { x: e.clientX, y: e.clientY },
      prev: { x: e.clientX, y: e.clientY },
      rot: 0,
      started: false,
      done: false,
      snapback: false,
      snapped: false,
      ease: 0.18,
    };
    e.preventDefault?.();
    win?.addEventListener?.('mousemove', onMove);
    win?.addEventListener?.('mouseup', onUp);
  }

  function onMove(e) {
    if (!drag || drag.done) return;
    drag.target = { x: e.clientX, y: e.clientY };

    /* 吸附：指针进了判定区，目标点直接换成它的中心；
     * 跟手插值本身就会把立方体滑过去，吸附动画不用另写一条。 */
    drag.snapped = trash.hit(e.clientX, e.clientY);
    if (drag.snapped) drag.target = trash.center();
    trash.mark(e.clientX, e.clientY);

    if (drag.started) return;
    if (dist({ x: e.clientX, y: e.clientY }, drag.cur) < threshold) return;
    startVisual(drag);
    frame = requestFrame(() => loop(drag, drag.ease));
  }

  function detach() {
    win?.removeEventListener?.('mousemove', onMove);
    win?.removeEventListener?.('mouseup', onUp);
  }

  function onUp(e) {
    detach();
    if (!drag || drag.done) {
      trash.hide();
      drag = null;
      return;
    }
    if (!drag.started) {
      trash.hide();
      drag = null;
      return;                       /* 没超过阈值：算普通点击 */
    }

    const session = drag;
    drag = null;                    /* 会话结束，回弹自己跑完 */

    const intoTrash = trash.hit(e.clientX, e.clientY);
    if (!intoTrash) trash.hide();

    if (intoTrash) {
      session.done = true;
      cancelFrameIfAny();
      hideOverlay();
      trash.burst();
      emit({
        type: EVENTS.TEAM_DELETE_SUBMITTED,
        kind: 'mutate',
        payload: { teamId: session.team.id },
      });
      return;
    }

    /* 落点由组装根按状态回答：没进工作区 / 不在主区域 → null → 弹回。 */
    const world = getDropTarget(e.clientX, e.clientY);
    if (!world) {
      startSnapback(session);
      return;
    }

    session.done = true;
    cancelFrameIfAny();
    hideOverlay();
    emit({
      type: EVENTS.NODE_DROP_SUBMITTED,
      kind: 'mutate',
      payload: { agentId: session.team.id, x: world.x, y: world.y },
    });
    fillBack(session.item);
  }

  teamListEl.addEventListener('mousedown', onDown);

  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      detach();
      cancelFrameIfAny();
      if (drag) {
        drag.done = true;
        drag.item.classList?.remove?.('dragging-source');
        drag = null;
      }
      teamListEl.removeEventListener('mousedown', onDown);
      trash.hide();
      hideOverlay();
      goo.svg.remove?.();
      ghost.remove?.();
    },
  };
}
