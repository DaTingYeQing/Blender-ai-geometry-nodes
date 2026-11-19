/* ===== 入口：只做装配，不含任何业务 =====
 * 这个文件里没有一处 if 判断业务规则，没有一处直接碰业务状态。
 * 它干的就三件事：
 *   1. 造出 store 和 bus
 *   2. 把业务登记表、界面登记表挂上去
 *   3. 把各个 UI 组件挂到自己的容器上
 *
 * 加一个功能，改的都不是这里 —— 业务加到 business/，界面加到对应组件。
 * 这个文件长期不变，是刻意的。
 */

import { createStore } from './core/store.js';
import { createBus } from './core/bus.js';
import { toast } from './core/dom.js';
import { BIZ } from './core/intent.js';
import { pickHue } from './core/theme.js';
import { initialState } from './state.js';

import { api } from '../src/host/api.js';
import { initI18n } from './core/i18n.js';
import { createFlowSaver } from './business/flow-sync.js';
import { installBusiness } from './business/index.js';
import { registerPanels } from './panels.js';

import { mountSplitter } from './splitter.js';
import { mountTitlebar } from './titlebar.js';
import { mountArtifactView } from './artifact-view.js';
import { mountSaveButton } from './save-button.js';
import { mountSidebar } from './teams.js';
import { mountModals } from './modals.js';
import { mountHero } from './hero.js';
import { mountCanvas } from './canvas/index.js';
import { mountDragDrop } from './dragdrop.js';

/* ---------- 1. 内核 ---------- */

/* 词表必须在任何界面渲染前设好，否则首屏会闪一下另一种语言。 */
initI18n(api.getLocale());

const store = createStore(initialState());
/* 开发版（含浏览器预览）保持严格：意图没登记直接抛错，能第一时间发现漏挂。
 * 打包版宽松，只 console.warn + 返回失败，不让一条漏登记打断正在跑的流程。 */
const bus = createBus({ dev: window.piFlow?.dev ?? true });

bus.on('toast', toast);                 // handler 抛错 → 总线在这里统一提示

const saver = createFlowSaver({ api, getState: store.getState, commit: store.commit });

const ctx = {
  api,                                  // 唯一的数据出口，接后端时换它
  getState: store.getState,
  commit: store.commit,
  saveFlow: saver.save,                 // 流程改动 -> 防抖整份保存
};

/* ---------- 2. 登记 ---------- */

installBusiness(bus, ctx);              // 业务：团队 / 画布 / 工作区 / agent / 设置
registerPanels(bus, ctx);               // 界面：面板开关、导航页

/* ---------- 3. 挂组件 ---------- */

mountSplitter();
mountTitlebar();
mountArtifactView();
mountSaveButton({ store, saver });
mountSidebar({ store, bus });
mountModals({ store, bus, saver });
mountHero({ store, bus, saver });

const canvas = mountCanvas({ store, bus });

mountDragDrop({
  store,
  bus,
  screenToWorld: canvas.screenToWorld,
  mainArea: document.getElementById('main'),
});

/* ---------- 4. 初始数据 ---------- */

// 首屏一次请求拿真实数据：Agent 列表 + 流程摘要。
// UI 里的"团队"就是后端的 Agent，"工作区"就是流程；颜色由前端按序分配。
(async function bootstrap() {
  try {
    const state = await api.bootstrap();
    const teams = state.agents.map((agent, i) => ({
      id: agent.id,
      name: agent.name,
      sessions: agent.sessions || [],
      ...pickHue(i),
    }));
    const workspaces = state.flows.map((flow) => ({ id: flow.id, name: flow.name }));
    store.commit((s) => {
      s.business.teams = teams;
      s.business.workspaces = workspaces;
      /* 语言偏好存在 localStorage 里，首屏把它同步回界面，滑块才不会和请求头打架。 */
      s.business.settings.lang = api.getLocale();
    });
  } catch (error) {
    toast(String(error?.message || error));
  }
})();
