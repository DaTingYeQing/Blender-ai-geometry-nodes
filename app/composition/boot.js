/* ===== 组装根（Composition Root）=====
 * 全项目唯一 import 具体实现并接线的地方：
 *   - 具体 Adapter（经 composition/api.js 组装成 Ports）
 *   - 全局内核、各个控制器
 *   - 各个 UI 组件
 *
 * 入口 app/js/main.js 只调 boot()。界面组件拿到的都是 Ports / 新状态 / 读模型，
 * 不直接认识 adapters/ 里的任何东西。旧状态内核（store.js / state.js）已退场，
 * 业务事实全部由新状态切片与读模型承担；这里只保留视图本地的 splitter / titlebar 挂载。
 */

import { initI18n, applyLocale, t } from '../ui/platform/i18n.js';
import { pickHue } from '../ui/platform/theme.js';
import { createFlowSaver } from './flow-saver.js';

import { mountSplitter } from '../js/splitter.js';
import { mountTitlebar } from '../js/titlebar.js';
import { mountDragDropLayer } from './dragdrop.js';
import { mountArtifactView } from './artifact.js';
import { mountSaveButtonPilot } from './save-button.js';
import { mountHeroPilot } from './hero.js';
import { mountPanelChrome } from './panel-chrome.js';

import { createApiPorts } from './api.js';
import { mountAgentPanelPilot } from './agent-panel.js';
import { mountLogoPanelPilot } from './logo-panel.js';
import { mountUpdatePilot } from './update.js';
import { mountSidebarPilot } from './sidebar.js';
import { mountCanvasStage } from './canvas.js';
import { mountWorkspaceControl } from './workspace-control.js';
import { mountSessionControl } from './session-control.js';
import { mountTeamControl } from './team-control.js';
import { mountSettingsControl } from './settings-control.js';
import { mountScreenAbort } from './screen-abort.js';
import { createDomAnimationPort } from '../adapters/animation/dom.js';
import { createUiKernel } from './ui-kernel.js';
import { createCommandRouter } from './command-router.js';
import { createInitialUiState } from '../ui/state/initial.js';
import { deriveRoute } from '../ui/state/route.js';
import { createStartupGate } from '../ui/regions/startup-gate.js';
import { createToastHost } from '../ui/regions/toast-host.js';
import { createReporter } from '../ui/observe/reporter.js';
import { createTransitionManager } from '../ui/animator/manager.js';
import { EVENTS } from '../ui/contracts/events.js';
import { createAgentEffects } from '../ui/effects/agent.js';
import { createArtifactEffects } from '../ui/effects/artifact.js';
import { createAgentReadModel } from '../ui/effects/read-model.js';
import { createArtifactReadModel } from '../ui/effects/artifact-read-model.js';
import { createFlowReadModel } from '../ui/effects/flow-read-model.js';
import { createTeamReadModel } from '../ui/effects/team-read-model.js';
import { createRunReadModel } from '../ui/effects/run-read-model.js';
import { createSessionReadModel } from '../ui/effects/session-read-model.js';
import { readPersisted, writePersisted } from '../ui/state/persistence.js';
import { createDebouncedWriter } from '../adapters/local/persistence.js';
import { mountRunController } from './run.js';

/**
 * 首屏失败时判断是“断网”还是“后端没起来”，只用于门的文案。
 * 真正的运行时缺失 / 会话丢失要由对应的 Adapter 上报，这里不猜。
 * @param {unknown} error
 * @returns {'offline' | 'backend_not_ready'}
 */
function classifyStartupError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  const message = String(error?.message || error || '');
  return /failed to fetch|networkerror|load failed|network error/i.test(message)
    ? 'offline'
    : 'backend_not_ready';
}

/**
 * 创建并挂载整个界面。
 * @param {{ fetchImpl?: typeof fetch, storage?: Storage, timeoutMs?: number }} [options]
 */
