/* ===== 区域：设置面板（logoPanel）=====
 * 负责：装载组件、把状态算成 props、订阅重画、维护生命周期。
 * 不负责：画 DOM 细节（组件做）、调接口（Effects / ReadModel 做）、
 * 能不能点（这里按状态算出能力位，组件只照着画）。
 *
 * 工作区列表来自 FlowReadModel；宿主能力（打开文件夹）由组装根注入。
 */

import { createRegionHost } from './region-host.js';
import { createErrorBoundary } from './error-boundary.js';
import { createDom } from '../components/dom.js';
import { EVENTS } from '../contracts/events.js';
import { LOGO_PANEL_COMPONENT } from '../contracts/component-types.js';

const PANEL_ID = 'logoPanel';

/**
 * @param {{
 *   parent: any,
 *   focus: any,
 *   dispatch: (event: any) => void,
 *   registry: any,
 *   store: { getState: () => any, subscribe: (fn: () => void) => () => void },
 *   readModel: { peekFlows?: () => Array<Object>, requestState?: (id?: string) => any },
 *   container: HTMLElement,
 *   document: Document,
 *   translate?: (text: string) => string,
 *   onOpenFolder?: () => void,
 * }} options
 */
export function createLogoPanelRegion(options) {
  const {
    parent,
    focus,
    dispatch,
    registry,
    store,
    readModel = {},
    container,
    document,
    translate = (text) => text,
    onOpenFolder,
  } = options;

  if (!container) throw new Error('createLogoPanelRegion: 需要容器元素');
  if (!store) throw new Error('createLogoPanelRegion: 需要 store');

  const t = translate;
  const host = createRegionHost({ id: PANEL_ID, parent, focus, dispatch });
  const { el } = createDom(document);
  const ctx = {
    emit: host.emit,
    requestFocus: () => host.requestFocus(),
    openFolder: () => onOpenFolder?.(),
  };

  const boundary = createErrorBoundary({
    container,
    document,
    regionId: PANEL_ID,
    title: t('此区域暂时不可用'),
    onError: (error) => {
      console.error(`[区域] ${PANEL_ID} 渲染失败`, error);
      void dispatch({
        type: EVENTS.REGION_RENDER_FAILED,
        kind: 'observe',
        payload: { regionId: PANEL_ID, message: String(error?.message || error) },
      });
    },
  });

  /* ---------- 组件 ---------- */

  const nav = registry.render(
    { type: LOGO_PANEL_COMPONENT.NAV, props: { panelId: PANEL_ID, items: [], active: 'lang' } },
    ctx,
  );
  const langToggle = registry.render({ type: LOGO_PANEL_COMPONENT.LANG_TOGGLE, props: {} }, ctx);
  const modeToggle = registry.render({ type: LOGO_PANEL_COMPONENT.MODE_TOGGLE, props: {} }, ctx);
  const list = registry.render({ type: LOGO_PANEL_COMPONENT.WORKSPACE_LIST, props: {} }, ctx);
  const actions = registry.render(
    { type: LOGO_PANEL_COMPONENT.WORKSPACE_ACTIONS, props: { panelId: PANEL_ID } },
    ctx,
  );

  /* ---------- 布局（结构属于区域，内容属于组件） ---------- */

  const soloText = el('p', { className: 'solo-text' });
  const soloInfo = el('div', { className: 'solo-info' }, [soloText]);
  const hint = el('p', { className: 'ws-hint' });

  const langPanel = el('div', { className: 'panel', attrs: { id: 'panel-lang' } }, [langToggle.el]);
  const workspacePanel = el('div', {
    className: 'panel panel-workspace',
    attrs: { id: 'panel-workspace' },
  }, [modeToggle.el, list.el, soloInfo, hint, actions.el]);

  const right = el('div', { className: 'm-right column-top' }, [langPanel, workspacePanel]);
  const close = el('button', {
    className: 'm-close',
    attrs: { type: 'button', title: t('关闭') },
    text: '✕',
  });
  const line = el('div', { className: 'v-line' });

  container.replaceChildren(close, line, nav.el, right);

  for (const handle of [nav, langToggle, modeToggle, list, actions]) {
    host.registerChild(handle);
  }

  /* ---------- 状态 → props ---------- */

  function requestStatus(state, key) {
    return state.workspace?.requests?.[key]?.status || 'idle';
  }

  function flows() {
    const data = readModel.peekFlows?.();
    return Array.isArray(data) ? data : [];
  }

  function emptyText() {
    const status = readModel.requestState?.('list')?.status;
    return status === 'loading' ? t('加载中…') : t('还没有工作区');
  }

  function renderInner() {
    const state = store.getState();
    const tab = state.panelTabs?.[PANEL_ID] === 'workspace' ? 'workspace' : 'lang';
    const lang = state.settings?.lang === 'en' ? 'en' : 'zh';
    const mode = state.settings?.mode === 'solo' ? 'solo' : 'team';
    const selectedId = state.workspace?.selectedId ?? null;
    const busy = ['enter', 'add', 'remove', 'rename']
      .some((key) => requestStatus(state, key) === 'loading');
    const solo = mode === 'solo';

    nav.update({
      panelId: PANEL_ID,
      active: tab,
      items: [
        { id: 'lang', label: t('语言') },
        { id: 'workspace', label: t('工作区') },
      ],
    });

    langToggle.update({
      lang,
      options: [
        { value: 'zh', label: '中文' },
        { value: 'en', label: 'English' },
      ],
    });

    modeToggle.update({
      mode,
      options: [
        { value: 'team', label: t('团队模式') },
        { value: 'solo', label: t('单人模式') },
      ],
    });

    list.update({
      visible: !solo,
      items: flows().map((flow) => ({ id: flow.id, name: flow.name })),
      selectedId,
      disabled: busy,
      editLabel: t('重命名'),
      emptyText: emptyText(),
    });

    actions.update({
      panelId: PANEL_ID,
      labels: {
        folder: t('打开工作区文件夹'),
        add: t('添加'),
        remove: t('删除'),
        cancel: t('取消'),
        confirm: t('确定'),
      },
      canOpenFolder: solo && !busy,
      canAdd: !solo && !busy,
      canRemove: !solo && Boolean(selectedId) && !busy,
      canConfirm: solo ? !busy : Boolean(selectedId) && !busy,
      busy,
    });

    langPanel.hidden = tab !== 'lang';
    workspacePanel.hidden = tab !== 'workspace';
    soloInfo.hidden = !solo;
    soloText.textContent = t('单人模式下直接启动 Pi 终端，会话管理由 Pi 自己负责');
    hint.textContent = t('请及时清理工作区文件，推荐一次任务完成清理一次，否则可能会影响到下次任务的进行');
    close.setAttribute('title', t('关闭'));
  }

  function render() {
    boundary.run(renderInner);
  }

  host.scope.add(store.subscribe(render));
  render();

  return {
    id: PANEL_ID,
    host,
    path: host.path,
    refresh: render,
    destroy: host.destroy,
  };
}
