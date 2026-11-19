/* ===== UI：左侧团队列表 =====
 * 这个文件不知道"团队是怎么来的"，也不知道"点了之后谁在管事"。
 * 它只做两件事：
 *   1. 订阅 business.teams 和 business.focus，把它们投影成 DOM
 *   2. 用户点了，翻译成一个意图发出去
 *
 * 所以它跟画布之间没有一行 import —— 画布点节点时发 team.focus，
 * 这里发现 focus 变了，自己展开。"谁点的"它根本不需要知道。
 *
 * 卡片内的滑块、产物选项属于卡片自己的控件状态，不出这个文件。
 */

import { BIZ, UI } from './core/intent.js';
import { paint } from './core/theme.js';
import { el } from './core/dom.js';
import { t } from './core/i18n.js';
import { renderMarkdown } from '../../shared/markdown.mjs';

export function mountSidebar({ store, bus }) {
  const listEl = document.getElementById('teamList');
  const cards = new Map();   // teamId -> { root, nameEl }

  /* 点空白处收起所有自绘下拉（下拉自己是停在冒泡上的，不会被误关）。 */
  document.addEventListener('click', closeDropdowns);

  let orderKey = '';
  let prevFocusId = null;
  let prevPane = null;
  let prevFocusNodeId = null;
  let prevFocusEdgeId = null;
  let prevDownstreamEdge = null;
  let focusToken = 0;

  /* ---------- 事件：只翻译，不决策 ---------- */

  // 侧栏标题行的加号：打开"注册 agent"面板
  document.querySelector('.add-btn')
    .addEventListener('click', () => bus.send(UI.PANEL_OPEN, { id: 'addPanel' }));

  listEl.addEventListener('click', async (e) => {
    /* 文件夹图标：打开这个 Agent 的项目目录。
     * 桌面端走 Electron 的 openAgentWorkspace；浏览器里没有系统能力，只提示。 */
    const folder = e.target.closest('.ti-folder');
    if (folder) {
      const teamId = folder.closest('.team-item')?.dataset.teamId;
      if (!teamId) return;
      if (window.piFlow?.openAgentWorkspace) {
        window.piFlow.openAgentWorkspace(teamId).then((error) => {
          if (error) bus.emit('toast', error);      // 成功时返回 null
        });
      } else {
        bus.emit('toast', t('当前在浏览器里，只有桌面版能打开目录'));
      }
      return;
    }

    /* 中止运行：只在节点正在跑时可用（禁用态由 render 按节点状态同步）。 */
    const abort = e.target.closest('.ti-x');
    if (abort) {
      if (abort.getAttribute('aria-disabled') === 'true') return;
      const nodeId = store.getState().business.focus.nodeId;
      if (nodeId) bus.send(BIZ.NODE_RUN_STOP, { id: nodeId });
      return;
    }

    /* 对勾 = 确认并退出。发的就是"同一个节点 + 同一个视图"的聚焦意图 ——
     * 业务侧的规则认出"同一个入口又点了一次"，于是把焦点清空、卡片收起。
     * 这样"点对勾"和"再点一次节点"走的是同一条规则，不另立一套收起逻辑。
     * nodeId 取当前聚焦的那个节点（归属），pane 带自己所在的那个视图：
     * 两样都对齐才算是"再点一次"，否则只会切归属/切视图、不会收起
     * （见 business/team.js 里 TEAM_FOCUS 的规则）。 */
    const check = e.target.closest('.ti-check');
    if (check) {
      if (check.getAttribute('aria-disabled') === 'true') return;   // 产物未选中：点不动
      const item = check.closest('.team-item');
      const teamId = item?.dataset.teamId;
      if (!teamId) return;
      const pane = check.closest('.ti-pane-products') ? 'products'
                 : check.closest('.ti-pane-result') ? 'result'
                 : 'default';
      const focus = store.getState().business.focus;

      /* 默认屏的对勾 = 运行这个节点。
       * 任务为空 / 没选工作区由业务层拦下并提示；跑起来后卡片保持展开，
       * 看节点右上角的环。 */
      if (pane === 'default') {
        if (focus.nodeId) bus.send(BIZ.NODE_RUN_START, { id: focus.nodeId });
        return;
      }

    /* 产物屏的对勾 = 确认这条线要带哪些产物 + 给下游写任务。
     * 先收起卡片，再按顺序写任务、写文件并启动下游：并行发会让展开态和运行态打架。 */
      if (pane === 'products' && focus.edgeId) {
        const files = [...item.querySelectorAll('.ti-pane-products .ti-option.active')]
          .map((o) => o.textContent.trim());
        const edge = store.getState().business.edges.find((x) => x.id === focus.edgeId);
        const target = edge && store.getState().business.nodes.find((n) => n.id === edge.to);
        const taskEl = item.querySelector('.ti-pane-products .ti-input-downstream');

        bus.send(BIZ.TEAM_FOCUS, { teamId, nodeId: focus.nodeId, pane });
        if (target && taskEl) {
          await bus.send(BIZ.NODE_TASK_SET, { id: target.id, task: taskEl.value });
        }
        await bus.send(BIZ.EDGE_FILES_SET, { id: focus.edgeId, files });
        return;
      }
      bus.send(BIZ.TEAM_FOCUS, { teamId, nodeId: focus.nodeId, pane });
      return;
    }

    /* 两个二选一滑块：上游产物开关、会话模式。
     * 状态分别记在节点的 handoffEnabled 和 sessionMode 上，
     * 这里只发意图，视觉统一由 render 回填。 */
    const toggle = e.target.closest('.ti-toggle');
    if (toggle) {
      const nodeId = store.getState().business.focus.nodeId;
      if (!nodeId) return;
      const on = toggle.classList.contains('on');   // 当前是否停在第二项
      if (toggle.dataset.field === 'session') {
        // 点一下取反：复用（on）→ 新建；新建 → 复用
        bus.send(BIZ.NODE_SESSION_SET, { id: nodeId, sessionMode: on ? 'new' : 'reuse' });
      } else {
        // 当前"不读取"（on=true）就切回读取（handoffEnabled=true），反之亦然
        bus.send(BIZ.NODE_HANDOFF_SET, { id: nodeId, handoffEnabled: on });
      }
      return;
    }

    // 产物列表：单选（选中的那块用团队色填充）
    const option = e.target.closest('.ti-option');
    if (option) {
      option.parentElement.querySelectorAll('.ti-option').forEach((o) => {
        o.classList.toggle('active', o === option);
      });
      syncConfirm(option.closest('.team-item'));
      return;
    }

    /* 默认屏的对话行：铅笔改名、垃圾桶连点两次删除。
     * 直接读行上记录的 agent / session id，不再绕 focus 去找节点。 */
    const editBtn = e.target.closest('.ti-session-edit');
    if (editBtn) {
      const card = editBtn.closest('.team-item');
      const line = card?.querySelector('.ti-session-line');
      const agentId = line?.dataset.agentId || '';
      const sessionId = line?.dataset.sessionId || '';
      if (card && agentId && sessionId) startSessionRename(card, agentId, sessionId);
      else bus.emit('toast', t('当前没有可操作的对话'));
      return;
    }

    const trashBtn = e.target.closest('.ti-session-trash');
    if (trashBtn) {
      const card = trashBtn.closest('.team-item');
      const line = card?.querySelector('.ti-session-line');
      const agentId = line?.dataset.agentId || '';
      const sessionId = line?.dataset.sessionId || '';
      if (!card || !agentId || !sessionId) {
        bus.emit('toast', t('当前没有可操作的对话'));
        return;
      }
      /* 点一次就删。删的是会话记录，不碰 pi 的会话文件。 */
      bus.send(BIZ.SESSION_DELETE, { agentId, sessionId });
      return;
    }

    /* 「按钮」：请求切到结果视图。
     * 这里只发意图、不碰 DOM —— 切屏的渐变由 applyFocus 那条路径统一做
     * （和"点节点 / 点连线圆点"换视图走的是同一段代码）。 */
    const btn = e.target.closest('.ti-btn');
    if (btn) {
      const teamId = btn.closest('.team-item')?.dataset.teamId;
      if (teamId) bus.send(BIZ.TEAM_FOCUS, { teamId, nodeId: store.getState().business.focus.nodeId, pane: 'result' });
    }
  });

  /* 任务输入框：卡片是按团队画的，但任务属于具体节点 ——
   * 写到当前聚焦的那个节点上（focus.nodeId），这里只发意图，不碰状态。 */
  listEl.addEventListener('input', (e) => {
    const input = e.target.closest('.ti-input');
    if (!input) return;

    /* 产物屏那个框写的是**下游**节点的任务。 */
    if (input.classList.contains('ti-input-downstream')) {
      const edgeId = store.getState().business.focus.edgeId;
      const edge = edgeId && store.getState().business.edges.find((x) => x.id === edgeId);
      if (edge) bus.send(BIZ.NODE_TASK_SET, { id: edge.to, task: input.value });
      return;
    }

    const nodeId = store.getState().business.focus.nodeId;
    if (!nodeId) return;
    bus.send(BIZ.NODE_TASK_SET, { id: nodeId, task: input.value });
  });

  /* 结果屏的下拉：选了哪段对话，就把它读出来显示。
   * 这里只发意图，正文由业务层读进 state，再回来渲染。 */
  listEl.addEventListener('change', (e) => {
    /* 复用对话：把选中的会话 id 记到节点上（后端按内部 session.id 找会话）。 */
    const reuse = e.target.closest('.ti-session-select');
    if (reuse) {
      const nodeId = store.getState().business.focus.nodeId;
      if (nodeId && reuse.value) {
        bus.send(BIZ.NODE_SESSION_SELECT, { id: nodeId, sessionId: reuse.value });
      }
      return;
    }

    const sel = e.target.closest('.ti-out-select');
    if (!sel) return;
    const nodeId = store.getState().business.focus.nodeId;
    const node = nodeId ? store.getState().business.nodes.find((n) => n.id === nodeId) : null;
    if (!node || !sel.value) return;
    bus.send(BIZ.SESSION_LOAD, { agentId: node.agentId, sessionId: sel.value });
  });

  /* ---------- 渲染 ---------- */

  function render(state) {
    const { teams } = state.business;

    /* 展开态不是独立的开关，是"人正待在工作区里、并且选中了某个团队"的表现。
     * 所以只要没在工作区，这里一律当成没选中 —— 不管 focus 是被谁留下的、
     * 是残留的还是别处设的，左边都必须是七条彩虹，不会出现
     * "大标题已经飞回中间，侧栏还挂着一张展开的卡"那种状态。
     *
     * 把它写成推导而不是再加一处"记得清 focus"，是因为漏清的机会永远存在：
     * 退出工作区以后还会不会有别的入口、以后加了快捷键、面包屑、手势 ——
     * 只要是人不在工作区，这条推导就一直成立。 */
    const focus = state.business.workspace.entered
      ? state.business.focus
      : { teamId: null, nodeId: null, edgeId: null, pane: 'default' };

    // 1. 补上新增的
    for (const team of teams) {
      if (!cards.has(team.id)) cards.set(team.id, createCard(listEl, team));
    }

    // 2. 摘掉已删的
    for (const [id, card] of cards) {
      if (!teams.some((t) => t.id === id)) {
        card.root.remove();
        cards.delete(id);
      }
    }

    // 3. 顺序（只在真的变了才动 DOM，避免每帧 append 打断过渡）
    const key = teams.map((t) => t.id).join(',');
    if (key !== orderKey) {
      orderKey = key;
      for (const team of teams) listEl.appendChild(cards.get(team.id).root);
    }

    // 4. 内容
    for (const team of teams) {
      const card = cards.get(team.id);
      if (card.nameEl.textContent !== team.name) card.nameEl.textContent = team.name;
    }

    // 5. 展开态
    applyFocus(focus);

    /* 6. 任务输入回填：换节点才写 DOM。
     * 每次打字都会 commit、都会走到这里，无条件回写会把光标顶到末尾。 */
    const focusNodeId = state.business.workspace.entered ? state.business.focus.nodeId : null;
    if (focusNodeId !== prevFocusNodeId) {
      prevFocusNodeId = focusNodeId;
      fillTask(state, focusNodeId);
    }

    // 7. 两个二选一滑块：每次提交都同步（纯切换，没有光标问题）
    syncToggles(state, focusNodeId);
    syncSessionLine(state, focusNodeId);
    syncAbort(state, focusNodeId);
    syncReuseSelect(state, focusNodeId);

    /* 8. 产物屏：按这条线起点节点的产物重建列表。
     * 列表变了要重建；刚打开这条线时按 edge.files 回填选中。
     * 其余提交（打字、运行状态）不碰选中，免得把用户正在勾的草稿冲掉。 */
    const focusEdgeId = state.business.workspace.entered ? state.business.focus.edgeId : null;
    const edgeChanged = focusEdgeId !== prevFocusEdgeId;
    prevFocusEdgeId = focusEdgeId;
    syncEdgeFiles(state, focusEdgeId, edgeChanged);
    syncDownstreamTask(state, focusEdgeId, edgeChanged);

    // 9. 结果屏：填充这个 Agent 的对话列表，并显示当前选中的那段
    if (state.business.workspace.entered && state.business.focus.pane === 'result') {
      syncSessionPane(state, focusNodeId);
    }
  }

  /* 结果屏：下拉列出这个节点所属 Agent 的对话（只算 pi 已经落盘的），
   * 正文从 sessionView 投影出来。 */
  function syncSessionPane(state, nodeId) {
    if (!nodeId) return;
    const node = state.business.nodes.find((n) => n.id === nodeId);
    const team = node && state.business.teams.find((t) => t.id === node.agentId);
    const card = node ? cards.get(node.agentId) : null;
    if (!card || !team) return;

    /* 正在运行时显示实时转录；跑完再回到完整会话（N2）。 */
    if (node.running) {
      renderLive(card, node);
      return;
    }
    card.liveKey = '';

    const sessions = (team.sessions || []).filter((s) => s.piSessionId);
    /* key 里带上标题：只改名字不动 id，只按 id 比会一直用旧文本。 */
    const key = sessions.map((s) => `${s.piSessionId}:${s.title || ''}`).join(',');
    if (card.sessionKey !== key) {
      card.sessionKey = key;
      const options = sessions.length
        ? sessions.map((s) => {
            const option = document.createElement('option');
            option.value = s.piSessionId;
            option.textContent = s.title || s.piSessionId;
            return option;
          })
        : [Object.assign(document.createElement('option'), { value: '', textContent: t('暂无对话') })];
      card.outSelect.replaceChildren(...options);
      card.outSelect.__sync?.();
    }

    renderSession(card, state.business.sessionView);

    /* 第一次打开结果屏（或换了节点）时，自动读下拉里选中的那段对话，
     * 免得一片空白。读完 sessionView 就与选中项一致，不会重复请求。 */
    const selected = card.outSelect.value;
    const view = state.business.sessionView;
    if (selected && (view.agentId !== node.agentId || view.sessionId !== selected)) {
      bus.send(BIZ.SESSION_LOAD, { agentId: node.agentId, sessionId: selected });
    }
  }

  /* 运行中的实时转录：thinking / 回复用 Markdown 渲染，工具调用保持纯文本。 */
  function renderLive(card, node) {
    const entries = node.transcript || [];
    const last = entries[entries.length - 1];
    const key = `live|${entries.length}|${last?.text?.length || 0}|${last?.status || ''}`;
    if (card.liveKey === key) return;
    card.liveKey = key;
    card.sessionViewKey = '';   // 跑完切回历史会话时要重画

    const out = card.outbox;
    if (!entries.length) {
      out.textContent = t('正在启动…');
      return;
    }

    const format = (value) => (typeof value === 'string' ? value : JSON.stringify(value ?? ''));

    out.replaceChildren(...entries.map((entry) => {
      const box = document.createElement('div');
      if (entry.type === 'tool') {
        box.className = 'ti-entry tool';
        const status = entry.status === 'running' ? t('运行中') : entry.isError ? t('失败') : t('完成');
        box.textContent = `${t('[工具]')} ${entry.toolName || ''} ${format(entry.args)}`.trim()
          + ` · ${status}`
          + (entry.durationMs != null ? ` (${entry.durationMs}ms)` : '');
        return box;
      }
      box.className = `ti-entry ${entry.type === 'thinking' ? 'thinking' : 'assistant'}`;
      box.innerHTML = renderMarkdown(entry.text || '');
      return box;
    }));

    const scroll = out.closest('.ti-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;   // 实时内容跟着最新一条走
  }

  /* 会话正文：文本类后端已经渲染成 HTML（渲染前整体转义过），
   * 工具调用保持纯文本，用 textContent 写。 */
  function renderSession(card, view) {
    const key = view
      ? `${view.sessionId}|${view.loading}|${view.error}|${view.missing}|${view.entries.length}`
      : '';
    if (card.sessionViewKey === key) return;
    card.sessionViewKey = key;

    const out = card.outbox;
    if (!view || !view.sessionId) {
      out.textContent = t('选择一段对话查看内容');
      return;
    }
    if (view.loading) {
      out.textContent = t('加载中…');
      return;
    }
    if (view.error) {
      out.textContent = view.error;
      return;
    }
    if (view.missing) {
      out.textContent = t('这段对话还没有落盘内容。');
      return;
    }
    if (!view.entries.length) {
      out.textContent = t('暂无内容');
      return;
    }
    out.replaceChildren(...view.entries.map((entry) => {
      const box = document.createElement('div');
      box.className = `ti-entry ${entry.kind || ''}`.trim();
      if (entry.kind === 'tool') {
        box.textContent = `[工具] ${entry.name || ''} ${entry.args || ''}`.trim()
          + (entry.output ? `\n${entry.output}` : '');
        return box;
      }
      box.innerHTML = entry.html || '';
      return box;
    }));
    const scroll = out.closest('.ti-scroll');
    if (scroll) scroll.scrollTop = 0;
  }

  /* 产物屏的下游任务框：换线时用下游节点的 task 回填。
   * 只在换线 / 刚打开时写，否则每次 commit 都会把光标顶到末尾。 */
  function syncDownstreamTask(state, edgeId, force) {
    if (!edgeId) {
      prevDownstreamEdge = null;
      return;
    }
    if (!force && prevDownstreamEdge === edgeId) return;
    prevDownstreamEdge = edgeId;

    const edge = state.business.edges.find((e) => e.id === edgeId);
    const target = edge && state.business.nodes.find((n) => n.id === edge.to);
    const card = cards.get(state.business.focus.teamId);
    const input = card?.root.querySelector('.ti-input-downstream');
    if (target && input) input.value = target.task || '';
  }

  /* 产物选中状态来自这条线的 edge.files。
   * 列表本身来自这条线起点节点最近一次运行收集到的文件。 */
  function syncEdgeFiles(state, edgeId, forceFill) {
    if (!edgeId) return;
    const edge = state.business.edges.find((e) => e.id === edgeId);
    const card = cards.get(state.business.focus.teamId);
    if (!edge || !card) return;

    const source = state.business.nodes.find((n) => n.id === edge.from);
    /* 产物屏标题旁边显示这是第几次运行：run-001 → run 001。 */
    if (card.runTag) {
      const label = source?.runId ? String(source.runId).replace(/^run-/, 'run ') : '';
      if (card.runTag.textContent !== label) card.runTag.textContent = label;
    }

    /* 只拉一次；跑完运行后 business 会把 artifactsLoaded 置回 false。 */
    if (source && !source.artifactsLoaded && source.runId) {
      bus.send(BIZ.ARTIFACTS_LOAD, { id: source.id });
    }

    const artifacts = (source && source.artifacts) || [];
    const key = artifacts.map((file) => file.name).join('|');
    const rebuilt = card.artifactsKey !== key;
    if (rebuilt) {
      card.artifactsKey = key;
      if (artifacts.length) {
        card.artifactsList.replaceChildren(...artifacts.map((file) => {
          const option = document.createElement('div');
          option.className = 'ti-option';
          option.textContent = file.name;      // 文件名用 textContent，不拼 HTML
          /* 右侧查看器要靠这两个字段读文件内容 */
          option.dataset.name = file.name;
          option.dataset.path = file.path || '';
          return option;
        }));
      } else {
        const empty = document.createElement('p');
        empty.className = 'ti-empty';
        empty.textContent = t('还没有产物');
        card.artifactsList.replaceChildren(empty);
      }
    }

    if (rebuilt || forceFill) {
      const chosen = new Set(edge.files || []);
      card.artifactsList.querySelectorAll('.ti-option').forEach((opt) => {
        opt.classList.toggle('active', chosen.has(opt.textContent.trim()));
      });
      syncConfirm(card.root);
    }
  }

  /* 滑块状态：on 类 = 停在第二项。
   * 每次 render 都按状态重设 —— 点击只改状态，视觉必须从状态推出来。 */
  function syncToggles(state, nodeId) {
    if (!nodeId) return;
    const node = state.business.nodes.find((n) => n.id === nodeId);
    const card = node ? cards.get(node.agentId) : null;
    if (!card) return;
    setToggle(card.handoffToggle, node.handoffEnabled === false);
    setToggle(card.sessionToggle, node.sessionMode === 'reuse');
  }

  /* 默认屏那一行：显示这个节点当前对话的名字。
   * 优先级：本次选中的 > 最近运行用过的 > 这个 Agent 最新的一段。 */
  function syncSessionLine(state, nodeId) {
    if (!nodeId) return;
    const node = state.business.nodes.find((n) => n.id === nodeId);
    const team = node && state.business.teams.find((t) => t.id === node.agentId);
    const card = node ? cards.get(node.agentId) : null;
    if (!card || !team) return;

    const list = team.sessions || [];
    const session = list.find((s) => s.id === node.sessionId)
      || list.find((s) => s.id === node.lastSessionId)
      || list[0]
      || null;

    /* 自愈：上一次改名如果留下一个脱了 DOM 的名字元素，补回对话行。
     * （输入框还在编辑时不插手，避免把用户正在输的框顶掉。） */
    if (!card.sessionName.isConnected && !card.sessionLine.querySelector('.ti-session-name-input')) {
      card.sessionLine.insertBefore(card.sessionName, card.sessionLine.firstChild);
    }

    const name = session ? (session.title || session.piSessionId || t('未命名对话')) : t('暂无对话');
    if (card.sessionName.textContent !== name) card.sessionName.textContent = name;
    card.sessionName.title = name;
    card.sessionLine.dataset.sessionId = session?.id || '';
    card.sessionLine.dataset.agentId = node.agentId || '';
    /* 没有对话时两个图标压暗：说明它们确实没东西可操作。 */
    for (const icon of card.sessionLine.querySelectorAll('.ti-session-edit, .ti-session-trash')) {
      icon.setAttribute('aria-disabled', String(!session));
    }
  }

  /* 内联改名：回车保存、Esc 取消、点输入框外面也保存。
   * 第一个参数是卡片的 DOM 根（不是 cards 里那份对象），元素都从它查。 */
  function startSessionRename(cardRoot, agentId, sessionId) {
    const team = store.getState().business.teams.find((item) => item.id === agentId);
    const session = team?.sessions?.find((s) => s.id === sessionId);
    if (!session) {
      bus.emit('toast', t('找不到这段对话'));
      return;
    }

    const line = cardRoot.querySelector('.ti-session-line');
    let nameEl = cardRoot.querySelector('.ti-session-name');
    if (!line) {
      bus.emit('toast', t('对话行不在页面上'));
      return;
    }

    /* 已经在编辑就直接聚焦，别重复插输入框。 */
    const editing = line.querySelector('.ti-session-name-input');
    if (editing) {
      editing.focus();
      editing.select();
      return;
    }

    /* 名字元素不在页面上的话先补回去。 */
    if (!nameEl) {
      nameEl = document.createElement('span');
      nameEl.className = 'ti-session-name';
      line.insertBefore(nameEl, line.firstChild);
    }

    const input = document.createElement('input');
    input.className = 'ti-session-name-input';
    input.value = session.title || '';
    nameEl.replaceWith(input);
    /* 等这一轮点击事件走完再拿焦点，避免刚插入就被后续事件弄失焦。 */
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });

    let done = false;
    let onOutside = null;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (onOutside) document.removeEventListener('pointerdown', onOutside, true);
      const title = input.value.trim();
      /* input 可能已经不在了，兜底把名字元素插回对话行，别让它永久消失。 */
      if (input.isConnected) input.replaceWith(nameEl);
      else if (!nameEl.isConnected) line.insertBefore(nameEl, line.firstChild);
      if (!save || !title || title === session.title) return;
      bus.send(BIZ.SESSION_RENAME, { agentId, sessionId, title });
    };

    /* 点别处 = 保存。延迟一帧再挂，否则当前这次点击会立刻把自己关掉。 */
    onOutside = (event) => {
      if (event.target === input) return;
      finish(true);
    };
    setTimeout(() => {
      if (!done) document.addEventListener('pointerdown', onOutside, true);
    }, 0);

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
  }

  function setToggle(toggle, on) {
    toggle.classList.toggle('on', on);
    toggle.setAttribute('aria-checked', String(on));
    toggle.querySelectorAll('.ti-opt').forEach((opt, i) => {
      opt.classList.toggle('active', (i === 1) === on);
    });
  }

  /* 中止按钮只在节点正在跑时可用；没在跑就压暗、点不动。 */
  function syncAbort(state, nodeId) {
    if (!nodeId) return;
    const node = state.business.nodes.find((n) => n.id === nodeId);
    const card = node ? cards.get(node.agentId) : null;
    if (!card) return;
    card.abortBtn.setAttribute('aria-disabled', String(!node.running));
  }

  /* 复用对话的下拉：只在"复用对话"时出现，列出这个 Agent 的所有对话。
   * value 用内部 session.id —— 后端 beginSession 就是按这个找的。 */
  function syncReuseSelect(state, nodeId) {
    if (!nodeId) return;
    const node = state.business.nodes.find((n) => n.id === nodeId);
    const team = node && state.business.teams.find((t) => t.id === node.agentId);
    const card = node ? cards.get(node.agentId) : null;
    if (!card || !team) return;

    const sessions = team.sessions || [];
    /* 同上：标题变了也要重建选项。 */
    const key = sessions.map((s) => `${s.id}:${s.title || ''}`).join('|');
    if (card.reuseKey !== key) {
      card.reuseKey = key;
      const options = sessions.length
        ? sessions.map((s) => {
            const option = document.createElement('option');
            option.value = s.id;
            option.textContent = s.title || s.id;
            return option;
          })
        : [Object.assign(document.createElement('option'), { value: '', textContent: t('暂无对话') })];
      card.sessionSelect.replaceChildren(...options);
    }

    if (node.sessionId) card.sessionSelect.value = node.sessionId;
    card.sessionSelect.__sync?.();
    card.sessionSelectWrap.hidden = node.sessionMode !== 'reuse';
  }

  /* 任务属于节点：同一个团队的多个副本各有各的任务。
   * 换节点时把卡片里那行字换成该节点的 task，空任务就是空框。 */
  function fillTask(state, nodeId) {
    if (!nodeId) return;
    const node = state.business.nodes.find((n) => n.id === nodeId);
    const card = node ? cards.get(node.agentId) : null;
    if (card) card.input.value = node.task || '';
  }

  /* 展开/收起走双 rAF：同一帧里改类，浏览器会把过渡起点和终点合并成一次
   * 样式计算，过渡被跳过 —— 表现就是"第一次点没动画、直接跳到位"。
   * 双 rAF 保证上一帧真的落地了再加类。连点靠 token 只让最后一次生效。
   *
   * 例外是"同一个节点的两个窗口互切"（点节点 → 默认屏；点连线上的圆点 → 产物屏）：
   * 那条路径不走双 rAF，而是先把当前这屏淡出、再换类、再淡入 —— 见下面的 fadeSwap。
   * 同一个节点的两张脸，换脸也该是渐变，不该硬跳。 */
  function applyFocus(focus) {
    if (focus.teamId === prevFocusId && focus.pane === prevPane) return;

    const sameTeam = focus.teamId !== null && focus.teamId === prevFocusId;
    const paneChanged = sameTeam && focus.pane !== prevPane;
    // 是不是"从列表里挑出一张来展开"（而不是在已展开的卡上换视图）
    const expandFromSlot = focus.teamId !== null && focus.teamId !== prevFocusId;
    // 改动前是谁展开着 —— 收起动画要把它送回自己那个槽位
    const wasFocused = prevFocusId;

    prevFocusId = focus.teamId;
    prevPane = focus.pane;

    const token = ++focusToken;

    /* 把展开态和视图态真正落到 DOM 上 */
    function commit() {
      // 上一次的收起动画还没播完就来了新状态：先把它落地，再按新状态重来。
      // 这里马上要铺新布局，不播"回位"动画（settle=false），免得刚进场又被藏起来。
      if (pendingCollapse) collapseDone(false);

      const open = focus.teamId !== null;
      const target = expandFromSlot ? cards.get(focus.teamId) : null;

      /* 它原本排在列表的第几个位置 —— 动画要从这里长起来，而不是从最顶上。
       * 此刻还没加 has-expanded，所有卡都在流里，直接量就行；
       * 万一是"从另一张已展开的卡切过来"，目标卡此刻是 display:none 量不到，
       * 退回按序号算（收起态每张 = 44 高 + 8 下边距 = 52）。 */
      let slotTop = 0;
      if (target) {
        const listTop = listEl.getBoundingClientRect().top;
        const rect = target.root.getBoundingClientRect();
        slotTop = rect.height > 0
          ? rect.top - listTop
          : [...listEl.children].indexOf(target.root) * 52;
      }

      /* 收起：从"满高、贴在列表顶上"收回"44 高、它自己那一格"，
       * 上边往下压、下边往上收，两边同时往槽位收 —— 展开那条路倒着走一遍。
       * 这 0.45s 里 has-expanded 先别摘，其余卡片保持不占位，
       * 否则它们一回来就会把正在收缩的那张盖住。
       * 布局等动画播完再落，落点和动画终点完全一致，不会有第二下。 */
      const leaving = !open && wasFocused ? cards.get(wasFocused) : null;
      if (leaving && !pendingCollapse) {
        const idx = [...listEl.children].indexOf(leaving.root);
        const backTop = Math.max(0, idx * 52);
        const from = Math.max(44, leaving.root.getBoundingClientRect().height);
        const anim = leaving.root.animate(
          [
            { height: from + 'px', transform: 'translateY(0px)' },
            { height: '44px', transform: `translateY(${backTop}px)` },
          ],
          { duration: 450, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
        pendingCollapse = { card: leaving, anim };
        anim.finished
          .then(() => { if (pendingCollapse && pendingCollapse.anim === anim) collapseDone(); })
          .catch(() => {});
        return;                     // 布局先不动，等动画
      }

      /* 展开（从槽位里挑一张出来）：先"推开"其余卡片，推完再摘出布局、放大目标卡。
       * 推的过程里其余卡还在流里、高度不变，所以没有多方博弈；
       * 只有它们淡出之后才动布局，整个放大阶段仍然只有目标卡在变尺寸。
       * 从"已展开的 A 切到 B"不经过这里（has-expanded 已在），走下面的同步落地。 */
      if (open && target && !listEl.classList.contains('has-expanded')) {
        pushAway(target.root, () => {
          if (token !== focusToken) return;
          applyLayout(open, target, slotTop);
        }, token);
        return;
      }

      applyLayout(open, target, slotTop);
    }

    /* 布局落地：加 has-expanded、给目标卡 fitExpanded、补位移补偿。
     * 从 commit 里抽出来，是因为"从槽位展开"这条路要等 pushAway 把其余卡片
     * 推开之后才落；而"换视图 / 已展开状态下切换"仍走同步这条。 */
    function applyLayout(open, target, slotTop) {
      listEl.classList.toggle('has-expanded', open);
      if (open) resetScroll();          // 清掉历史滚动，展开的方块才能从顶部铺满
      for (const [id, card] of cards) {
        const isFocus = id === focus.teamId;
        card.root.classList.toggle('expanded', isFocus);
        card.root.classList.toggle('mode-products', isFocus && focus.pane === 'products');
        /* "停在哪一屏"是 focus 的一个维度（pane），不再是卡片自己的类记忆。
         * 这样"收起再打开还停在结果屏"这种隐式行为消失了：focus 一清就回到默认屏，
         * 而且别处要判断这张卡在干嘛，读 state 就行。 */
        card.root.classList.toggle('mode-result', isFocus && focus.pane === 'result');
        // 展开的那张写成量出来的像素；其余的撤掉内联高度，交回 44px 那条规则
        if (isFocus) {
          /* 从"另一张展开的卡"直接切过来时，这张卡可能还停在上一轮 pushAway
           * 的终点（opacity:0）。先撤掉残留动画，否则展开的是一张透明的卡。 */
          card.root.getAnimations()
            .filter((a) => a.id === 'pushAway')
            .forEach((a) => a.cancel());
          fitExpanded(card.root);
        } else {
          card.root.style.height = '';
        }
      }

      /* 位置不靠占位，靠位移补偿。
       * "其余卡片直接摘出布局"解决了跳动，但也让它失去起点 —— 它变成列表里
       * 唯一的一项，只能从最顶上长。这里给它补一段 translate：从原槽位画起，
       * 一边归位一边把高度撑满，视觉上就是"从那张卡的位置上下同时扩开"。
       * 高度走 CSS 过渡、位移走 WAAPI，同一条曲线同时长，终点都是最终布局。 */
      if (target && slotTop > 0.5) {
        target.root.animate(
          [{ transform: `translateY(${slotTop}px)` }, { transform: 'translateY(0px)' }],
          { duration: 450, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
      }
      // 收起再展开这条路径不经过 fadeSwap，得在这里把残留的 opacity:0 清掉，
      // 否则重新展开时会看到一张空卡片（成因见 clearStaleFades）
      if (focus.teamId) {
        const cur = cards.get(focus.teamId);
        if (cur) clearStaleFades(cur.root);
      }
      // 布局落定后再清一次：内容是收缩完才变短的，滚动位置会在那一刻被夹紧，
      // 夹紧就是整体窜一下 —— 量出来正好是"卡片整体下移 6px、尺寸没变"。
      if (open) requestAnimationFrame(resetScroll);

      // 没有 leaving 卡的收起路径（比如"展开时把团队拖进垃圾桶删掉"）：
      // 其余卡从 display:none 变回可见，但身上可能还挂着 pushAway 留下的
      // opacity:0（fill:forwards）。把它们撤掉，否则会看到一排透明卡。
      if (!open) {
        for (const card of cards.values()) {
          card.root.getAnimations().forEach((a) => a.cancel());
        }
      }
    }

    const card = cards.get(focus.teamId);

    if (paneChanged && card) {
      // 同一个人，换一张脸：淡出旧的 → 换类 → 淡入新的
      fadeSwap(card.root, commit, () => token === focusToken);
      return;
    }

    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token !== focusToken) return;
      commit();
    }));
  }

  /* 展开卡的高度：量列表的可用高度，减掉它自己的下边距，写成内联 height。
   *
   * 为什么不让 flex-grow 自然长：那样展开卡插值的是 grow（一个数字），
   * 另外六张插值的是 height（像素），浏览器分别插值、收尾对不齐，
   * 最后一帧把差额补上 —— 就是那个"动画结束又突然大一下"。
   * 现在两边都只动 height、同一时长同一条曲线，只有一个时钟。
   * 代价是尺寸变化时得重新量，下面用 ResizeObserver 兜着。 */
  function fitExpanded(root) {
    const mb = parseFloat(getComputedStyle(root).marginBottom) || 0;
    root.style.height = Math.max(0, listEl.clientHeight - mb) + 'px';
  }

  /* 两个滚动容器都要清：列表自己，和它的父级 .side-content（两处都开了 auto）。
   * 只清一个的话，另一个残留的滚动位置会在"内容变短"的那一刻被浏览器夹紧，
   * 表现就是整块内容"哒"地窜一下 —— 尺寸没变、位置变了，
   * 量出来正好是"卡片整体下移 6px、高度不变"。 */
  function resetScroll() {
    listEl.scrollTop = 0;
    if (listEl.parentElement) listEl.parentElement.scrollTop = 0;
  }

  /* 收起动画播完后，才把布局真的收回去：摘 has-expanded、摘 expanded、清内联高度。
   * 动画终点是"44 高 + 位移到槽位"，落地后的静态位置和它完全重合，所以不会有第二下。
   * 三件事放在同一个同步块里做 —— 中间不留帧，就不会看到它先弹回原样再归位。
   * 落地之后其余六张卡会从 display:none 变回可见，这一下是"啪"地全冒出来；
   * settle 给它们补一段回位动画（淡入 + 从上方滑回、按位置错开），
   * 让"被拉回来"有过渡，而不是硬跳。 */
  let pendingCollapse = null;

  function collapseDone(settle = true) {
    if (!pendingCollapse) return;
    const { card, anim } = pendingCollapse;
    pendingCollapse = null;
    anim.cancel();                    // 撤掉动画，下面立刻把布局落到同一个位置
    listEl.classList.remove('has-expanded');
    card.root.classList.remove('expanded');
    card.root.style.height = '';
    if (settle) settleBack(card.root);
  }

  /* 展开前把其余卡片"推开"：它们此刻还在流里、高度不变，所以不参与布局博弈，
   * 只是视觉上被朝外推（目标卡上面的往上、下面的往下）+ 淡出，推完才摘出布局。
   * fill: 'both' —— 错开期间保持起始态（可见），播完保持终点态（透明），
   * 直到 applyLayout 把它们 display:none。done 只在 token 仍最新时执行。 */
  function pushAway(focusRoot, done, token) {
    const order = [...listEl.children];
    const focusIdx = order.indexOf(focusRoot);
    const anims = [];
    order.forEach((root, i) => {
      if (root === focusRoot) return;
      const gap = Math.abs(i - focusIdx);
      const dist = 40 + gap * 10;
      root.getAnimations().forEach((a) => a.cancel());
      const anim = root.animate(
        [
          { opacity: 1, transform: 'translateY(0px)' },
          { opacity: 0, transform: `translateY(${i < focusIdx ? -dist : dist}px)` },
        ],
        { duration: 180, easing: 'ease-in', delay: gap * 14, fill: 'both' }
      );
      /* 打个标记：这张卡下次被选中时要能把它撤掉。
       * fill:'both' 会让卡片一直停在 opacity:0，直接切过去就是一张"看不见的卡"。 */
      anim.id = 'pushAway';
      anims.push(anim.finished.catch(() => {}));
    });
    Promise.all(anims).then(() => { if (token === focusToken) done(); });
  }

  /* 其余卡片回位：只动 transform / opacity，不碰布局，所以不会重新引入
   * "多方博弈"的抖动。fill: 'both' —— 错开期间先停在起始态（透明），轮到自己
   * 才淡入，播完保持终点态（可见）：上一轮 pushAway 把"透明"烧进了卡片的基态，
   * 不用 forwards 兜住终点，播完就会回退到那个 0、整排看不见。 */
  function settleBack(leavingRoot) {
    [...listEl.children].forEach((root, i) => {
      if (root === leavingRoot) return;
      root.getAnimations().forEach((a) => a.cancel());   // 清掉 pushAway 残留的 opacity:0 / 位移
      root.animate(
        [
          { opacity: 0, transform: 'translateY(-10px)' },
          { opacity: 1, transform: 'translateY(0px)' },
        ],
        {
          duration: 240,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          delay: i * 22,
          fill: 'both',
        }
      );
    });
  }

  new ResizeObserver(() => {
    for (const card of cards.values()) {
      if (card.root.classList.contains('expanded')) fitExpanded(card.root);
    }
  }).observe(listEl);

  store.subscribe(render);
}

