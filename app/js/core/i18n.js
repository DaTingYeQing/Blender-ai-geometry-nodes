/* ===== 前端文案 =====
 * 词表就是 shared/messages.mjs：中文原文当 key，英文缺失时自动回退中文。
 * 语言偏好存在 localStorage（key 和后端请求头一致），切换后整页重载，
 * 这样静态 DOM 和动态文案都能一次刷干净。
 */

import { t as sharedT, getLocale, setLocale } from '../../../shared/messages.mjs';

export { getLocale };
export const t = sharedT;

/* 静态文案：HTML 上标 data-i18n="中文原文"，
 * title / aria-label / placeholder 分别用 data-i18n-title / -aria / -placeholder。 */
export function applyStaticI18n() {
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
  }
  for (const node of document.querySelectorAll('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
}

/** 启动时按当前语言设好词表，并把静态文字翻译一遍。 */
export function initI18n(lang) {
  setLocale(lang === 'en' ? 'en' : 'zh');
  applyStaticI18n();
}
