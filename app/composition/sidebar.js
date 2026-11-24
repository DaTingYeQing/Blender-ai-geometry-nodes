/* ===== 组装根：侧栏（pilot）=====
 * 把侧栏区域的三件事接起来：
 *   1. 区域 + 组件注册表：View 只认 props，不读任何状态实现；
 *   2. 快照：画布切片 + 会话视图 + 两个读模型按 sidebar.focus 投影；
 *   3. 重画：新状态任何变化都让区域重画（任务、运行态、语言、聚焦都在切片里）；
 *      读模型单独更新（改名 / 删除 / 运行收尾）时由控制器回调 refresh。
 *
 * 聚焦方向：新状态 `sidebar.focus` 是唯一写入方；点击（侧栏 / 画布）都发
 * TEAM_FOCUS_CHANGED。会话动作由 session-control 直接走 Ports。
 *
 * 只做接线，不画界面、不解释业务。侧栏接管 #teamList 后，旧 teams.js
 * 不再挂载（它的事件委托与渲染会和新组件重复）。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { createComponentRegistry } from '../ui/components/registry.js';
import { registerSidebarComponents } from '../ui/components/sidebar/index.js';
import { createSidebarRegion } from '../ui/regions/sidebar.js';
import { createSidebarSnapshot } from './sidebar-snapshot.js';
import { t } from '../ui/platform/i18n.js';

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   readModel: { peekTeams: () => Array<Object>, sessionsOf: (teamId: string) => Array<Object> },
 *   sessionReadModel: { peekSession: (agentId: string, sessionId: string) => any },
 *   animation?: import('../ui/contracts/ports.js').AnimationPort,
 *   document?: Document,
 *   container?: HTMLElement,
 *   translate?: (text: string) => string,
 *   openAgentFolder?: (teamId: string) => void,
 * }} options
 */
export function mountSidebarPilot({
  kernel,
  readModel,
  sessionReadModel,
  animation = null,
  document: doc = globalThis.document,
  container = null,
  translate = t,
  openAgentFolder,
}) {
  if (!doc) throw new Error('mountSidebarPilot: 需要 document');
  if (!kernel) throw new Error('mountSidebarPilot: 需要 kernel（由组装根创建）');
  if (typeof sessionReadModel?.peekSession !== 'function') {
    throw new Error('mountSidebarPilot: 需要 SessionReadModel.peekSession()');
  }

  const { store, focus, root, dispatch } = kernel;

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
  registerSidebarComponents({ registry, document: doc });

  const listEl = container || doc.getElementById?.('teamList') || doc.querySelector?.('#teamList');
  if (!listEl) throw new Error('mountSidebarPilot: 找不到 #teamList');

  const snapshot = createSidebarSnapshot({
    kernel,
    sessionReadModel,
    teamReadModel: readModel,
  });
  /* 区域只认快照；TeamReadModel / SessionReadModel 只在本组装根里出现。 */

  const region = createSidebarRegion({
    parent: root,
    focus,
    dispatch,
    registry,
    store,
    container: listEl,
    document: doc,
    translate,
    getSnapshot: snapshot,
    openAgentFolder,
    animation,
  });

  /* 新状态任何变化都重画；读模型单独更新时由控制器调 refresh()。
   * 聚焦以新状态为唯一写入方，没有反向回灌。 */
  region.refresh();

  /* 侧栏标题行的加号不在 #teamList 里，旧 mountSidebar 挂过它；
   * 停掉旧渲染后由这里接管，直接开新面板（不再绕旧 ui.panel.open）。 */
  const addBtn = doc.querySelector?.('.add-btn');
  let addRequestId = 1;
  function onAdd() {
    focus.activate ? focus.activate('agentPanel') : focus.push('agentPanel');
    void dispatch({
      type: EVENTS.PANEL_OPEN_CLICKED,
      kind: 'mutate',
      payload: { id: 'agentPanel' },
      requestId: addRequestId,
    });
    addRequestId += 1;
    void dispatch({
      type: EVENTS.PANEL_TAB_CLICKED,
      kind: 'mutate',
      payload: { id: 'agentPanel', tab: 'new' },
    });
  }
  addBtn?.addEventListener('click', onAdd);

  /* 加号只在非工作区出现：进入工作区后淡出，避免它和工作区里的操作抢焦点。 */
  const sidebarEl = typeof listEl.closest === 'function' ? listEl.closest('.sidebar') : null;
  function syncAddVisibility() {
    const entered = Boolean(kernel.store.getState()?.workspace?.entered);
    sidebarEl?.classList?.toggle?.('in-workspace', entered);
  }
  const offWorkspace = kernel.store.subscribe?.(syncAddVisibility) || (() => {});
  syncAddVisibility();

  let destroyed = false;
  return {
    region,
    refresh: () => region.refresh(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offWorkspace();
      addBtn?.removeEventListener?.('click', onAdd);
      region.destroy();
    },
  };
}
