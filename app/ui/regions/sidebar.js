/* ===== 区域：侧栏 =====
 * 只负责把 TeamReadModel 的快照和侧栏展开态投影成团队卡片。
 * 卡片内容、点击与动画都留给组件和后续切片；这里不调接口。
 *
 * 当前只在测试与组装根里挂载（`boot()` 通过 composition/sidebar.js 接入）。
 */

import { createRegionHost } from './region-host.js';
import { createErrorBoundary } from './error-boundary.js';
import { EVENTS } from '../contracts/events.js';
import { SIDEBAR_COMPONENT } from '../contracts/component-types.js';

const REGION_ID = 'sidebar';

/**
 * @param {{
 *   parent: any,
 *   focus: any,
 *   dispatch: (event: any) => void,
 *   registry: any,
 *   store: { getState: () => any, subscribe: (fn: () => void) => () => void },
 *   container: HTMLElement,
 *   document: Document,
 *   translate?: (text: string) => string,
 *   getSnapshot: (focus: any) => {
 *     teams?: Array<Object>,
 *     activeTeamId?: string | null,
 *     pane?: string,
 *     sessions?: Array<Object>,
 *     [key: string]: any,
 *   },
 *   openAgentFolder?: (teamId: string) => void,
 *   animation?: import('../contracts/ports.js').AnimationPort,
 * }} options
 */
export function createSidebarRegion(options) {
  const {
    parent,
    focus,
    dispatch,
    registry,
    store,
    container,
    document,
    translate = (text) => text,
    getSnapshot,
    openAgentFolder,
    animation = null,
  } = options;

  if (!container) throw new Error('createSidebarRegion: 需要容器元素');
  if (!store) throw new Error('createSidebarRegion: 需要 store');
  if (typeof getSnapshot !== 'function') {
    throw new Error('createSidebarRegion: 需要 getSnapshot(focus)');
  }

  const host = createRegionHost({ id: REGION_ID, parent, focus, dispatch });
  const ctx = {
    emit: host.emit,
    requestFocus: () => host.requestFocus(),
    /* 宿主能力由组装根注入：区域只转发，不 import Electron。 */
    openAgentFolder: (teamId) => openAgentFolder?.(teamId),
  };

  const boundary = createErrorBoundary({
    container,
    document,
    regionId: REGION_ID,
    title: translate('侧栏暂时不可用'),
    onError: (error) => {
      console.error(`[区域] ${REGION_ID} 渲染失败`, error);
      void dispatch({
        type: EVENTS.REGION_RENDER_FAILED,
        kind: 'observe',
        payload: { regionId: REGION_ID, message: String(error?.message || error) },
      });
    },
  });

  const list = registry.render({
    type: SIDEBAR_COMPONENT.TEAM_LIST,
    props: { teams: [], activeTeamId: null, translate },
  }, ctx);

  container.replaceChildren(list.el);
  host.registerChild(list);

  /* 展开卡的高度 = 列表可用高度 - 它自己的下边距。
   * 量在区域里：组件只拿到一个数字，不读容器尺寸。 */
  function measureExpanded(cardRoot) {
    const available = Number(container.clientHeight) || 0;
    if (available <= 0) return 0;
    const view = document.defaultView;
    const margin = Number.parseFloat(
      view?.getComputedStyle?.(cardRoot)?.marginBottom ?? '0',
    ) || 0;
    return Math.max(0, available - margin);
  }

  function animate(element, keyframes, options) {
    if (typeof animation?.animate !== 'function') return Promise.resolve();
    return animation.animate(element, keyframes, options);
  }

  function resetScroll() {
    if (container.scrollTop) container.scrollTop = 0;
    const parentEl = container.parentElement;
    if (parentEl && parentEl.scrollTop) parentEl.scrollTop = 0;
  }

  function renderInner() {
    const state = store.getState();
    const focus = state.sidebar?.focus || {
      teamId: null,
      nodeId: null,
      edgeId: null,
      pane: 'default',
    };

    /* 区域只消费组装根投影好的纯数据；读模型、会话正文都在外面。
     * getSnapshot 抛错由错误边界兜底，只降级这一块。 */
    const snapshot = getSnapshot(focus) || {};
    const {
      teams: snapshotTeams,
      activeTeamId: snapshotTeamId,
      pane: snapshotPane,
      sessions: snapshotSessions,
      ...extras
    } = snapshot;

    const teams = Array.isArray(snapshotTeams) ? snapshotTeams : [];
    const activeTeamId = snapshotTeamId ?? focus.teamId ?? null;
    const activeTeam = activeTeamId
      ? teams.find((team) => team.id === activeTeamId) || null
      : null;
    const pane = snapshotPane || focus.pane || 'default';
    const sessions = Array.isArray(snapshotSessions)
      ? snapshotSessions
      : (activeTeam?.sessions || []);

    /* 展开时把其余卡片摘出布局（#teamList.has-expanded），并清掉历史滚动。 */
    const expanded = Boolean(activeTeamId && extras.activeNode);
    container.classList.toggle('has-expanded', expanded);
    if (expanded) resetScroll();

    list.update({
      teams,
      activeTeamId,
      pane,
      translate,
      lang: state.settings?.lang,
      sessions,
      activeNode: null,
      activeEdge: null,
      artifacts: [],
      sessionView: null,
      viewSessionId: null,
      transcript: null,
      ...extras,
      measureExpanded,
      animate,
    });
  }

  function render() {
    boundary.run(renderInner);
  }

  host.scope.add(store.subscribe(render));
  render();

  /* 窗口高度变了要重新量展开卡；没有 ResizeObserver 的环境直接跳过。 */
  const ResizeObserverCtor = document.defaultView?.ResizeObserver
    ?? globalThis.ResizeObserver;
  if (typeof ResizeObserverCtor === 'function') {
    const observer = new ResizeObserverCtor(() => render());
    observer.observe(container);
    host.scope.add(() => observer.disconnect());
  }

  return {
    id: REGION_ID,
    host,
    path: host.path,
    refresh: render,
    destroy: host.destroy,
  };
}