/* ---------- 窗格渐变 ---------- */

/* 这张卡当前真正在显示的是哪一屏（靠计算样式的 display 判断，
 * 不去复用那套"哪个类在起作用"的推演 —— 两边各写一遍迟早会不一致） */
function visiblePane(item) {
  return [...item.querySelectorAll('.ti-pane')]
    .find((p) => getComputedStyle(p).display !== 'none') || null;
}

function fadeOut(pane) {
  if (!pane) return Promise.resolve();
  return pane.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 140, easing: 'ease', fill: 'forwards',
  }).finished.catch(() => {});
}

function fadeIn(pane) {
  if (!pane) return;
  // 上一次淡出把 opacity 留在了 0（fill: forwards），不取消的话这块会永远看不见
  pane.getAnimations().forEach((a) => a.cancel());
  pane.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease' });
}

/* 把身上带着残留动画的窗格清理一遍。
 *
 * 为什么需要：fadeOut 用的是 fill: 'forwards'，播完之后元素身上会留一层 opacity:0，
 * 只要那个动画对象还在，它就一值盖着。而"淡入"只清它自己那一块 ——
 * 所以一屏被淡出过一次之后，如果不是通过淡入请回来（比如切到产物屏、收起卡片、
 * 再从节点展开），那层 0 就一直挂着：卡片展开了、位置也占着，里面一个字都看不见。
 *
 * 只在它已经被藏起来（display:none）时才撤，正在显示的那块不能动，否则会闪。 */
