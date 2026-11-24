/* ===== 聚焦路径写入 State =====
 * 聚焦变化本身是 UI 状态：FocusManager 广播新路径，这里把它落到 state.focusPath。
 * 纯函数，不订阅、不通知，方便单测。
 */

/**
 * @param {string[] | undefined} a
 * @param {string[]} b
 */
function samePath(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

/**
 * @param {import('../contracts/state.js').UiState} state
 * @param {import('../contracts/events.js').UiEvent} event payload = { path: string[] }
 * @returns {import('../contracts/state.js').UiState}
 */
export function applyFocusChanged(state, event) {
  const path = event?.payload?.path;
  if (!Array.isArray(path) || path.length === 0) return state;

  const next = path.map(String);
  if (samePath(state.focusPath, next)) return state;   // 引用不变，避免无谓重渲染

  return { ...state, focusPath: next };
}
