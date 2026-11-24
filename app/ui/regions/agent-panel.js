/* ===== 区域：Agent 配置面板 =====
 * 负责：装载组件、把 selector 结果变成 props、订阅状态、维护聚焦与生命周期。
 * 不负责：画 DOM 细节（组件做）、调接口（Effects 做）、判断能不能点（selectors 做）。
 *
 * 它把组件挂进容器后就不再直接改 DOM 了：状态变了就 update props。
 */

import { createRegionHost } from './region-host.js';
import { createErrorBoundary } from './error-boundary.js';
import { createDom } from '../components/dom.js';
import { EVENTS } from '../contracts/events.js';
import { AGENT_PANEL_COMPONENT } from '../contracts/component-types.js';
import {
  activeDraft,
  agentTab,
  canConfirm,
  isSaving,
  requestError,
  requestStatus,
  selectedAgentId,
} from '../state/agent-panel/selectors.js';

const PANEL_ID = 'agentPanel';

/* 工具的技术名由后端给，短说明是界面文案，跟语言走。 */
const TOOL_HINTS = {
  bpy: '几何探针',
  py: 'Python 执行',
  blender: '运行脚本',
  blender_build: '节点构建',
  blender_data: '数据对比',
  blender_fit: '曲线拟合',
  blender_math: '公式生成',
  blender_screen: '场景快照',
  node_query: '节点查询',
  mesh_probe: '网格探针',
  covtrace: '覆盖率追踪',
  wf_plan: '工作流规划',
  hook_skill: '技能注入',
};

/**
 * @param {{
 *   parent: any,
 *   focus: any,
 *   dispatch: (event: any) => void,
 *   registry: any,
 *   store: { getState: () => any, subscribe: (fn: () => void) => () => void },
 *   readModel: any,
 *   container: HTMLElement,
 *   document: Document,
 *   translate?: (text: string) => string,
 *   colorFor?: (agent: any, index: number) => { bg: string, border: string, text: string } | null,
 * }} options
 */
