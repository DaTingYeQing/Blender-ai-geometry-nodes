/* ===== 启动门（应用级）=====
 * common.md：先判断“应用现在能不能用”，再判断“这个区域能不能用”。
 * 门在非 ready 状态下覆盖全屏，并把业务根标记为 inert / aria-hidden；
 * 组件、区域、Effects 都不需要知道门的文案。
 *
 * 这里不读 store、不调 dispatch：调用方把 UiState 丢进 apply()。
 */

const TITLES = {
  starting: '正在启动…',
  runtime_missing: '缺少运行环境',
  backend_not_ready: '后端尚未就绪',
  offline: '网络连接已断开',
  session_lost: '登录状态已失效',
  ready: '',
};

const HINTS = {
  starting: '正在准备界面，请稍候。',
  runtime_missing: '请先安装并启动所需的运行时，然后重试。',
  backend_not_ready: '请确认后端服务已启动，然后重试。',
  offline: '请检查网络连接，恢复后会自动继续。',
  session_lost: '请重新登录后再继续。',
  ready: '',
};

/**
 * @param {{
 *   document: Document,
 *   translate?: (text: string) => string,
 *   appRoot?: HTMLElement | null,
 * }} options
 */
export function createStartupGate({
  document,
  translate = (text) => text,
  appRoot = null,
} = {}) {
  if (!document) throw new Error('createStartupGate: 需要 document');

  const el = document.createElement('div');
  el.className = 'app-gate';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;

  const card = document.createElement('div');
  card.className = 'app-gate-card';

  const title = document.createElement('p');
  title.className = 'app-gate-title';

  const hint = document.createElement('p');
  hint.className = 'app-gate-hint';

  const detail = document.createElement('p');
  detail.className = 'app-gate-detail';
  detail.hidden = true;

  card.appendChild(title);
  card.appendChild(hint);
  card.appendChild(detail);
  el.appendChild(card);

  /** @type {import('../contracts/state.js').AppStatus | null} */
  let current = null;

  function lockApp(locked) {
    if (!appRoot) return;
    if (locked) {
      appRoot.setAttribute('aria-hidden', 'true');
      appRoot.setAttribute('inert', '');
      return;
    }
    appRoot.removeAttribute('aria-hidden');
    appRoot.removeAttribute('inert');
  }

  /**
   * 按状态投影门。ready 时隐藏并解锁业务根。
   * @param {import('../contracts/state.js').UiState} state
   */
  function apply(state) {
    const app = state?.app || { status: 'starting' };
    const status = typeof app.status === 'string' && Object.hasOwn(TITLES, app.status)
      ? app.status
      : 'backend_not_ready';
    const changed = status !== current;
    current = status;

    if (status === 'ready') {
      el.hidden = true;
      lockApp(false);
      return;
    }

    el.hidden = false;
    el.setAttribute('role', status === 'starting' ? 'status' : 'alert');
    el.setAttribute('aria-live', status === 'starting' ? 'polite' : 'assertive');
    el.setAttribute('data-status', status);

    /* 文案只在状态变化时重设，避免无谓的 DOM 写入。 */
    if (changed) {
      title.textContent = translate(TITLES[status]);
      hint.textContent = translate(HINTS[status]);
    }

    const message = typeof app.detail === 'string' ? app.detail.trim() : '';
    detail.textContent = message;
    detail.hidden = message === '';

    lockApp(true);
  }

  function destroy() {
    lockApp(false);
    el.remove?.();
  }

  return {
    el,
    apply,
    destroy,
    get status() {
      return current;
    },
  };
}
