/* ===== 组装根：面板外壳（Esc / 遮罩 / ✕ / 聚焦）=====
 * 面板的显隐以 UiState.panels 为唯一事实，旧 store 的 view.panels 已退场。
 * 这里只接“界面外壳”的通用手势，不碰面板内容：
 *   - 点遮罩空白处或 ✕ → panel.close.clicked；
 *   - Esc → 关闭所有开着的面板；
 *   - 开 / 关状态变化 → 把焦点压入 / 弹出，保证守卫与键盘落点一致；
 *   - Tab 在对话框内循环，焦点不会跑到背后的画布/侧栏。
 *
 * 入场 / 退场动画与显隐类名由各区域的 presence 投影和全局 TransitionManager
 * 负责，本文件不等待动画、不写类名。
 */

import { EVENTS } from '../ui/contracts/events.js';

const CLOSE_SELECTOR = '.m-close';

/** 面板标题只用于读屏；面板内容自己的标题仍由区域渲染。 */
const PANEL_LABELS = {
  logoPanel: '设置',
  agentPanel: 'Agent 配置',
};

const FOCUSABLE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']);

function classOf(node) {
  return String(node?.className || '');
}

function contains(ancestor, node) {
  for (let current = node; current; current = current.parentNode) {
    if (current === ancestor) return true;
  }
  return false;
}

function findModal(overlay) {
  for (const child of overlay?.children || []) {
    if (classOf(child).split(/\s+/).includes('modal')) return child;
  }
  return null;
}

function isVisible(node) {
  if (!node || node.hidden) return false;
  if (typeof node.getClientRects === 'function') {
    return node.getClientRects().length > 0;
  }
  return true;
}

/** 不用 querySelector，假 DOM 和真实 DOM 都能走同一份逻辑。 */
function collectFocusable(root) {
  const out = [];
  const visit = (node) => {
    if (!node || node.nodeType !== 1) return;
    const tag = String(node.tagName || '').toUpperCase();
    const tabindex = node.getAttribute?.('tabindex');
    const disabled = node.disabled === true;
    const focusableTag = FOCUSABLE_TAGS.has(tag) && tabindex !== '-1';
    const custom = tabindex !== null && tabindex !== undefined && tabindex !== '-1';
    if (!disabled && (focusableTag || custom) && isVisible(node)) out.push(node);
    for (const child of node.childNodes || []) visit(child);
  };
  visit(root);
  return out;
}

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   document?: Document,
 *   translate?: (text: string) => string,
 * }} options
 */