export function boot(options = {}) {
  /* 存储只解析一次：设置适配器与持久化必须共用同一个来源。 */
  const storage = options.storage
    ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const ports = createApiPorts({ ...options, storage });
  const { agentApi, flowApi, runApi, settingsApi, singleApi, artifactApi } = ports;

  /* 动画 Adapter：全应用一份。UI 只认 AnimationPort，CSS/WAAPI 细节沉在适配层。
   * 测试里可换成 createImmediateAnimationPort()，不依赖真实动画。 */
  const animation = createDomAnimationPort({
    window: globalThis.document?.defaultView ?? globalThis,
  });

  /* ---------- 0. 新架构内核（全局唯一） ---------- */

  /* 新状态的首帧语言 / 模式：优先持久化值，没有才回退设置适配器。
   * 语言之后由 settings.lang.changed 驱动；模式只在设置面板里改。 */
  const persisted = readPersisted(storage);
  const persistedLang = persisted?.settings?.lang
    ?? (settingsApi.getLocale() === 'en' ? 'en' : 'zh');
  const persistedMode = persisted?.settings?.mode ?? 'team';
  const baseUiState = {
    ...createInitialUiState(),
    settings: {
      ...createInitialUiState().settings,
      lang: persistedLang,
      mode: persistedMode,
    },
  };
  /* 首帧路由也从持久化模式派生，避免 solo 用户先闪一下 team 屏。 */
  const initialUiState = { ...baseUiState, route: deriveRoute(baseUiState) };

  /* 全应用只有这一个 UiStore / FocusManager / 根区域；各区域只是它的子树。 */
  const agentReadModel = createAgentReadModel({ agentApi });
  const teamReadModel = createTeamReadModel({
    agents: agentReadModel,
    colorFor: (_agent, index) => pickHue(index),
  });
  const flowReadModel = createFlowReadModel({ flowApi });
  const runReadModel = createRunReadModel({ runApi });
  const sessionReadModel = createSessionReadModel({ agentApi });
  const artifactReadModel = createArtifactReadModel({ artifactApi });

  /* 命令路由器：每个 Effects / 控制器建好后自己注册，组装根不再手写 if 链。
   * 注册顺序就是优先级，集中写在下面的“命令路由表”一处，改顺序只需改那里。 */
  const commandRouter = createCommandRouter({
    onUnhandled: (command) => {
      console.warn(`[命令] 没有处理者：${command?.type || '(无类型)'}`);
    },
  });

  /* 侧栏先留引用：读模型在运行时更新（改名 / 删除 / 会话列表）后要主动重画。 */
  let sidebarPilot = null;
  const onReadModelChange = () => sidebarPilot?.refresh();

  const agentEffects = createAgentEffects({
    agentApi,
    readModel: agentReadModel,
    emit: (event) => void uiKernel.dispatch(event),
  });
  const artifactEffects = createArtifactEffects({
    readModel: artifactReadModel,
    emit: (event) => void uiKernel.dispatch(event),
  });

  const uiKernel = createUiKernel({
    initialState: initialUiState,
    createEffects: () => ({ execute: commandRouter.execute }),
  });

  /* 持久化：只存白名单字段（语言 / 模式），防抖写入；
   * 隐私模式 / 配额满了静默跳过，不影响界面。 */
  const persister = createDebouncedWriter({
    write: (state) => writePersisted(storage, state),
  });
  uiKernel.store.subscribe((state) => persister.save(state));
  globalThis.addEventListener?.('pagehide', () => persister.flush());

  /* 换屏即作废：旧屏幕的在途读取（会话正文 / Agent 配置 / 产物正文）真正中止。
   * 状态层本来就会按 requestId 丢弃晚到的回包，这里只是不再白占连接。 */
  const screenAbort = mountScreenAbort({
    kernel: uiKernel,
    targets: [sessionReadModel, agentReadModel, artifactReadModel],
  });
  globalThis.addEventListener?.('pagehide', () => screenAbort.destroy());

  /* 全局过渡协调者：全应用一个 Animator，各区域往它注册规则。
   * 每次状态变化先算过渡，再把“是否锁输入”投影到页面根。 */
  const transitions = createTransitionManager({
    emit: (event) => void uiKernel.dispatch(event),
  });
  uiKernel.store.subscribe((state, previous) => transitions.apply(previous, state));
  const appRoot = document.querySelector('.app');
  transitions.subscribe(({ locked }) => {
    if (!appRoot) return;
    if (locked) {
      appRoot.setAttribute('aria-busy', 'true');
      appRoot.setAttribute('data-transitioning', 'true');
    } else {
      appRoot.removeAttribute('aria-busy');
      appRoot.removeAttribute('data-transitioning');
    }
  });

  /* 启动门：非 ready 时盖住整个界面，并把业务根标记为 inert。 */
  const startupGate = createStartupGate({
    document,
    translate: t,
    appRoot: document.querySelector('.app'),
  });
  document.body.appendChild(startupGate.el);
  uiKernel.store.subscribe((state) => startupGate.apply(state));
  startupGate.apply(uiKernel.store.getState());

  /* 全局提示：状态里有什么就投影什么；关闭动作回到 store，不直接改状态。 */
  const toastHost = createToastHost({
    document,
    translate: t,
    autoDismissMs: 6000,
    onDismiss: (id) => {
      void uiKernel.dispatch({
        type: EVENTS.NOTICE_DISMISSED,
        kind: 'mutate',
        payload: { id },
      });
    },
  });
  document.body.appendChild(toastHost.el);
  uiKernel.store.subscribe((state) => toastHost.apply(state));
  toastHost.apply(uiKernel.store.getState());

  /* 组装根自己的提示入口：不直接用 DOM，一律进全局提示状态。 */
  function notify(message, tone = 'error') {
    const text = String(message ?? '');
    if (!text) return;
    void uiKernel.dispatch({
      type: EVENTS.NOTICE_RAISED,
      kind: 'mutate',
      payload: { tone, message: text },
    });
  }

  /* 记录员：只读事件流与聚焦，不参与决策。开发版才输出，生产只保留环形缓冲。 */
  const dev = window.piFlow?.dev ?? true;
  const reporter = createReporter({
    store: uiKernel.store,
    focus: uiKernel.focus,
    ignoreTypes: [EVENTS.FOCUS_CHANGED],
    sink: dev
      ? (record) => {
        console.debug(`[ui] ${record.type} ${record.kind}${record.accepted ? '' : ' (dropped)'}`);
      }
      : null,
  });
  if (dev) window.__flowReporter = reporter;

  /* ---------- 1. 控件 ---------- */

  /* 词表必须在任何界面渲染前设好，否则首屏会闪一下另一种语言。 */
  initI18n(persistedLang);

  const saver = createFlowSaver({
    flowApi,
    getState: uiKernel.store.getState,
    getTeams: () => teamReadModel.peekTeams(),
    getFlows: () => flowReadModel.peekFlows(),
    onStateChange: (status) => {
      void uiKernel.dispatch({
        type: EVENTS.WORKSPACE_SAVE_STATE_CHANGED,
        kind: 'mutate',
        payload: { status },
      });
    },
  });

  /* 运行控制器：画布只负责“运行这个节点”，runNode / 轮询 / 收尾事件在 Effects。
   * 收尾时把会话列表写进 AgentReadModel，并主动重画侧栏。 */
  const runControl = mountRunController({
    kernel: uiKernel,
    agentReadModel,
    runApi,
    agentApi,
    artifactApi,
    runReadModel,
    saveFlow: saver.save,
    onReadModelChange,
  });
  globalThis.addEventListener?.('pagehide', () => runControl.destroy());

  /* 工作区：命令 → Effects → Ports，结果投影进画布切片；
   * 团队模式进入时用 TeamReadModel 的颜色装填画布。 */
  const workspaceControl = mountWorkspaceControl({
    kernel: uiKernel,
    flowReadModel,
    teamReadModel,
    flowApi,
    singleApi,
    saveFlow: saver.save,
  });
  globalThis.addEventListener?.('pagehide', () => workspaceControl.destroy());

  /* 会话：读取 / 改名 / 删除 → Effects → AgentApi；结果只写读模型与画布切片。 */
  const sessionControl = mountSessionControl({
    kernel: uiKernel,
    agentReadModel,
    agentApi,
    sessionReadModel,
    saveFlow: saver.save,
    onReadModelChange,
  });
  globalThis.addEventListener?.('pagehide', () => sessionControl.destroy());

  /* 团队：删除 → Effects → AgentApi + FlowApi（pruneFlows），
   * 结果落到读模型与画布切片。 */
  const teamControl = mountTeamControl({
    kernel: uiKernel,
    agentApi,
    flowApi,
    teamReadModel,
    saveFlow: saver.save,
  });
  globalThis.addEventListener?.('pagehide', () => teamControl.destroy());

  /* 设置：语言落盘 → SettingsApi，成功后写进新状态并换词表（带品牌擦除）。 */
  const settingsControl = mountSettingsControl({
    kernel: uiKernel,
    settingsApi,
    applyLocale: (lang) => applyLocale(lang, document),
    translate: t,
  });
  globalThis.addEventListener?.('pagehide', () => settingsControl.destroy());

  /* 命令路由表：顺序就是优先级（与改造前的 if 链一致）。
   * 新增一个用例域只在这里加一行，不用再改内核里的分支。 */
  commandRouter.register('agent', agentEffects.execute);
  commandRouter.register('session', sessionControl.execute);
  commandRouter.register('artifact', artifactEffects.execute);
  commandRouter.register('team', teamControl.execute);
  commandRouter.register('settings', settingsControl.execute);
  commandRouter.register('workspace', workspaceControl.execute);

  /* ---------- 2. 挂组件 ---------- */

  mountSplitter();
  mountTitlebar();
  const artifact = mountArtifactView({
    kernel: uiKernel,
    readModel: artifactReadModel,
    document,
    translate: t,
  });
  globalThis.addEventListener?.('pagehide', () => artifact.destroy());
  const saveButton = mountSaveButtonPilot({
    kernel: uiKernel,
    saver,
    document,
    translate: t,
    toast: notify,
  });
  globalThis.addEventListener?.('pagehide', () => saveButton.destroy());

  /* 侧栏已整块迁到新架构：新区域接管 #teamList，旧 teams.js 不再挂载。
   * 团队与会话列表来自读模型，正文按 session.view 读 SessionReadModel。 */
  sidebarPilot = mountSidebarPilot({
    kernel: uiKernel,
    readModel: teamReadModel,
    sessionReadModel,
    animation,
    document,
    /* 宿主能力只在桌面版存在；浏览器里静默降级成提示。 */
    openAgentFolder: (teamId) => {
      if (!window.piFlow?.openAgentWorkspace) {
        notify(t('当前在浏览器里，只有桌面版能打开目录'));
        return;
      }
      window.piFlow.openAgentWorkspace(teamId)
        .then((error) => {
          if (error) notify(error);      // 成功时返回 null
        })
        .catch((error) => notify(String(error?.message || error)));
    },
  });
  /* 页面卸载时把侧栏的订阅和组件一起收掉，避免在 bfcache 里留下重复监听。 */
  globalThis.addEventListener?.('pagehide', () => sidebarPilot.destroy());

  /* Agent 面板已迁到新架构（View → State → Effects → Ports）。
   * 开合、遮罩与聚焦由新状态 + panel-chrome 负责。 */
  const agentPanel = mountAgentPanelPilot({
    kernel: uiKernel,
    readModel: agentReadModel,
    animation,
    transitions,
  });

  /* 设置面板（语言 / 工作区）同样迁到新架构：
   * 渲染、选择、改名、增删都走新状态；语言由 settings-control 执行并落盘。 */
  const logoPanel = mountLogoPanelPilot({
    kernel: uiKernel,
    readModel: flowReadModel,
    animation,
    transitions,
    notify,
  });

  /* 顶栏更新入口：检查、下载、重启都在组装根，窗口本身只是视图。 */
  const updatePanel = mountUpdatePilot({
    document,
    translate: t,
    notify,
  });
  globalThis.addEventListener?.('pagehide', () => updatePanel.destroy());

  /* 新区域的语言变化统一走 store：语言一变就让自己重画。 */
  uiKernel.store.subscribe((state, previous) => {
    if (state.settings.lang === previous.settings.lang) return;
    agentPanel.refresh();
    logoPanel.refresh();
    sidebarPilot.refresh();
    updatePanel.refresh();
  });
  /* 面板外壳：Esc / 遮罩 / ✕ 与开合后的焦点都在这里。 */
  const panelChrome = mountPanelChrome({ kernel: uiKernel, document, translate: t });
  globalThis.addEventListener?.('pagehide', () => panelChrome.destroy());

  const hero = mountHeroPilot({
    kernel: uiKernel,
    saver,
    animation,
    document,
    translate: t,
    toast: notify,
  });
  globalThis.addEventListener?.('pagehide', () => hero.destroy());

  /* 画布本地 id：时间戳 + 自增，避开刷新后与后端已有 id 撞车。
   * 时钟只出现在组装根，控制器只接收这个工厂。 */
  let localIdSeq = 0;
  const makeLocalId = (prefix) => {
    localIdSeq += 1;
    return `${prefix}-${Date.now().toString(36)}-${localIdSeq}`;
  };

  /* 画布已接管 #wsCanvas / #canvasWorld：渲染、平移缩放、拖节点 / 拉线 /
   * 点击都走新区域；节点与连线的规则在 effects/canvas.js，
   * 由组装根画布控制器写回画布切片。视口是区域本地状态。 */
  const canvas = mountCanvasStage({
    kernel: uiKernel,
    teamReadModel,
    saveFlow: saver.save,
    animation,
    startRun: (id) => runControl.start({ id }),
    stopRun: (id) => runControl.stop({ id }),
    onError: (message) => notify(message),
    document,
    translate: t,
    makeId: makeLocalId,
  });
  globalThis.addEventListener?.('pagehide', () => canvas.destroy());

  /* 拖拽层：侧栏卡片 → 画布 / 垃圾桶。区域只发事件，
   * 落点判定在组装根，动作由画布 / 团队切片各自接住。 */
  const dragDrop = mountDragDropLayer({
    kernel: uiKernel,
    getTeams: () => teamReadModel.peekTeams(),
    screenToWorld: canvas.screenToWorld,
    mainArea: document.getElementById('main'),
    animation,
    document,
  });
  globalThis.addEventListener?.('pagehide', () => dragDrop.destroy());

  /* ---------- 4. 初始数据 ---------- */

  // 首屏数据直接走两个读模型：侧栏 / Agent 面板 / 设置面板稍后读同一份缓存，
  // 不会为“先渲染列表”再发一遍相同请求。
  // UI 里的"团队"就是后端的 Agent，"工作区"就是流程；颜色由前端按序分配。
  (async function bootstrapData() {
    try {
      await Promise.all([
        teamReadModel.getTeams(),
        flowReadModel.getFlows(),
      ]);

      /* 首屏数据到手，应用才算真的可用。 */
      void uiKernel.dispatch({
        type: EVENTS.APP_STATUS_CHANGED,
        kind: 'mutate',
        payload: { status: 'ready' },
      });
    } catch (error) {
      const message = String(error?.message || error || '');
      const status = classifyStartupError(error);
      void uiKernel.dispatch({
        type: EVENTS.APP_STATUS_CHANGED,
        kind: 'mutate',
        payload: { status, detail: message },
      });
    }
  })();
}
