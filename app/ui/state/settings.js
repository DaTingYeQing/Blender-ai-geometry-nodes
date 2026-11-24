/* ===== 设置切片 =====
 * 语言与模式都是设置状态（不是某个视图的关注点）：
 * 谁想换就直接发 settings.lang.submitted / settings.mode.changed，
 * 由这里唯一决定 UiState.settings。
 *
 * 模式只改本地选择；单人模式的终端在 workspace.enter 时才真正启动。
 * 语言要落盘，所以先变成 settings.lang.set 命令，等结果事件再改状态。
 */

import { EVENTS, COMMANDS } from '../contracts/events.js';

/** @returns {'zh' | 'en' | null} */
function normalizeLang(value) {
  return value === 'en' ? 'en' : value === 'zh' ? 'zh' : null;
}

/**
 * 用户选了语言：只产出命令，不改状态（结果由 settings.lang.changed 回来）。
 * 与当前一致时不重复落盘。
 * @param {import('../contracts/state.js').UiState} state
 * @param {import('../contracts/events.js').UiEvent} event
 * @returns {import('../contracts/state.js').UiTransition}
 */
export function reduce(state, event) {
  if (event?.type !== EVENTS.SETTINGS_LANG_SUBMITTED) return { state, commands: [] };
  const lang = normalizeLang(event.payload?.lang);
  if (!lang || state.settings?.lang === lang) return { state, commands: [] };
  return {
    state,
    commands: [{ type: COMMANDS.SETTINGS_LANG_SET, payload: { lang } }],
  };
}

/**
 * @param {import('../contracts/state.js').UiState} state
 * @param {unknown} lang
 * @returns {import('../contracts/state.js').UiState} 同引用表示无需变更
 */
export function applyLangChanged(state, lang) {
  const next = lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : null;
  if (!next) return state;
  if (state.settings?.lang === next) return state;
  return { ...state, settings: { ...state.settings, lang: next } };
}

/**
 * @param {import('../contracts/state.js').UiState} state
 * @param {unknown} mode
 * @returns {import('../contracts/state.js').UiState} 同引用表示无需变更
 */
export function applyModeChanged(state, mode) {
  const next = mode === 'solo' ? 'solo' : mode === 'team' ? 'team' : null;
  if (!next) return state;
  if (state.settings?.mode === next) return state;
  return { ...state, settings: { ...state.settings, mode: next } };
}