export function mountPanelChrome({ kernel, document: doc = globalThis.document, translate = (text) => text }) {
  if (!doc) throw new Error('mountPanelChrome: 需要 document');
  if (!kernel) throw new Error('mountPanelChrome: 需要 kernel（由组装根创建）');

  const { store, focus, dispatch } = kernel;

  const overlays = Array.from(doc.querySelectorAll?.('.modal-overlay') || []);
  const byId = new Map(overlays.map((overlay) => [overlay.id, overlay]));

  /** 打开前真正持有焦点的元素；关闭动画结束后还给它。 */
  const restoreTargets = new Map();
  let lastOutsideFocus = null;
  if (doc.activeElement && !overlays.some((overlay) => contains(overlay, doc.activeElement))) {
    lastOutsideFocus = doc.activeElement;
  }

  function openOverlayIds() {
    const { panels = {}, transitions = {} } = store.getState();
    return overlays
      .filter((overlay) => panels[overlay.id] === true || transitions[overlay.id] === 'closing')
      .map((overlay) => overlay.id);
  }

  function insideOpenOverlay(node) {
    if (!node) return false;
    const ids = new Set(openOverlayIds());
    return overlays.some((overlay) => ids.has(overlay.id) && contains(overlay, node));
  }

  function focusFirst(overlay) {
    const modal = findModal(overlay) || overlay;
    const list = collectFocusable(overlay);
    const target = list[0] || modal;
    target.focus?.();
  }

  function closePanel(id) {
    if (!id) return false;
    void dispatch({
      type: EVENTS.PANEL_CLOSE_CLICKED,
      kind: 'mutate',
      payload: { id },
    });
    return true;
  }

  function onOverlayClick(event) {
    const overlay = event?.currentTarget;
    if (!overlay?.id) return;
    /* 退场动画期间不重复触发，和旧 modals 的行为一致。 */
    if (overlay.classList?.contains('closing')) return;
    const target = event.target;
    if (target === overlay || target?.closest?.(CLOSE_SELECTOR)) closePanel(overlay.id);
  }

  function onKeydown(event) {
    if (event?.key !== 'Escape') return;
    const panels = store.getState().panels || {};
    for (const [id, open] of Object.entries(panels)) {
      if (open === true) closePanel(id);
    }
  }

  /** Tab 只在当前打开的对话框内循环；焦点跑到外面时拉回来。 */
  function trapTab(event) {
    if (event?.key !== 'Tab') return;
    const overlay = event.currentTarget;
    const { panels = {} } = store.getState();
    if (panels[overlay?.id] !== true) return;

    const list = collectFocusable(overlay);
    if (!list.length) {
      event.preventDefault?.();
      findModal(overlay)?.setAttribute?.('tabindex', '-1');
      findModal(overlay)?.focus?.();
      return;
    }

    const active = doc.activeElement;
    const first = list[0];
    const last = list[list.length - 1];

    if (!active || !contains(overlay, active)) {
      event.preventDefault?.();
      first.focus?.();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault?.();
      last.focus?.();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault?.();
      first.focus?.();
    }
  }

  function onFocusIn(event) {
    const target = event?.target;
    if (!target || insideOpenOverlay(target)) return;
    lastOutsideFocus = target;
  }

  overlays.forEach((overlay) => {
    const modal = findModal(overlay);
    if (modal) {
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', translate(PANEL_LABELS[overlay.id] || '对话框'));
      modal.setAttribute('tabindex', modal.getAttribute('tabindex') ?? '-1');
    }
    overlay.addEventListener('click', onOverlayClick);
    overlay.addEventListener?.('keydown', trapTab);
  });
  doc.addEventListener?.('keydown', onKeydown);
  doc.addEventListener?.('focusin', onFocusIn);

  /* ---------- 开合 → 聚焦 ---------- */

  /** 已投影过开合的面板 id；只在真正跨过边界时动焦点。 */
  const applied = new Map(Object.entries(store.getState().panels || {}).map(([id, open]) => [id, open === true]));

  function syncFocus(state) {
    const panels = state.panels || {};
    for (const [id, open] of Object.entries(panels)) {
      const isOpen = open === true;
      const wasOpen = applied.get(id) === true;
      if (isOpen === wasOpen) continue;
      applied.set(id, isOpen);

      if (isOpen) {
        const overlay = byId.get(id);
        if (!overlay) continue;

        /* opener 可能已经被区域抢走了焦点（例如 Agent 面板自动聚焦名称框），
         * 所以优先记“打开前最后一个在面板外持有焦点的元素”。 */
        const active = doc.activeElement;
        const opener = insideOpenOverlay(active) ? lastOutsideFocus : active;
        if (opener && !insideOpenOverlay(opener)) restoreTargets.set(id, opener);

        if (focus.has(id) && !focus.isActive(id)) {
          focus.activate ? focus.activate(id) : focus.push(id);
        }
        if (!insideOpenOverlay(doc.activeElement)) focusFirst(overlay);
        continue;
      }

      if (focus.path().includes(id)) focus.pop(id);

      const target = restoreTargets.get(id);
      restoreTargets.delete(id);
      const otherOpen = Object.entries(panels).some(([otherId, value]) => otherId !== id && value === true);
      if (!otherOpen && target?.focus) target.focus();
    }
  }

  const stop = store.subscribe((state) => syncFocus(state));
  syncFocus(store.getState());

  return {
    closePanel,
    destroy() {
      stop();
      overlays.forEach((overlay) => {
        overlay.removeEventListener?.('click', onOverlayClick);
        overlay.removeEventListener?.('keydown', trapTab);
      });
      doc.removeEventListener?.('keydown', onKeydown);
      doc.removeEventListener?.('focusin', onFocusIn);
      restoreTargets.clear();
    },
  };
}