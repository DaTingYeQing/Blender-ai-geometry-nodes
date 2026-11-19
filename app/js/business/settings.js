/* ===== 业务：设置（语言）=====
 * 语言将来多半要跟后端同步（用户偏好），所以放业务状态而不是界面状态。
 */

import { BIZ } from '../core/intent.js';
import { t } from '../core/i18n.js';

export function registerSettings(bus, { api, commit }) {
  bus.handle(BIZ.SETTINGS_SET_LANG, async ({ lang }) => {
    if (lang !== 'zh' && lang !== 'en') throw new Error(t('未知语言：{lang}', { lang }));
    await api.setLang({ lang });
    commit((s) => {
      s.business.settings.lang = lang;
    });
    return { ok: true };
  });
}
