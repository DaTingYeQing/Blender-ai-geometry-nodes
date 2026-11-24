/* ===== Effects：设置（语言）=====
 * 命令 → Port → 结果事件。语言偏好是本地能力（SettingsApi），
 * 但语义与后端一致：先落盘，成功后再让新状态变更。
 * 未知语言在状态层已拦一次，这里再兜一次，避免非法值写进持久化。
 */

import { EVENTS, EVENT_KINDS, COMMANDS } from '../contracts/events.js';

function messageOf(error) {
  return String(error?.message || error || '');
}

function normalizeLang(value) {
  return value === 'en' ? 'en' : value === 'zh' ? 'zh' : null;
}

/**
 * @param {{
 *   settingsApi: import('../contracts/ports.js').SettingsApi,
 *   emit: (event: import('../contracts/events.js').UiEvent) => void,
 * }} deps
 */
export function createSettingsEffects({ settingsApi, emit }) {
  if (typeof emit !== 'function') throw new Error('createSettingsEffects: 需要注入 emit(event)');

  function succeed(type, payload = {}) {
    emit({ type, kind: EVENT_KINDS[type] || 'mutate', payload });
  }

  function fail(type, error, extra = {}) {
    const payload = { ...extra, error: messageOf(error) };
    if (error?.code) payload.code = error.code;
    if (error?.status) payload.status = error.status;
    emit({ type, kind: EVENT_KINDS[type] || 'mutate', payload });
  }

  const handlers = {
    [COMMANDS.SETTINGS_LANG_SET]: async ({ lang }) => {
      const next = normalizeLang(lang);
      if (!next) {
        fail(EVENTS.SETTINGS_LANG_FAILED, new Error(`未知语言：${lang}`), { lang });
        return;
      }

      try {
        await settingsApi.setLang({ lang: next });
        succeed(EVENTS.SETTINGS_LANG_CHANGED, { lang: next });
      } catch (error) {
        fail(EVENTS.SETTINGS_LANG_FAILED, error, { lang: next });
      }
    },
  };

  /** 未登记的命令返回 false，方便发现漏接。 */
  async function execute(command) {
    const handler = handlers[command?.type];
    if (!handler) return false;
    await handler(command.payload || {}, command);
    return true;
  }

  return { execute };
}
