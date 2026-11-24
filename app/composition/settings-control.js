/* ===== 组装根：设置控制器 =====
 * 语言滑块只发 `settings.lang.submitted`；落盘由 `ui/effects/settings.js` 走
 * SettingsApi，成功后 `settings.lang.changed` 回到新状态（并进持久化白名单）。
 *
 * 这里补两件状态层不做的事：
 *   1. 换词：调 `applyLocale` 换共享词表、刷静态标记。状态层已经让各区域重画，
 *      换词是同步的，不需要遮罩动画；
 *   2. 失败提示：落盘失败进全局提示，不让滑块看起来“换了但没换成”。
 *
 * 语言事实只有 UiState.settings.lang 一处；这一层不再写任何旧状态。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { createSettingsEffects } from '../ui/effects/settings.js';
import { getLocale } from '../ui/platform/i18n.js';

function normalizeLang(value) {
  return value === 'en' ? 'en' : value === 'zh' ? 'zh' : null;
}

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   settingsApi: import('../ui/contracts/ports.js').SettingsApi,
 *   applyLocale?: (lang: 'zh' | 'en') => void,
 *   translate?: (text: string) => string,
 * }} options
 */
export function mountSettingsControl({
  kernel,
  settingsApi,
  applyLocale = () => {},
  translate = (text) => text,
}) {
  if (!kernel || typeof kernel.dispatch !== 'function' || !kernel.store) {
    throw new Error('mountSettingsControl: 需要 kernel');
  }
  if (typeof applyLocale !== 'function') throw new Error('mountSettingsControl: 需要 applyLocale()');

  const { store, dispatch } = kernel;

  const effects = createSettingsEffects({
    settingsApi,
    emit: (event) => void dispatch(event),
  });

  const mirrors = {
    [EVENTS.SETTINGS_LANG_CHANGED](payload) {
      const lang = normalizeLang(payload.lang);
      if (!lang || getLocale() === lang) return;
      /* 状态层已经让各区域按新语言重画；这里同步换词表与静态标记。
       * 两者在同一个事件里完成，不需要遮罩，也不需要串行合并。 */
      applyLocale(lang);
    },

    [EVENTS.SETTINGS_LANG_FAILED](payload) {
      const message = String(payload.error || translate('语言切换失败'));
      void dispatch({
        type: EVENTS.NOTICE_RAISED,
        kind: 'mutate',
        payload: { tone: 'error', message },
      });
    },
  };

  const offResults = store.subscribeEvent(({ event, accepted }) => {
    if (!accepted) return;
    const mirror = mirrors[event?.type];
    if (!mirror) return;
    mirror(event.payload || {});
  });

  let destroyed = false;
  return {
    effects,
    execute: effects.execute,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offResults();
    },
  };
}
