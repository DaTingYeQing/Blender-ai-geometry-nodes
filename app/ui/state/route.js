/* ===== 路由 / 屏幕模型（派生状态）=====
 * common.md：聚焦管“谁能改”，路由管“现在是谁”。
 *
 * Phase 1：路由不再由外部事件写入，而是从两块业务事实派生：
 *   - settings.mode === 'solo'          → single
 *   - workspace.entered.workspaceId      → workspace（参数 workspaceId）
 *   - 其余                               → team
 *
 * 这一阶段只统一状态口径，不卸载 DOM，也不重置面板 / 焦点。
 * 真正的路由子树挂载、换屏清理与聚焦代际放到 Phase 2。
 */

function sameRoute(a, b) {
  if (!a || !b || a.name !== b.name) return false;
  const keys = new Set([...Object.keys(a.params || {}), ...Object.keys(b.params || {})]);
  for (const key of keys) {
    if (a.params?.[key] !== b.params[key]) return false;
  }
  return true;
}

/**
 * 从当前状态推导“现在是谁”。纯函数，不读 DOM、不依赖事件。
 * @param {import('../contracts/state.js').UiState} state
 * @returns {import('../contracts/state.js').Route}
 */
export function deriveRoute(state) {
  const mode = state?.settings?.mode === 'solo' ? 'solo' : 'team';
  if (mode === 'solo') return { name: 'single', params: {} };

  const workspaceId = state?.workspace?.entered?.workspaceId;
  if (typeof workspaceId === 'string' && workspaceId !== '') {
    return { name: 'workspace', params: { workspaceId } };
  }
  return { name: 'team', params: {} };
}

/**
 * 把派生路由写回状态。路由没变时保持引用，避免无谓重渲染。
 * @param {import('../contracts/state.js').UiState} state
 * @returns {import('../contracts/state.js').UiState}
 */
export function syncRoute(state) {
  const next = deriveRoute(state);
  if (sameRoute(state.route, next)) return state;
  return { ...state, route: next };
}