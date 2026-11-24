/* ===== 全局提示（纯函数）=====
 * 3.6：字段级错误留在 requests 里（可重试、贴着字段），
 * 网络 / 超时 / 权限 / 服务端 5xx 这类“重试也没用或在别处”的错误才进全局提示。
 *
 * 兜底规则：其余 *.failed 也必须可见。如果事件已经由某个控件内联展示，
 * 或由控制器单独提示（运行启动、保存、语言切换），就保持静默；否则把
 * payload.error 原样弹出来。后端文案会跟随 X-Pi-Locale，不会漏掉业务错误。
 *
 * 提示是状态：id 由 noticeSeq 递增，不读时间、不用随机数，保证可序列化与可重放。
 */

import { EVENTS } from '../contracts/events.js';

/** 同时最多留几条，避免错误风暴把界面刷爆。 */
export const MAX_NOTICES = 4;

const MAX_MESSAGE = 300;

/** @type {import('../contracts/state.js').NoticeTone[]} */
const TONES = ['info', 'success', 'error'];

/** 控制器/宿主已经单独提示过的失败：不要重复弹。 */
const HANDLED_ELSEWHERE = new Set([
  EVENTS.NODE_RUN_FAILED,          // composition/run 的 onError
  EVENTS.WORKSPACE_SAVE_FAILED,    // composition/save-button 的 toast
  EVENTS.SETTINGS_LANG_FAILED,     // composition/settings-control 的 notice
]);

/** 控件已经有内联错误位：400 这类业务错误不重复弹，网络/权限仍由全局兜底。 */
const FIELD_LEVEL = new Set([
  EVENTS.TOOLS_LOAD_FAILED,
  EVENTS.AGENT_CONFIG_LOAD_FAILED,
  EVENTS.AGENT_CREATE_FAILED,
  EVENTS.AGENT_SAVE_FAILED,
  EVENTS.SESSION_LOAD_FAILED,
  EVENTS.ARTIFACT_OPEN_FAILED,
]);

const FALLBACK_MESSAGE = '操作失败，请稍后重试。';

/**
 * 失败事件是否值得弹全局提示；返回提示内容或 null。
 * @param {import('../contracts/events.js').UiEvent} event
 * @returns {{ tone: import('../contracts/state.js').NoticeTone, message: string } | null}
 */
export function noticeFromFailure(event) {
  const type = event?.type;
  if (typeof type !== 'string' || !type.endsWith('.failed')) return null;
  if (HANDLED_ELSEWHERE.has(type)) return null;

  const payload = event.payload || {};
  const code = payload.code;
  const status = Number(payload.status) || 0;

  if (code === 'network') return { tone: 'error', message: '网络连接异常，请检查网络后重试。' };
  if (code === 'timeout') return { tone: 'error', message: '请求超时，请稍后重试。' };
  if (status === 401 || status === 403) return { tone: 'error', message: '没有权限或登录已失效，请重新登录。' };
  if (status >= 500) return { tone: 'error', message: '服务器暂时不可用，请稍后重试。' };

  if (FIELD_LEVEL.has(type)) return null;

  const message = typeof payload.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : FALLBACK_MESSAGE;
  return { tone: 'error', message };
}

/**
 * 追加一条提示。空消息忽略；同色同文与上一条重复时不重复弹。
 * @param {import('../contracts/state.js').UiState} state
 * @param {{ tone?: unknown, message?: unknown }} [payload]
 * @returns {import('../contracts/state.js').UiState}
 */
export function applyNoticeRaised(state, payload = {}) {
  const raw = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (!raw) return state;

  const message = raw.length > MAX_MESSAGE ? `${raw.slice(0, MAX_MESSAGE - 1)}…` : raw;
  const tone = TONES.includes(payload.tone) ? payload.tone : 'info';

  const list = Array.isArray(state.notices) ? state.notices : [];
  const last = list[list.length - 1];
  if (last && last.tone === tone && last.message === message) return state;

  const seq = (Number(state.noticeSeq) || 0) + 1;
  const notice = { id: `n${seq}`, tone, message };
  const next = [...list, notice].slice(-MAX_NOTICES);

  return { ...state, notices: next, noticeSeq: seq };
}

/**
 * 关掉一条提示；不带 id 视为“全部关掉”。
 * @param {import('../contracts/state.js').UiState} state
 * @param {{ id?: unknown }} [payload]
 * @returns {import('../contracts/state.js').UiState}
 */
export function applyNoticeDismissed(state, payload = {}) {
  const list = Array.isArray(state.notices) ? state.notices : [];
  if (!list.length) return state;

  if (typeof payload.id !== 'string' || payload.id === '') {
    return { ...state, notices: [] };
  }

  const next = list.filter((notice) => notice.id !== payload.id);
  return next.length === list.length ? state : { ...state, notices: next };
}

/**
 * 失败事件 → 状态更新 + 可能的全局提示。
 * 只有切片真的采纳了这条失败（状态引用变了）才提示：过期回包不该弹。
 *
 * @param {import('../contracts/state.js').UiState} previous
 * @param {import('../contracts/state.js').UiTransition} transition
 * @param {import('../contracts/events.js').UiEvent} event
 * @returns {import('../contracts/state.js').UiTransition}
 */
export function withFailureNotice(previous, transition, event) {
  if (transition.state === previous) return transition;

  const notice = noticeFromFailure(event);
  if (!notice) return transition;

  return { ...transition, state: applyNoticeRaised(transition.state, notice) };
}
