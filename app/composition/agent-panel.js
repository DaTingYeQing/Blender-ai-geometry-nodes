/* ===== 组装根：Agent 配置面板（pilot）=====
 * 这里是唯一同时认识 Ports、Effects、State、Region、Components 和旧内核的地方。
 * 新面板的整条链路：
 *   View(组件) → RegionHost → store.dispatch → reduce → commands → Effects → Ports
 *                                                     ↑ 结果事件回到 dispatch
 *
 * Store / FocusManager / 根区域由 createUiKernel 全局创建一次（见 ./ui-kernel.js），
 * 本文件只把面板作为子树挂到 kernel.root 上，不再自己造内核。
 *
 * 与旧内核的边界只剩语言：旧 i18n 负责切换，refresh() 让组件用新文案重画。
 * 面板显隐、Esc / 遮罩 / ✕ 与聚焦都由新状态和 composition/panel-chrome.js 负责。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { createComponentRegistry } from '../ui/components/registry.js';
import { registerAgentPanelComponents } from '../ui/components/agent-panel/index.js';
import { createAgentPanelRegion } from '../ui/regions/agent-panel.js';
import { applyOverlayPresence } from '../ui/animator/presence.js';
import { ANIMATION_NAMES } from '../ui/animator/animation-names.js';

import { t } from '../ui/platform/i18n.js';
import { paint, pickHue } from '../ui/platform/theme.js';

const PANEL_ID = 'agentPanel';

/* 过渡超时兜底。按过渡类型配置，不再散落在调用处。 */
const PANEL_OPEN_TIMEOUT_MS = 400;
const PANEL_CLOSE_TIMEOUT_MS = 400;

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   readModel: ReturnType<typeof import('../ui/effects/read-model.js').createAgentReadModel>,
 *   transitions: ReturnType<typeof import('../ui/animator/manager.js').createTransitionManager>,
 *   animation?: import('../ui/contracts/ports.js').AnimationPort,
 *   document?: Document,
 * }} options
 */
export function mountAgentPanelPilot({
  kernel,
  readModel,
  transitions,
  document: doc = globalThis.document,
  animation = null,
}) {
  if (!doc) throw new Error('mountAgentPanelPilot: 需要 document');
  if (!kernel) throw new Error('mountAgentPanelPilot: 需要 kernel（由组装根创建）');
  if (typeof transitions?.register !== 'function') {
    throw new Error('mountAgentPanelPilot: transitions 需要 register()（全局协调者）');
  }
  if (typeof animation?.waitUntilDone !== 'function') {
    throw new Error('mountAgentPanelPilot: animation 需要 waitUntilDone()');
  }

  /* ---------- 内核：全局唯一的聚焦、状态、根区域 ---------- */

  const { store, focus, root, dispatch } = kernel;

  /* ---------- 组件与区域 ---------- */

  /* 未知组件类型只上报一次，避免每帧重画都刷事件。 */
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
  registerAgentPanelComponents({ registry, document: doc });

  const container = doc.querySelector('#agentPanel .modal-agent');
  if (!container) throw new Error('mountAgentPanelPilot: 找不到 #agentPanel .modal-agent');

  const region = createAgentPanelRegion({
    parent: root,
    focus,
    dispatch,
    registry,
    store,
    readModel,
    container,
    document: doc,
    translate: t,
    colorFor: (_agent, index) => paint(pickHue(index)),
  });

  /* ---------- 过渡：遮罩的显隐来自状态，Animator 只负责“等动画播完” ---------- */

  const overlay = doc.querySelector('#agentPanel');

  /* 过渡规则注册到全局协调者；面板本身不锁输入（lock: false）。 */
  transitions.register({
    name: 'agentPanel.open',
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
    name: 'agentPanel.close',
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

  /* 显隐投影只依赖状态；过渡的启动/收尾由全局协调者统一驱动。 */
  store.subscribe((state) => applyOverlayPresence(overlay, state, PANEL_ID));
  applyOverlayPresence(overlay, store.getState(), PANEL_ID);

  /* ---------- 初始数据 ---------- */

  void readModel
    .getAgents()
    .then(() => region.refresh())
    .catch(() => {
      /* 读失败由面板空态体现；不在这里弹提示，避免抢旧内核的 toast。 */
    });

  return {
    refresh: () => region.refresh(),
    getState: () => store.getState(),
    destroy: () => {
      /* 只摘自己的区域；store / focus / 根区域归组装根所有。 */
      region.destroy();
    },
  };
}
