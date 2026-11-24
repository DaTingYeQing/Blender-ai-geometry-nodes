/* ===== Settings Adapter：实现 SettingsApi =====
 * 语言偏好属于本机设置，不是 HTTP API，所以放在 adapters/local。
 *
 * 默认英文；用户在界面里切到中文后写入 localStorage。
 * 隐私模式下 localStorage 读写可能抛错，一律忽略，退回内存值。
 */

const LOCALE_KEY = 'pi-flow-locale';

/** @returns {'zh' | 'en'} */
function readLocale(storage) {
  try {
    return storage?.getItem(LOCALE_KEY) === 'zh' ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * @param {{ storage?: Storage }} [options]
 * @returns {{ getLocale: () => ('zh'|'en'), setLang: (args: { lang: 'zh'|'en' }) => Promise<{ ok: boolean }> }}
 */
export function createSettingsAdapter({ storage } = {}) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  let locale = readLocale(store);

  return {
    getLocale() {
      return locale;
    },

    async setLang({ lang }) {
      locale = lang === 'en' ? 'en' : 'zh';
      try {
        store?.setItem(LOCALE_KEY, locale);
      } catch {
        // 隐私模式写不了，保留内存值即可
      }
      return { ok: true };
    },
  };
}
