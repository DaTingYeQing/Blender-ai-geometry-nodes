/* ===== 平台层：界面文案 =====
 * 词表就是 shared/messages.mjs：中文原文当 key，英文缺失时自动回退中文。
 * 语言偏好由 SettingsApi 持久化；切换时先换词、刷静态标记，再让各区域重画。
 *
 * 这一层只做“共享词表 + 静态 DOM”的适配，不持有状态；语言事实在
 * UiState.settings.lang，写入方是设置面板（经 settings-control 落盘后回调 applyLocale）。
 */

import { t as sharedT, getLocale, setLocale } from '../../../shared/messages.mjs';

export { getLocale };
export const t = sharedT;

/* 静态文案：HTML 上标 data-i18n="中文原文"，
 * title / aria-label / placeholder 分别用 data-i18n-title / -aria / -placeholder。 */
export function applyStaticI18n(doc = globalThis.document) {
  if (!doc) return;
  for (const node of doc.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of doc.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
  }
  for (const node of doc.querySelectorAll('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  }
  for (const node of doc.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
}

/**
 * 切到指定语言：换词表、刷静态 DOM、同步 <html lang>。
 * 幂等；组装根（首帧）与设置控制器（切换后）共用。
 * @param {'zh' | 'en'} lang
 */
export function applyLocale(lang, doc = globalThis.document) {
  const next = lang === 'en' ? 'en' : 'zh';
  setLocale(next);
  if (doc?.documentElement) doc.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
  applyStaticI18n(doc);
  return next;
}

/** 启动时按当前语言设好词表，并把静态文字翻译一遍。 */
export function initI18n(lang, doc = globalThis.document) {
  return applyLocale(lang, doc);
}
