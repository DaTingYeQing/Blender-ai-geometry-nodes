/* ===== 组装根：设置面板（logoPanel）=====
 * 这里是唯一同时认识 Ports、Effects、State、Region、Components 和读模型的地方。
 * 新面板的整条链路：
 *   View(组件) → RegionHost → store.dispatch → reduce → commands → 执行器
 *                                                     ↑ 结果事件回到 dispatch
 *
 * Store / FocusManager / 根区域由 createUiKernel 全局创建一次（见 ./ui-kernel.js），
 * 本文件只把面板作为子树挂到 kernel.root 上。
 *
 * 过渡期边界（读模型与控制器）：
 *   - 面板开关由 UiState 与 composition/panel-chrome.js 负责；
 *   - 语言落盘与换词由 composition/settings-control.js 负责；
 *   - 工作区命令由 composition/workspace-control.js 执行并写回画布切片；
 *     本文件只负责“进入成功后关面板”。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { createComponentRegistry } from '../ui/components/registry.js';
import { registerLogoPanelComponents } from '../ui/components/logo-panel/index.js';
import { createLogoPanelRegion } from '../ui/regions/logo-panel.js';
import { applyOverlayPresence } from '../ui/animator/presence.js';
import { ANIMATION_NAMES } from '../ui/animator/animation-names.js';

import { t } from '../ui/platform/i18n.js';

const PANEL_ID = 'logoPanel';

/* 过渡超时兜底。按过渡类型配置，不再散落在调用处。 */
const PANEL_OPEN_TIMEOUT_MS = 400;
const PANEL_CLOSE_TIMEOUT_MS = 400;

function messageOf(error) {
  return String(error?.message || error || '');
}

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   readModel: ReturnType<typeof import('../ui/effects/flow-read-model.js').createFlowReadModel>,
 *   transitions: ReturnType<typeof import('../ui/animator/manager.js').createTransitionManager>,
 *   animation?: import('../ui/contracts/ports.js').AnimationPort,
 *   document?: Document,
 *   notify?: (message: string) => void,
 *   openFolder?: () => void,
 * }} options
 */
export function mountLogoPanelPilot({
  kernel,
  readModel,
  transitions,
  document: doc = globalThis.document,
  animation = null,
  notify = () => {},
  openFolder,
}) {
  if (!doc) throw new Error('mountLogoPanelPilot: 需要 document');
  if (!kernel) throw new Error('mountLogoPanelPilot: 需要 kernel（由组装根创建）');
  if (!readModel) throw new Error('mountLogoPanelPilot: 需要 FlowReadModel');
  if (typeof transitions?.register !== 'function') {
    throw new Error('mountLogoPanelPilot: transitions 需要 register()（全局协调者）');
  }
  if (typeof animation?.waitUntilDone !== 'function') {
    throw new Error('mountLogoPanelPilot: animation 需要 waitUntilDone()');
  }

  const { store, focus, root, dispatch } = kernel;
  const win = doc?.defaultView ?? globalThis;

  /* ---------- 组件与区域 ---------- */

  const reportedUnknown = new Set();
  const registry = createComponentRegistry({
    document: doc,
    onUnknown: (type) => {
      if (reportedUnknown.has(type)) return;
      reportedUnknown.add(type);
      void dispatch({
        type: EVENTS.COMPONENT_SKIPPED,
        kind: 'observe',
        payload: { component: type },
      });
    },
  });
  registerLogoPanelComponents({ registry, document: doc });

  const container = doc.querySelector('#logoPanel .modal-logo');
  if (!container) throw new Error('mountLogoPanelPilot: 找不到 #logoPanel .modal-logo');

  /* 文件夹是宿主能力（桌面版 Electron）；浏览器里没有，只提示。 */
  function defaultOpenFolder() {
    if (!win.piFlow?.openSoloWorkspace) {
      notify(t('当前在浏览器里，只有桌面版能打开目录'));
      return;
    }
    win.piFlow.openSoloWorkspace()
      .then((error) => {
        if (error) notify(error);   // 成功时返回 null
      })
      .catch((error) => notify(messageOf(error)));
  }

  const region = createLogoPanelRegion({
    parent: root,
    focus,
    dispatch,
    registry,
    store,
    readModel,
    container,
    document: doc,
    translate: t,
    onOpenFolder: openFolder || defaultOpenFolder,
  });

  /* ---------- 过渡：遮罩显隐来自状态，Animator 只负责“等动画播完” ---------- */

  const overlay = doc.querySelector('#logoPanel');

  transitions.register({
    name: 'logoPanel.open',
    target: PANEL_ID,
    phase: 'opening',
    lock: false,
    when: (prev, next) => prev.transitions?.[PANEL_ID] !== 'opening'
      && next.transitions?.[PANEL_ID] === 'opening',
    play: () => animation.waitUntilDone(overlay, {
      animationName: ANIMATION_NAMES.modalIn,
      timeoutMs: PANEL_OPEN_TIMEOUT_MS,
    }),
  });
  transitions.register({
    name: 'logoPanel.close',
    target: PANEL_ID,
    phase: 'closing',
    lock: false,
    when: (prev, next) => prev.transitions?.[PANEL_ID] !== 'closing'
      && next.transitions?.[PANEL_ID] === 'closing',
    play: () => animation.waitUntilDone(overlay, {
      animationName: ANIMATION_NAMES.modalOut,
      timeoutMs: PANEL_CLOSE_TIMEOUT_MS,
    }),
  });

  store.subscribe((state) => applyOverlayPresence(overlay, state, PANEL_ID));
  applyOverlayPresence(overlay, store.getState(), PANEL_ID);

  /* 语言：滑块只发 settings.lang.submitted，落盘与状态写回由
   * composition/settings-control.js 负责；本面板只按新状态重画。 */

  /* 进入成功后关面板：只改新状态，不再发旧 ui.panel.close。 */
  const stopEntered = store.subscribeEvent(({ event, accepted }) => {
    if (!accepted) return;
    if (event.type !== EVENTS.WORKSPACE_ENTERED) return;
    void dispatch({
      type: EVENTS.PANEL_CLOSE_CLICKED,
      kind: 'mutate',
      payload: { id: PANEL_ID },
    });
  });

  /* ---------- 初始数据 ---------- */

  void readModel
    .getFlows()
    .then(() => region.refresh())
    .catch(() => {
      /* 读失败由面板空态体现；不在这里弹提示，避免抢旧内核的 toast。 */
    });

  return {
    refresh: () => region.refresh(),
    getState: () => store.getState(),
    destroy: () => {
      stopEntered();
      region.destroy();
    },
  };
}
