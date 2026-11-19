/* ===== UI：果冻拖拽（侧栏团队卡 → 画布）=====
 * 纯视觉组件。它不知道"放下之后画布上会多一个什么"，只知道"用户把某个团队拖到了 (x, y)"，
 * 然后发一条 node.create 出去。
 *
 * 视觉结构：
 *   goo-layer   —— SVG 果冻滤镜层：原位置的圆 + 跟随的圆 + 中间的"糖浆桥"，
 *                  距离越远桥越细，像黏胶被拉长
 *   drag-ghost  —— 跟手的卡片幽灵，带弹性滞后（lerp）和速度倾斜
 *
 * 交互规则：
 *   - 按住团队卡片移动超过 6px 才算拖拽（否则是普通点击）
 *   - 松手落在主区域、且已经在工作区里 → 放到画布
 *   - 落在别处，或者还没进工作区 → 卡片弹性弹回原位
 *     进工作区只能走标题菜单，拖拽不是入口
 */

import { BIZ } from './core/intent.js';
import { paint } from './core/theme.js';
import { svgEl } from './core/dom.js';
import { cubeSvg } from './cube.js';
import * as trash from './trash.js';

const DRAG_THRESHOLD = 6;   // 拖拽触发阈值（px）

export function mountDragDrop({ store, bus, screenToWorld, mainArea }) {
  const teamList = document.getElementById('teamList');

  /* ---------- 果冻滤镜层 ---------- */

  const svg = svgEl('svg', { class: 'goo-layer' });
  svg.innerHTML = `
    <defs>
      <filter id="goo">
        <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur"/>
        <feColorMatrix in="blur" mode="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"/>
      </filter>
    </defs>
    <g filter="url(#goo)">
      <circle id="gooOrigin" r="0"/>
      <circle id="gooCur" r="0"/>
      <polygon id="gooBridge" points=""/>
    </g>`;
  document.body.appendChild(svg);
  const gooOrigin = svg.querySelector('#gooOrigin');
  const gooCur = svg.querySelector('#gooCur');
  const gooBridge = svg.querySelector('#gooBridge');

  /* ---------- 跟手幽灵 ---------- */

  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.style.display = 'none';
  document.body.appendChild(ghost);

  // 糖浆桥：两个圆 + 一个连接四边形，宽度随距离收窄
  function setBridge(o, c, rO, rC) {
    gooOrigin.setAttribute('cx', o.x); gooOrigin.setAttribute('cy', o.y);
    gooOrigin.setAttribute('r', rO);
    gooCur.setAttribute('cx', c.x); gooCur.setAttribute('cy', c.y);
    gooCur.setAttribute('r', rC);
    const dx = c.x - o.x, dy = c.y - o.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;   // 连线方向的法线
    const wO = rO * 0.8, wC = rC * 0.8;
    gooBridge.setAttribute('points',
      `${o.x + nx * wO},${o.y + ny * wO}  ${c.x + nx * wC},${c.y + ny * wC}  ` +
      `${c.x - nx * wC},${c.y - ny * wC}  ${o.x - nx * wO},${o.y - ny * wO}`);
  }

  let drag = null;   // 当前拖拽会话

  /* ---------- 按下 ---------- */

  teamList.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.team-item');
    if (!item || e.button !== 0) return;
    // 卡片里的控件（输入框/下拉/滑块/按钮/产物选项/对勾/图标）不参与拖拽：
    // 否则 preventDefault 会让输入框点不进去，鼠标框选文字也会把卡片拖走。
    // select 尤其要排除：preventDefault 一压，原生下拉列表就弹不出来了。
    // 对话行的铅笔/垃圾桶、右上角文件夹也都是 SVG 图标，同样要排除，
    // 否则点它们会被当成"按下开始拖卡片"，click 根本到不了。
    if (
      e.target.closest(
        'input, textarea, select, button, .ti-toggle, .ti-option, .ti-check, ' +
          '.ti-folder, .ti-session-edit, .ti-session-trash',
      )
    ) {
      return;
    }
    // 已经展开的卡片是用来编辑的，不再参与拖拽 —— 否则在展开态里按下拖动
    // 会额外拖出一个节点。
    if (item.classList.contains('expanded')) return;

    const teamId = item.dataset.teamId;
    const team = store.getState().business.teams.find((t) => t.id === teamId);
    if (!team) return;

    const r = item.getBoundingClientRect();
    drag = {
      item,
      team,
      origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      target: { x: e.clientX, y: e.clientY },
      cur: { x: e.clientX, y: e.clientY },
      prev: { x: e.clientX, y: e.clientY },
      rot: 0,
      started: false,
      done: false,
      snapback: false,
      raf: 0,
    };
    e.preventDefault();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    if (!drag || drag.done) return;
    drag.target = { x: e.clientX, y: e.clientY };

    /* 吸附：指针进了判定区，目标点直接换成它的中心。
     * tick 里那段跟手插值本身就会把立方体滑过去 —— 吸附动画不用另写一条。 */
    drag.snapped = trash.hit(e.clientX, e.clientY);
    if (drag.snapped) drag.target = trash.center();
    trash.mark(e.clientX, e.clientY);

    if (drag.started) return;
    // 超过阈值才算拖拽，普通点击不受影响
    if (dist({ x: e.clientX, y: e.clientY }, drag.cur) < DRAG_THRESHOLD) return;
    startVisual();
    drag.raf = requestAnimationFrame(tick);
  }

  function startVisual() {
    drag.started = true;
    drag.item.classList.add('dragging-source');
    trash.show();                      // 真拖起来了，侧栏底部的垃圾桶才现身

    const p = paint(drag.team);
    gooOrigin.setAttribute('fill', p.bg);
    gooCur.setAttribute('fill', p.bg);
    gooBridge.setAttribute('fill', p.bg);

    // 幽灵：立方体 + 括号，圆点和括号用团队色（同主标题 CLICK <cube> 的样式）
    ghost.innerHTML = `
      <div class="ghost-cube-lockup">
        <span class="ghost-bracket" style="color:${p.bg}">&lt;</span>
        ${cubeSvg(drag.team)}
        <span class="ghost-bracket" style="color:${p.bg}">&gt;</span>
      </div>`;
    ghost.style.display = 'block';
  }

  /* ---------- 每帧：弹性跟随 + 更新果冻桥 ---------- */

  function tick() {
    if (!drag || drag.done) return;
    stepFollow(drag, 0.18);
    if (drag.snapback && dist(drag.cur, drag.origin) < 3) { finishSnapback(drag); return; }
    drag.raf = requestAnimationFrame(tick);
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function stepFollow(s, ease) {
    s.prev = { ...s.cur };
    s.cur.x += (s.target.x - s.cur.x) * ease;
    s.cur.y += (s.target.y - s.cur.y) * ease;

    // 速度 → 倾斜角，让卡片有"甩"的感觉；
    // 被判定区吸住时把倾斜收回去 —— 方块要正着落进轮廓，歪着边缘就对不上
    const vx = s.cur.x - s.prev.x;
    s.rot = s.snapped ? s.rot * 0.7 : s.rot * 0.8 + vx * 0.6;
    s.rot = Math.max(-10, Math.min(10, s.rot));

    ghost.style.transform =
      `translate(${s.cur.x}px, ${s.cur.y}px) translate(-50%, -50%) rotate(${s.rot}deg)`;

    // 果冻桥：跟得越远拉得越细
    const rC = Math.max(9, 26 - dist(s.cur, s.origin) * 0.06);
    setBridge(s.origin, s.cur, 24, rC);
  }

  function hideOverlay() {
    ghost.style.display = 'none';
    gooOrigin.setAttribute('r', 0);
    gooCur.setAttribute('r', 0);
    gooBridge.setAttribute('points', '');
  }

  /* ---------- 回弹：独立于拖拽会话跑完 ---------- */

  function startSnapback(session) {
    session.snapback = true;
    session.target = { ...session.origin };
    function snapTick() {
      if (session.done) return;
      stepFollow(session, 0.22);
      if (dist(session.cur, session.target) < 3) { finishSnapback(session); return; }
      session.raf = requestAnimationFrame(snapTick);
    }
    session.raf = requestAnimationFrame(snapTick);
  }

  function finishSnapback(s) {
    cancelAnimationFrame(s.raf);
    hideOverlay();
    fillBack(s.item);
    s.done = true;
  }

  /* 原位那圈"空心边框"填回实心：慢出，无回弹。
   * 用 WAAPI 而不是 CSS 过渡，是为了压过内联背景色、并且不依赖过渡的起点采样。
   * 边框始终 3px（见 layout.css），这里只填底色，不碰边框。
   * 时长 200ms → 400ms → 800ms：200 时收得太急，像"啪"一下扑回来，
   * 看不出边框是从空心长成实心的。 */
  function fillBack(item) {
    const bg = item.style.background;             // 团队实心色（内联值）
    const expanded = item.classList.contains('expanded');
    item.classList.remove('dragging-source');
    // 展开态本来就是"空心边框"，不该被填成实心
    if (!bg || expanded) return;
    item.animate(
      [
        { backgroundColor: 'rgba(0,0,0,0)' },
        { backgroundColor: bg },
      ],
      { duration: 800, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
  }

  /* ---------- 松手 ---------- */

  async function onUp(e) {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (!drag || drag.done) { trash.hide(); drag = null; return; }
    if (!drag.started) { trash.hide(); drag = null; return; }   // 没超过阈值：算普通点击

    const drop = { x: e.clientX, y: e.clientY };
    const session = drag;
    drag = null;                                  // 会话结束，回弹自己跑完

    /* 先判垃圾桶，再判主区域。垃圾桶在侧栏上，本来也落在主区域之外，
     * 但它要的是"删掉这张卡"，不是"拖到空地上于是弹回"。 */
    const intoTrash = trash.hit(drop.x, drop.y);
    if (!intoTrash) trash.hide();

    if (intoTrash) {
      session.done = true;
      cancelAnimationFrame(session.raf);
      hideOverlay();
      // 轮廓先被红色填满、再整块渐隐，然后才把卡片从列表里摘掉
      trash.burst();
      bus.send(BIZ.TEAM_REMOVE, { teamId: session.team.id });
      return;
    }

    // 已经在工作区里、且落在主区域上，才算放得下。两者缺一就弹回。
    const entered = store.getState().business.workspace.entered;
    const overMain = entered && pointInRect(drop, mainArea.getBoundingClientRect());
    if (!overMain) { startSnapback(session); return; }

    session.done = true;
    cancelAnimationFrame(session.raf);
    hideOverlay();

    const world = screenToWorld(drop.x, drop.y);
    const res = await bus.send(BIZ.NODE_CREATE, {
      agentId: session.team.id,
      x: world.x,
      y: world.y,
    });

    // 落地成功原位立刻填回实心；失败也填回，卡片不该一直停在空心状态
    fillBack(session.item);
    if (!res.ok) return;
  }

  function pointInRect(p, rect) {
    return p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
  }
}