export function createAgentPanelRegion(options) {
  const {
    parent,
    focus,
    dispatch,
    registry,
    store,
    readModel,
    container,
    document,
    translate = (text) => text,
    colorFor = () => null,
  } = options;

  if (!container) throw new Error('createAgentPanelRegion: 需要容器元素');
  if (!store) throw new Error('createAgentPanelRegion: 需要 store');

  const t = translate;
  const host = createRegionHost({ id: PANEL_ID, parent, focus, dispatch });
  const { el } = createDom(document);
  const ctx = { emit: host.emit, requestFocus: () => host.requestFocus() };

  /* 区域级兜底：selector/布局/更新任一处抛错，都只让这个面板降级。 */
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

  const tabs = registry.render(
    { type: AGENT_PANEL_COMPONENT.TABS, props: { panelId: PANEL_ID, items: [], active: 'new' } },
    ctx,
  );
  const list = registry.render(
    { type: AGENT_PANEL_COMPONENT.LIST, props: { agents: [] } },
    ctx,
  );
  const heading = registry.render({ type: AGENT_PANEL_COMPONENT.HEADING, props: {} }, ctx);
  const nameField = registry.render({ type: AGENT_PANEL_COMPONENT.NAME_FIELD, props: {} }, ctx);
  const toolPicker = registry.render({ type: AGENT_PANEL_COMPONENT.TOOL_PICKER, props: {} }, ctx);
  const statusLine = registry.render({ type: AGENT_PANEL_COMPONENT.STATUS, props: {} }, ctx);
  const actions = registry.render(
    { type: AGENT_PANEL_COMPONENT.ACTIONS, props: { panelId: PANEL_ID } },
    ctx,
  );

  /* ---------- 布局（结构属于区域，内容属于组件） ---------- */

  const left = el('div', { className: 'm-left agent-tabs' }, [tabs.el, list.el]);
  const right = el('div', { className: 'm-right agent-main' }, [
    heading.el,
    nameField.el,
    toolPicker.el,
    statusLine.el,
    actions.el,
  ]);
  const close = el('button', {
    className: 'm-close',
    attrs: { type: 'button', title: t('关闭') },
    text: '✕',
  });
  const line = el('div', { className: 'v-line' });

  container.replaceChildren(close, line, left, right);

  for (const handle of [tabs, list, heading, nameField, toolPicker, statusLine, actions]) {
    host.registerChild(handle);
  }

  /* ---------- 状态 → props ---------- */

  let wasOpen = false;
  let autoSelecting = false;

  function collectError(state) {
    return requestError(state, 'agentConfig')
      || requestError(state, 'agentSave')
      || requestError(state, 'agentCreate')
      || requestError(state, 'tools');
  }

  function toolList(state) {
    const data = readModel.peekTools();
    const loading = requestStatus(state, 'tools') === 'loading';
    const names = Array.isArray(data?.tools) ? data.tools : [];
    return {
      tools: names.map((name) => ({
        name,
        hint: TOOL_HINTS[name] ? t(TOOL_HINTS[name]) : '',
      })),
      emptyText: loading ? t('加载中…') : t('没有可用工具'),
    };
  }

  /** 现有页签还没选中时，自动选第一个（区域负责，reducer 不读业务数据）。 */
  function maybeAutoSelect(state, tab, agents) {
    if (tab !== 'existing' || !agents.length) return;
    if (state.panels[PANEL_ID] !== true) return;
    if (state.drafts.agentExisting.agentId) return;
    if (autoSelecting) return;

    autoSelecting = true;
    queueMicrotask(() => {
      autoSelecting = false;
      if (store.getState().drafts.agentExisting.agentId) return;
      host.emit({ type: EVENTS.AGENT_CARD_CLICKED, payload: { agentId: agents[0].id } });
    });
  }

  function renderInner() {
    const state = store.getState();
    const tab = agentTab(state);
    const draft = activeDraft(state);
    const agents = readModel.peekAgents();
    const saving = isSaving(state);
    const { tools, emptyText } = toolList(state);

    tabs.update({
      panelId: PANEL_ID,
      active: tab,
      items: [
        { id: 'new', label: t('新建agent') },
        { id: 'existing', label: t('配置现有agent') },
      ],
      disabled: saving,
    });

    heading.update({
      className: 'dlg-title agent-title',
      text: t(tab === 'existing' ? '配置现有agent' : '新建agent'),
    });

    nameField.update({
      label: t('名称'),
      value: draft.name,
      placeholder: t('给这个 agent 起个名字'),
      disabled: saving,
    });

    toolPicker.update({
      label: t('工具（可多选）'),
      tools,
      selected: draft.tools,
      emptyText,
      disabled: saving,
    });

    list.update({
      visible: tab === 'existing',
      agents: agents.map((agent, index) => ({
        id: agent.id,
        name: agent.name,
        color: colorFor(agent, index),
      })),
      selectedId: selectedAgentId(state),
      emptyText: t('还没有注册 agent'),
      disabled: saving,
    });

    statusLine.update({ message: collectError(state), tone: 'error' });

    actions.update({
      cancelLabel: t('取消'),
      confirmLabel: t('确定'),
      canConfirm: canConfirm(state),
      busy: saving,
    });

    /* 区域自有的静态文案也要随语言刷新，不能只在挂载时翻译一次。 */
    close.setAttribute('title', t('关闭'));

    const open = state.panels[PANEL_ID] === true;
    if (open && !wasOpen) {
      wasOpen = true;
      nameField.focus?.();
    } else if (!open) {
      wasOpen = false;
    }

    maybeAutoSelect(state, tab, agents);
  }

  /* 所有渲染都经边界：状态订阅、首次绘制、外部 refresh 同一入口。 */
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
    focusName: () => nameField.focus?.(),
    destroy: host.destroy,
  };
}
