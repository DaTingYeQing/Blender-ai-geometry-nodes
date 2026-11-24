/* ===== 组件：画布节点 =====
 * 只画一个节点：定位层（left/top = 世界坐标）+ 造型层（括号 + 立方体 + 标题）。
 * 提醒条与运行环按 props 增减，动画全在 CSS 里，组件不挂 animationend。
 *
 * 位置与标题更新时只改属性和文本，不重建元素 —— 拖拽/重排时节点 identity
 * 必须稳定，否则 CSS 过渡会从头播。
 */

import { createCubeSvg } from './cube.js';
import { colorOf } from './geometry.js';

function setVar(element, name, value) {
  if (typeof element.style?.setProperty === 'function') element.style.setProperty(name, value);
  else if (element.style) element.style[name] = value;
}

/**
 * @param {{document: Document}} deps
 */
export function createCanvasNode({ document: doc }) {
  return function canvasNode(props = {}) {
    const state = {
      node: props.node || {},
      team: props.team || null,
    };

    const anchor = doc.createElement('div');
    anchor.className = 'node-anchor';
    anchor.dataset.nodeId = state.node.id || '';
    anchor.dataset.agentId = state.node.agentId || '';

    let card = null;
    let titleEl = null;

    function buildShape() {
      card = doc.createElement('div');
      card.className = 'canvas-card team-card drop-in';
      card.dataset.nodeId = state.node.id || '';
      card.dataset.agentId = state.node.agentId || '';

      const lockup = doc.createElement('div');
      lockup.className = 'ghost-cube-lockup';

      const open = doc.createElement('span');
      open.className = 'ghost-bracket';
      open.textContent = '<';
      open.style.color = colorOf(state.team);

      const close = doc.createElement('span');
      close.className = 'ghost-bracket';
      close.textContent = '>';
      close.style.color = colorOf(state.team);

      lockup.appendChild(open);
      lockup.appendChild(createCubeSvg({ document: doc, team: state.team || { h: 0, s: 0, l: 60 } }));
      lockup.appendChild(close);

      titleEl = doc.createElement('div');
      titleEl.className = 'node-title';
      titleEl.textContent = state.node.title || state.team?.name || '';

      card.appendChild(lockup);
      card.appendChild(titleEl);
      anchor.appendChild(card);
    }

    buildShape();

    /* 出生保护：节点刚出现在鼠标底下时，第一次 mousemove 不该立刻消掉提醒。
     * 手势层看到这个类会跳过一次悬停，然后把它摘掉（不需要计时器）。 */
    anchor.classList.add('just-born');

    let alertEl = null;
    let runEl = null;

    function syncAlert() {
      if (state.node.alert && !alertEl) {
        alertEl = doc.createElement('div');
        alertEl.className = 'node-alert';
        setVar(alertEl, '--alert', colorOf(state.team));
        const bar = doc.createElement('div');
        bar.className = 'alert-bar';
        alertEl.appendChild(bar);
        anchor.appendChild(alertEl);
      } else if (!state.node.alert && alertEl) {
        alertEl.remove();
        alertEl = null;
      }
    }

    function syncRun() {
      if (state.node.running && !runEl) {
        runEl = doc.createElement('div');
        runEl.className = 'node-run';
        setVar(runEl, '--run', colorOf(state.team));
        const ring = doc.createElement('span');
        ring.className = 'run-ring';
        runEl.appendChild(ring);
        anchor.appendChild(runEl);
      } else if (!state.node.running && runEl) {
        runEl.remove();
        runEl = null;
      }
    }

    function apply() {
      const node = state.node;
      anchor.style.left = `${Number(node.x) || 0}px`;
      anchor.style.top = `${Number(node.y) || 0}px`;

      const title = node.title || state.team?.name || '';
      if (titleEl.textContent !== title) titleEl.textContent = title;

      syncAlert();
      syncRun();
    }

    apply();

    return {
      el: anchor,
      update(next = {}) {
        const previousTeamId = state.team?.id ?? null;
        state.node = next.node || {};
        state.team = next.team || null;

        /* 换团队要换颜色，颜色写进了 SVG 渐变与括号，只能重建造型层。 */
        if ((state.team?.id ?? null) !== previousTeamId) {
          const fresh = anchor.ownerDocument.createElement('div');
          fresh.className = 'canvas-card team-card';
          anchor.replaceChildren(fresh);
          card = fresh;
          buildShapeInto(card);
        }
        apply();
      },
      destroy() {
        anchor.remove();
      },
    };

    /* 重建时复用：把括号 + 立方体 + 标题塞进新的 card。 */
    function buildShapeInto(target) {
      const lockup = doc.createElement('div');
      lockup.className = 'ghost-cube-lockup';

      const open = doc.createElement('span');
      open.className = 'ghost-bracket';
      open.textContent = '<';
      open.style.color = colorOf(state.team);

      const close = doc.createElement('span');
      close.className = 'ghost-bracket';
      close.textContent = '>';
      close.style.color = colorOf(state.team);

      lockup.appendChild(open);
      lockup.appendChild(createCubeSvg({ document: doc, team: state.team || { h: 0, s: 0, l: 60 } }));
      lockup.appendChild(close);

      titleEl = doc.createElement('div');
      titleEl.className = 'node-title';
      titleEl.textContent = state.node.title || state.team?.name || '';

      target.appendChild(lockup);
      target.appendChild(titleEl);
      card = target;
    }
  };
}
