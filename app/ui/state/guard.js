/* ===== 事件入口守卫 =====
 * common.md 5.1.4：State 收到事件时先看 regionId 和 kind，不合法直接丢弃。
 *
 *   mutate  —— 只有聚焦路径末端的区域能改状态。
 *   focus   —— 可见区域都能请求切换聚焦。
 *   observe —— 任何区域都能发，只记录不改状态。
 *
 * 没有 regionId 的 mutate 视为“来自内核或 Effects 的结果事件”（接口回包），
 * 它们不是界面动作，不走区域校验。
 */

import { EVENTS } from '../contracts/events.js';

/* 非破坏性的环境动作：不改选中、不改编辑内容，只是把已经处理完的提醒收掉。
 * 允许非聚焦区域发，避免“鼠标扫过画布”这种纯观察动作被迫抢焦点。
 * 这份清单必须保持很小；新增前先问“它会不会改变用户正在编辑的东西”。 */
const FOCUS_FREE_MUTATES = new Set([
  EVENTS.NODE_ALERT_CLEARED,
]);

/**
 * 这个区域是不是当前的聚焦末端。
 * @param {import('../contracts/state.js').UiState} state
 * @param {string} regionId
 */
export function isActiveRegion(state, regionId) {
  const path = state?.focusPath;
  return Array.isArray(path) && path.length > 0 && path[path.length - 1] === regionId;
}

/**
 * 这条事件能不能进 State。
 * @param {import('../contracts/state.js').UiState} state
 * @param {import('../contracts/events.js').UiEvent} event
 */
export function shouldAccept(state, event) {
  if (!event || typeof event.type !== 'string') return false;

  switch (event.kind) {
    case 'mutate':
      if (!event.regionId) return true;
      if (FOCUS_FREE_MUTATES.has(event.type)) return true;
      return isActiveRegion(state, event.regionId);
    case 'focus':
    case 'observe':
      return true;
    default:
      return false;   // kind 没登记：宁可丢掉，也不猜
  }
}