function clearStaleFades(item) {
  if (!item) return;
  for (const pane of item.querySelectorAll('.ti-pane')) {
    if (getComputedStyle(pane).display === 'none') {
      pane.getAnimations().forEach((a) => a.cancel());
    }
  }
}

/* 淡出当前屏 → 换状态 → 淡入新屏。换视图和按「按钮」都走这一条路径。 */
function fadeSwap(item, swap, stillWanted = () => true) {
  const out = visiblePane(item);
  fadeOut(out).then(() => {
    if (!stillWanted()) return;
    swap();
    clearStaleFades(item);        // 被换下去那屏的 opacity:0 到此为止
    fadeIn(visiblePane(item));
  });
}

/* ---------- 自绘下拉 ----------
 * Windows 上原生 <select> 展开的是系统白底菜单，和深色 UI 对不上。
 * 这里把 select 留作数据源（隐藏），上面盖一层按钮 + 面板；
 * 选中后回写 select 并派发 change，外面原有的 change 监听一行都不用改。 */

function closeDropdowns() {
  document.querySelectorAll('.ti-dd.open').forEach((node) => node.classList.remove('open'));
}

function enhanceSelect(select, extraClass) {
  if (!select || select.__sync) return;

  const wrap = el('div', { className: `ti-dd ${extraClass}`.trim() });
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add('ti-dd-native');

  const btn = el('button', { className: 'ti-dd-btn' });
  btn.type = 'button';
  const text = el('span', { className: 'ti-dd-text' });
  const caret = el('span', { className: 'ti-dd-caret' });
  btn.append(text, caret);

  const panel = el('div', { className: 'ti-dd-panel' });
  wrap.append(btn, panel);

  function sync() {
    const current = select.selectedOptions[0];
    text.textContent = current ? current.textContent : '';
    panel.replaceChildren(...[...select.options].map((option, index) => {
      const item = el('button', { className: 'ti-dd-option' });
      item.type = 'button';
      item.textContent = option.textContent;
      item.classList.toggle('active', index === select.selectedIndex);
      item.addEventListener('click', () => {
        select.selectedIndex = index;
        wrap.classList.remove('open');
        sync();
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return item;
    }));
  }

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = !wrap.classList.contains('open');
    closeDropdowns();
    if (!willOpen) return;
    sync();
    wrap.classList.add('open');
  });

  select.__sync = sync;
  sync();
}

