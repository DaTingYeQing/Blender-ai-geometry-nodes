/* ===== 引擎自带的界面意图 =====
 * 面板开关这类动作要跨越组件边界（标题组件要关面板，面板组件负责关），
 * 所以也得走总线 —— 但它不上后端，只改 view 状态。
 *
 * 这就是"业务注册表"和"界面注册表"分开的原因：
 * 业务的每一条都对应一个端点，界面的不对应。两边混在一张表里，
 * 半年后没人分得清哪个能删、哪个动一下就断线上功能。
 */

import { UI } from './core/intent.js';
import { t } from './core/i18n.js';

export function registerPanels(bus, { getState, commit }) {
  bus.handle(UI.PANEL_OPEN, async ({ id }) => {
    if (!getState().view.panels.hasOwnProperty(id)) {
      throw new Error(t('未知面板：{id}', { id }));
    }
    commit((s) => {
      s.view.panels[id] = true;
    });
    return { ok: true };
  });

  bus.handle(UI.PANEL_CLOSE, async ({ id }) => {
    commit((s) => {
      s.view.panels[id] = false;
    });
    return { ok: true };
  });

  bus.handle(UI.PANEL_NAV, async ({ nav }) => {
    commit((s) => {
      s.view.nav = nav;
    });
    return { ok: true };
  });
}
