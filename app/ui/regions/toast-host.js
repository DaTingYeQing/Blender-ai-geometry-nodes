/* ===== 全局提示视图（toast）=====
 * 提示是状态（UiState.notices），这里只做投影：按 id 增量挂/摘，不判断哪些错误该提示。
 * 自动消失是视图本地行为（计时器），到点只发 notice.dismissed，不直接改状态。
 *
 * 提示条文案由状态给出，翻译在视图这层做；组件/区域不需要知道 toast 存在。
 */

/**
 * @param {{
 *   document: Document,
 *   translate?: (text: string) => string,
 *   onDismiss?: (id: string) => void,
 *   autoDismissMs?: number,
 * }} options
 */
export function createToastHost({
  document,
  translate = (text) => text,
  onDismiss,
  autoDismissMs = 0,
} = {}) {
  if (!document) throw new Error('createToastHost: 需要 document');

  const el = document.createElement('div');
  el.className = 'toast-host';
  el.hidden = true;

  /** @type {Map<string, { el: HTMLElement, message: HTMLElement, timer: any }>} */
  const entries = new Map();

  function clearTimer(entry) {
    if (entry.timer != null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  function createEntry(notice) {
    const box = document.createElement('div');
    box.className = `toast toast-${notice.tone || 'info'}`;
    box.setAttribute('role', notice.tone === 'error' ? 'alert' : 'status');
    box.setAttribute('data-notice', notice.id);

    const message = document.createElement('span');
    message.className = 'toast-message';
    box.appendChild(message);

    const close = document.createElement('button');
    close.className = 'toast-close';
    close.setAttribute('type', 'button');
    close.setAttribute('aria-label', translate('关闭提示'));
    close.textContent = '✕';
    close.addEventListener('click', () => onDismiss?.(notice.id));
    box.appendChild(close);

    el.appendChild(box);

    const entry = { el: box, message, timer: null };
    if (autoDismissMs > 0) {
      entry.timer = setTimeout(() => onDismiss?.(notice.id), autoDismissMs);
    }
    return entry;
  }

  /**
   * @param {import('../contracts/state.js').UiState} state
   */
  function apply(state) {
    const notices = Array.isArray(state?.notices) ? state.notices : [];
    const ids = new Set(notices.map((notice) => notice.id));

    for (const [id, entry] of [...entries]) {
      if (ids.has(id)) continue;
      clearTimer(entry);
      entry.el.remove?.();
      entries.delete(id);
    }

    for (const notice of notices) {
      let entry = entries.get(notice.id);
      if (!entry) {
        entry = createEntry(notice);
        entries.set(notice.id, entry);
      }
      entry.el.setAttribute('data-tone', notice.tone || 'info');
      entry.message.textContent = translate(notice.message);
    }

    el.hidden = notices.length === 0;
  }

  function destroy() {
    for (const entry of entries.values()) {
      clearTimer(entry);
      entry.el.remove?.();
    }
    entries.clear();
    el.remove?.();
  }

  return { el, apply, destroy };
}
