/* ===== 状态切片：手动保存（纯 reducer）=====
 * 保存器的生命周期由组装根注入的 saver 决定（dirty → saving → saved/failed），
 * 这里只把 workspace.save.state.changed 收进状态，供保存按钮与标题读取。
 * 点击保存按钮本身不改状态：真正的 saving 由 saver 同步回调写回。
 */

import { EVENTS } from '../contracts/events.js';

const STATUSES = new Set(['idle', 'dirty', 'saving', 'saved', 'failed']);

function noChange(state) {
  return { state, commands: [] };
}

/**
 * @param {import('../contracts/state.js').UiState} state
 * @param {import('../contracts/events.js').UiEvent} event
 * @returns {import('../contracts/state.js').UiTransition}
 */
export function reduce(state, event) {
  if (event?.type !== EVENTS.WORKSPACE_SAVE_STATE_CHANGED) return noChange(state);

  const status = event.payload?.status;
  if (!STATUSES.has(status)) return noChange(state);
  if (state.save?.status === status) return noChange(state);

  return { state: { ...state, save: { status } }, commands: [] };
}
