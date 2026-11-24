/* ===== 应用状态 / 启动门（纯函数）=====
 * common.md：先判断“应用现在能不能用”，再判断“这个区域能不能用”，最后才是组件。
 *
 * 判定顺序固定为：starting → runtime_missing / backend_not_ready / offline / session_lost → ready。
 * 只有 ready 才算能用；其余状态只渲染门，不挂业务区域。
 */

/** @type {import('../contracts/state.js').AppStatus[]} */
export const APP_STATUSES = Object.freeze([
  'starting',
  'ready',
  'runtime_missing',
  'backend_not_ready',
  'offline',
  'session_lost',
]);

/**
 * @param {unknown} status
 * @returns {status is import('../contracts/state.js').AppStatus}
 */
export function isKnownAppStatus(status) {
  return typeof status === 'string' && APP_STATUSES.includes(status);
}

/**
 * 只有 ready 才允许挂载业务区域。
 * @param {import('../contracts/state.js').UiState} state
 */
export function isAppReady(state) {
  return state?.app?.status === 'ready';
}

/**
 * 门要不要显示（starting 也显示，只是文案不同）。
 * @param {import('../contracts/state.js').UiState} state
 */
export function isAppGated(state) {
  return !isAppReady(state);
}

/**
 * @param {import('../contracts/state.js').UiState} state
 * @param {import('../contracts/events.js').UiEvent} event payload = { status, detail? }
 * @returns {import('../contracts/state.js').UiState}
 */
export function applyAppStatusChanged(state, event) {
  const status = event?.payload?.status;
  if (!isKnownAppStatus(status)) return state;

  const previous = state.app || { status: 'starting' };

  /** 失败态带一个简短原因；ready / starting 不带。 */
  const raw = event?.payload?.detail;
  const detail = typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;

  const next = detail && status !== 'ready' ? { status, detail } : { status };
  if (previous.status === next.status && previous.detail === next.detail) return state;

  return { ...state, app: next };
}