/* ---------- 单张卡片 ---------- */

/* 产物视图右下角那个对勾：没选中产物之前点不动，视觉上也压成暗灰红（样式在 layout.css）。
 * 用 aria-disabled 而不是 disabled 属性 —— 它是个 svg，没有原生 disabled 可用。 */
function syncConfirm(item) {
  if (!item) return;
  const has = !!item.querySelector('.ti-option.active');
  const check = item.querySelector('.ti-pane-products .ti-check');
  if (check) check.setAttribute('aria-disabled', String(!has));
}

function createCard(listEl, team) {
  const p = paint(team);
  const root = el('div', { className: 'team-item', dataset: { teamId: team.id } });
  root.style.background = p.bg;
  root.style.borderColor = p.border;
  root.style.setProperty('--team', p.bg);   // 卡片内控件（滑块、对勾）取团队色
  root.innerHTML = cardBody();

  const nameEl = root.querySelector('.t-name');
  nameEl.textContent = team.name;
  nameEl.style.color = p.text;

  const outSelect = root.querySelector('.ti-out-select');
  const sessionSelect = root.querySelector('.ti-session-select');
  enhanceSelect(outSelect, 'ti-dd-out');
  enhanceSelect(sessionSelect, 'ti-dd-session');

  listEl.appendChild(root);
  return {
    root,
    nameEl,
    input: root.querySelector('.ti-input'),
    handoffToggle: root.querySelector('.ti-toggle[data-field="handoff"]'),
    sessionToggle: root.querySelector('.ti-toggle[data-field="session"]'),
    abortBtn: root.querySelector('.ti-x'),
    outSelect,
    outbox: root.querySelector('.ti-pane-result .ti-out'),
    artifactsList: root.querySelector('.ti-pane-products .ti-list'),
    runTag: root.querySelector('.ti-run-tag'),
    sessionLine: root.querySelector('.ti-session-line'),
    sessionName: root.querySelector('.ti-session-name'),
    sessionSelect,
    sessionSelectWrap: root.querySelector('.ti-reuse-wrap'),
  };
}

