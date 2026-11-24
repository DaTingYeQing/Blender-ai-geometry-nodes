/* ===== 区域工具：拖拽删除区 =====
 * 4.4：垃圾桶是视图本地工具，不进状态 —— 它只回答三件事：
 * 现在显示在哪（按侧栏矩形算一次）、指针在不在上面、松手后怎么爆。
 *
 * 判定用几何而不是事件：它盖在列表上方，指针事件必须关着，
 * 否则展开的卡片就点不动了。
 *
 * 定位时机：拖起来那一刻算一次。拖拽期间侧栏宽度不会变（分割栏按不下去），
 * 所以不必每帧读布局。
 */

/** 红色填满 0.16s + 整块渐隐 0.3s，留一点余量再收干净。 */
export const BURST_MS = 520;

/**
 * 点在矩形里（屏幕坐标）。纯函数，方便单测。
 * @param {{ left: number, right: number, top: number, bottom: number }} rect
 * @param {number} x
 * @param {number} y
 */
export function pointInRect(rect, x, y) {
  if (!rect) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * @param {{
 *   trashEl: HTMLElement,
 *   sidebarEl: HTMLElement,
 *   body: { classList: { add: Function, remove: Function, contains: Function } },
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (id: any) => void,
 * }} options
 */
export function createTrashZone({
  trashEl,
  sidebarEl,
  body,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!trashEl) throw new Error('createTrashZone: 需要 #trashZone');
  if (!sidebarEl) throw new Error('createTrashZone: 需要侧栏');

  let timer = null;

  function clearPending() {
    if (timer == null) return;
    clearTimer(timer);
    timer = null;
  }

  function visible() {
    return Boolean(body?.classList?.contains?.('dragging-node'));
  }

  function rect() {
    return trashEl.getBoundingClientRect?.() || null;
  }

  return {
    /** 出现，并摆到侧栏底部居中。 */
    show() {
      const side = sidebarEl.getBoundingClientRect?.();
      if (side) {
        const width = trashEl.offsetWidth || 130;
        const height = trashEl.offsetHeight || 130;
        trashEl.style.left = `${side.left + (side.width - width) / 2}px`;
        trashEl.style.top = `${side.bottom - 14 - height}px`;
      }
      body?.classList?.add?.('dragging-node');
    },

    /** 判定区的中心（屏幕坐标）：拖拽时目标点换成它，跟手的立方体自己会滑过去。 */
    center() {
      const r = rect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 };
    },

    /** 松手删除：红色填满整个轮廓 → 整块渐隐。节奏在 CSS 里，这里只挂类和收尾。 */
    burst() {
      clearPending();
      trashEl.classList?.remove?.('over');
      trashEl.classList?.add?.('burst');
      timer = setTimer(() => {
        timer = null;
        trashEl.classList?.remove?.('burst');
        body?.classList?.remove?.('dragging-node');
      }, BURST_MS);
    },

    /** 消失（同时恢复画布的裁剪）。 */
    hide() {
      body?.classList?.remove?.('dragging-node');
      trashEl.classList?.remove?.('over');
    },

    /** 指针在不在垃圾桶上方。关着指针事件，所以只能算。 */
    hit(x, y) {
      if (!visible()) return false;
      return pointInRect(rect(), x, y);
    },

    /** 每帧更新“指着它了”的高亮。 */
    mark(x, y) {
      trashEl.classList?.toggle?.('over', this.hit(x, y));
    },

    destroy() {
      clearPending();
      trashEl.classList?.remove?.('burst');
      this.hide();
    },
  };
}