/* 结果视图里的对话正文由 renderSession 填，这里不再放占位文字。 */

function cardBody() {
  return `
    <div class="ti-head">
      <span class="chip" style="background:rgba(255,255,255,0.35)"></span>
      <span class="t-name"></span>
      <!-- 打开这个 Agent 的项目目录（桌面端才有系统能力） -->
      <svg class="ti-folder" viewBox="0 0 24 24" role="button" aria-label="${t('打开目录')}">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      </svg>
    </div>
    <div class="ti-body">
      <div class="ti-pane ti-pane-default">
        <!-- 当前对话：名字 + 改名 + 删除，三个动作都走后端。 -->
        <div class="ti-session-line">
          <span class="ti-session-name">${t('暂无对话')}</span>
          <svg class="ti-session-edit" viewBox="0 0 24 24" role="button" aria-label="${t('重命名对话')}">
            <path d="M4 20h4L19 9l-4-4L4 16z"/>
          </svg>
          <svg class="ti-session-trash" viewBox="0 0 24 24" role="button" aria-label="${t('删除对话')}">
            <path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>
          </svg>
        </div>
        <div class="ti-divider"></div>
        <textarea class="ti-input" rows="3" placeholder="${t('在这里输入…')}"></textarea>
        <div class="ti-row">
          <span class="ti-actions">
            <svg class="ti-check" viewBox="0 0 24 24" role="button" aria-label="${t('运行')}">
              <path d="M4 12.5 L9.5 18 L20 6" />
            </svg>
            <!-- 中止运行：和左边的对勾同尺寸同描边，只在跑起来后可用 -->
            <svg class="ti-x" viewBox="0 0 24 24" role="button" aria-label="${t('中止运行')}" aria-disabled="true">
              <path d="M6 6 L18 18" />
              <path d="M18 6 L6 18" />
            </svg>
          </span>
          <!-- 上游产物开关：第一项 = 读取上游（默认），第二项 = 不读取 -->
          <div class="ti-toggle" role="switch" data-field="handoff" aria-checked="false">
            <span class="ti-knob"></span>
            <span class="ti-opt active">${t('读取上游')}</span>
            <span class="ti-opt">${t('不读取')}</span>
          </div>
        </div>
        <!-- 会话模式：第一项 = 新建对话（默认），第二项 = 复用对话。
             选"复用对话"时右边冒出一个下拉，挑具体哪一段。 -->
        <div class="ti-session-row">
          <div class="ti-toggle" role="switch" data-field="session" aria-checked="false">
            <span class="ti-knob"></span>
            <span class="ti-opt active">${t('新建对话')}</span>
            <span class="ti-opt">${t('复用对话')}</span>
          </div>
          <span class="ti-select-wrap ti-reuse-wrap" hidden>
            <select class="ti-select ti-session-select" aria-label="${t('选择要复用的对话')}"></select>
          </span>
        </div>
        <button class="ti-btn" type="button">${t('查看对话')}</button>
      </div>
      <div class="ti-pane ti-pane-products">
        <p class="ti-title">${t('产物')}<span class="ti-run-tag"></span></p>
        <div class="ti-divider"></div>
        <!-- 条目由 syncEdgeFiles 按"这条线起点节点最近一次运行的产物"填充 -->
        <div class="ti-list"></div>
        <!-- 下游节点的任务：和默认屏那个输入框是同一件事，只是这里还带着文件 -->
        <textarea class="ti-input ti-input-downstream" rows="2" placeholder="${t('给下游节点输入任务…')}"></textarea>
        <div class="ti-foot">
          <svg class="ti-check" viewBox="0 0 24 24" role="button" aria-label="${t('确认并退出')}"
               aria-disabled="true">
            <path d="M4 12.5 L9.5 18 L20 6" />
          </svg>
        </div>
      </div>
      <!-- 结果视图：按了「查看对话」之后才出现。右上角下拉选这个 Agent 的哪段对话，
           下面是对话正文，框内可滚，滚动条藏起来不占地方。 -->
      <div class="ti-pane ti-pane-result">
        <div class="ti-head-row">
          <span class="ti-select-wrap">
            <select class="ti-select ti-out-select" aria-label="${t('选择对话')}"></select>
          </span>
        </div>
        <div class="ti-outbox">
          <div class="ti-scroll">
            <div class="ti-out"></div>
          </div>
        </div>
        <div class="ti-foot">
          <svg class="ti-check" viewBox="0 0 24 24" role="button" aria-label="${t('确认并退出')}">
            <path d="M4 12.5 L9.5 18 L20 6" />
          </svg>
        </div>
      </div>
    </div>`;
}
