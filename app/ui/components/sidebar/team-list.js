/* ===== 组件：侧栏团队列表 =====
 * 数据来自 TeamReadModel（区域注入），这里只画卡片本身：
 *   - 卡片按 id 复用，按顺序重排，只改变化的项；
 *   - 颜色用读模型投影好的 h/s/l；
 *   - 展开的那张画三屏：默认屏（会话行、任务输入、运行/中止、两个开关、查看对话）、
 *     产物屏（产物单选、下游任务、确认退出）、结果屏（选对话 + 看正文）。
 *     两个下拉都是自绘按钮 + 面板，原生 select 只留作数据源（隐藏）。
 *
 * 交互只发事件，不碰状态：任务/开关发 *.changed，运行发 *.clicked，
 * 换屏复用 team.focus.changed（和旧 business/team.js 的规则一致）。
 * 发事件前先把区域聚焦到自己：状态守卫只接受“聚焦末端”的 mutate。
 *
 * 根节点用 display:contents 包一层：容器 #teamList 仍是 flex 列，
 * 卡片保持它的直接布局子项，不会被多包一层打乱。
 */

import { EVENTS } from '../../contracts/events.js';
import { createDom } from '../dom.js';
import { createIcon } from '../icons.js';
import { createRichText } from '../rich-text.js';
import { renderMarkdown } from '../../../../shared/markdown.mjs';

const DEFAULT_LABELS = {
  openFolder: '打开目录',
  run: '运行',
  abort: '中止运行',
  readUpstream: '看一下工作区',
  noRead: '不读取',
  newSession: '新建对话',
  reuseSession: '复用对话',
  viewConversation: '查看对话',
  taskPlaceholder: '在这里输入…',
  selectSession: '选择要复用的对话',
  noSession: '暂无对话',
  unnamedSession: '未命名对话',
  renameSession: '重命名对话',
  deleteSession: '删除对话',
  products: '产物',
  emptyArtifacts: '还没有产物',
  downstreamPlaceholder: '给下游节点输入任务…',
  confirmExit: '确认并退出',
  selectConversation: '选择对话',
  resultEmpty: '选择一段对话查看内容',
  loading: '加载中…',
  missingContent: '这段对话还没有落盘内容。',
  noContent: '暂无内容',
  toolPrefix: '[工具]',
  starting: '正在启动…',
  toolRunning: '运行中',
  toolFailed: '失败',
  toolDone: '完成',
};

let dropdownSeq = 0;

function hsl(team) {
  const h = Number(team.h) || 0;
  const s = Number(team.s) || 0;
  const l = Number(team.l) || 0;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function sessionTitle(session, labels) {
  if (!session) return labels.noSession;
  return session.title || session.piSessionId || labels.unnamedSession;
}

export function createTeamList({ document }) {
  const { el } = createDom(document);
  const rich = createRichText({ document });

  return function teamList(initialProps, ctx) {
    let props = initialProps || {};
    const root = el('div', { className: 'team-list', style: { display: 'contents' } });
    /** @type {Map<string, any>} */
    const cards = new Map();
    let orderKey = '';
    let currentLang = props.lang;

    /* 默认文案在本文件；区域可以传 labels 覆盖，或传 translate 统一翻译。 */
    function labels() {
      const base = { ...DEFAULT_LABELS, ...(props.labels || {}) };
      const translate = typeof props.translate === 'function' ? props.translate : null;
      if (!translate) return base;
      const out = {};
      for (const [key, text] of Object.entries(base)) out[key] = translate(text);
      return out;
    }

    function emit(type, payload) {
      /* mutate 只有在“区域是聚焦末端”时才会被状态守卫采纳。
       * push 对同一路径是幂等的，放这里比让每个点击处理各自记得更稳。 */
      ctx?.requestFocus?.();
      ctx?.emit({ type, payload });
    }

    /* ---------- 自绘下拉 ----------
     * 原生 select 留作数据源（value / change 语义不变），显示层自己画：
     * 按钮显示当前项，面板列出全部选项；点选项回写 select 并派发 change。 */

    /** @type {Set<any>} */
    const dropdowns = new Set();

    function closeDropdowns(except) {
      for (const dd of dropdowns) if (dd !== except) dd.close();
    }

    /** 真实 DOM 用 Event；测试里的最小 DOM 只有同步 dispatch。 */
    function fireChange(select) {
      if (typeof select.dispatchEvent === 'function' && typeof Event === 'function') {
        select.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (typeof select.dispatch === 'function') {
        select.dispatch('change');
      }
    }

    function contains(ancestor, node) {
      for (let current = node; current; current = current.parentNode) {
        if (current === ancestor) return true;
      }
      return false;
    }

    function createDropdown({ select, extraClass, label }) {
      const wrap = el('div', { className: `ti-dd ${extraClass || ''}`.trim() });
      const btn = el('button', {
        className: 'ti-dd-btn',
        attrs: {
          type: 'button',
          'aria-haspopup': 'listbox',
          'aria-expanded': 'false',
          'aria-label': label,
        },
      });
      const text = el('span', { className: 'ti-dd-text' });
      const caret = el('span', { className: 'ti-dd-caret' });
      dropdownSeq += 1;
      const panelId = `ti-dd-panel-${dropdownSeq}`;
      const panel = el('div', {
        className: 'ti-dd-panel',
        attrs: { role: 'listbox', id: panelId },
      });
      btn.setAttribute('aria-controls', panelId);
      btn.appendChild(text);
      btn.appendChild(caret);
      select.classList.toggle('ti-dd-native', true);
      wrap.appendChild(select);
      wrap.appendChild(btn);
      wrap.appendChild(panel);

      const dd = {
        el: wrap,
        select,
        btn,
        panel,
        text,
        options: [],
        optionEls: [],
        value: '',
        key: '',
        sync() {
          const active = this.options.find((option) => String(option.value) === String(this.value));
          const shown = active || this.options[0] || null;
          this.text.textContent = shown ? shown.text : '';
          this.btn.setAttribute('aria-label', shown ? `${label}: ${shown.text}` : label);
          this.optionEls = this.options.map((option, index) => {
            const item = el('button', {
              className: 'ti-dd-option',
              attrs: { type: 'button', role: 'option' },
              text: option.text,
            });
            const on = shown === option;
            item.classList.toggle('active', on);
            item.setAttribute('aria-selected', String(on));
            item.addEventListener('click', () => this.pick(index));
            item.addEventListener('keydown', (event) => this.onOptionKeydown(event, index));
            return item;
          });
          this.panel.replaceChildren(...this.optionEls);
          return this;
        },
        /** 选中第 index 项：回写原生 select、收起、把焦点还给按钮。 */
        pick(index) {
          const option = this.options[index];
          if (!option) return;
          this.value = option.value;
          this.select.value = option.value;
          this.sync();
          this.close();
          this.btn.focus?.();
          fireChange(this.select);
        },
        focusOption(index) {
          const total = this.optionEls.length;
          if (!total) {
            this.btn.focus?.();
            return;
          }
          const next = ((index % total) + total) % total;
          this.optionEls[next]?.focus?.();
        },
        onOptionKeydown(event, index) {
          const key = event?.key;
          if (key === 'ArrowDown' || key === 'ArrowUp') {
            event.preventDefault?.();
            this.focusOption(index + (key === 'ArrowDown' ? 1 : -1));
            return;
          }
          if (key === 'Home' || key === 'End') {
            event.preventDefault?.();
            this.focusOption(key === 'Home' ? 0 : this.optionEls.length - 1);
            return;
          }
          if (key === 'Enter' || key === ' ') {
            event.preventDefault?.();
            this.pick(index);
            return;
          }
          if (key === 'Escape') {
            event.preventDefault?.();
            this.close();
            this.btn.focus?.();
          }
        },
        open() {
          closeDropdowns(this);
          this.el.classList.toggle('open', true);
          this.btn.setAttribute('aria-expanded', 'true');
        },
        close() {
          this.el.classList.toggle('open', false);
          this.btn.setAttribute('aria-expanded', 'false');
        },
        toggle() {
          if (this.el.classList.contains('open')) this.close();
          else this.open();
        },
      };

      dropdowns.add(dd);
      btn.addEventListener('click', () => dd.toggle());
      btn.addEventListener('keydown', (event) => {
        const key = event?.key;
        if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
          event.preventDefault?.();
          dd.open();
          const current = dd.options.findIndex(
            (option) => String(option.value) === String(dd.value),
          );
          const start = current >= 0
            ? current
            : (key === 'ArrowUp' ? dd.options.length - 1 : 0);
          dd.focusOption(start);
          return;
        }
        if (key === 'Escape') {
          event.preventDefault?.();
          dd.close();
        }
      });
      /* 焦点离开整个下拉就收起（点面板里的选项也会先经过这里，contains 会放行）。 */
      wrap.addEventListener('focusout', (event) => {
        if (event?.relatedTarget && contains(wrap, event.relatedTarget)) return;
        dd.close();
      });
      /* 原生 select 被脚本直接改值时，显示层跟上。 */
      select.addEventListener('change', () => {
        dd.value = select.value;
        dd.sync();
      });
      return dd;
    }

    /** 选项变了才重建原生 select；每次同步都把显示层对齐到当前值。 */
    function syncOptions(dd, list, value, emptyLabel) {
      const options = list.length ? list : [{ value: '', text: emptyLabel }];
      const key = options.map((option) => `${option.value}:${option.text}`).join('|');
      if (dd.key !== key) {
        dd.key = key;
        dd.options = options;
        dd.select.replaceChildren(...options.map((option) => el('option', {
          attrs: { value: option.value },
          text: option.text,
        })));
      }
      dd.value = value || '';
      dd.select.value = dd.value;
      dd.sync();
    }

    function makeCard(team) {
      const name = el('span', { className: 't-name', text: team.name });
      const chip = el('span', {
        className: 'chip',
        style: { background: 'rgba(255,255,255,0.35)' },
      });
      const t = labels();
      const folder = el('button', {
        className: 'ti-folder',
        attrs: {
          type: 'button',
          'aria-label': t.openFolder,
          title: t.openFolder,
        },
      }, createIcon(document, 'folder'));
      folder.addEventListener('click', (event) => {
        event?.stopPropagation?.();
        ctx?.openAgentFolder?.(team.id);
      });

      const head = el('div', { className: 'ti-head' }, [chip, name, folder]);
      const card = el('div', {
        className: 'team-item',
        dataset: { teamId: team.id },
        attrs: { role: 'listitem' },
      }, [head]);
      return {
        root: card,
        name,
        folder,
        body: null,
        nodeId: null,
        node: null,
        refs: null,
        expanded: false,
      };
    }

    /* 展开内容按“节点 + 屏”创建；换节点或换屏整块重建，
     * 同节点同屏内的输入不重建，避免每次打字把光标顶到末尾。 */
    function buildDefaultBody(card, team, node) {
      const t = labels();
      const refs = {};
      refs.sessionName = el('span', { className: 'ti-session-name' });
      refs.edit = el('button', {
        className: 'ti-session-edit',
        attrs: { type: 'button', 'aria-label': t.renameSession },
      }, createIcon(document, 'pencil'));
      refs.trash = el('button', {
        className: 'ti-session-trash',
        attrs: { type: 'button', 'aria-label': t.deleteSession },
      }, createIcon(document, 'trash'));
      refs.sessionLine = el('div', {
        className: 'ti-session-line',
        dataset: { agentId: team.id, sessionId: '' },
      }, [refs.sessionName, refs.edit, refs.trash]);
      refs.editing = null;

      refs.task = el('textarea', {
        className: 'ti-input',
        attrs: { rows: '3', placeholder: t.taskPlaceholder },
      });

      refs.run = el('button', {
        className: 'ti-check',
        attrs: { type: 'button', 'aria-label': t.run },
      }, createIcon(document, 'check'));
      refs.stop = el('button', {
        className: 'ti-x',
        attrs: { type: 'button', 'aria-label': t.abort },
      }, createIcon(document, 'x'));
      const actions = el('span', { className: 'ti-actions' }, [refs.run, refs.stop]);

      refs.handoffOpts = [
        el('span', { className: 'ti-opt', text: t.readUpstream }),
        el('span', { className: 'ti-opt', text: t.noRead }),
      ];
      refs.handoff = el('div', {
        className: 'ti-toggle',
        dataset: { field: 'handoff' },
        attrs: { role: 'switch', 'aria-checked': 'true' },
      }, [el('span', { className: 'ti-knob' }), ...refs.handoffOpts]);

      refs.sessionOpts = [
        el('span', { className: 'ti-opt', text: t.newSession }),
        el('span', { className: 'ti-opt', text: t.reuseSession }),
      ];
      refs.session = el('div', {
        className: 'ti-toggle',
        dataset: { field: 'session' },
        attrs: { role: 'switch', 'aria-checked': 'false' },
      }, [el('span', { className: 'ti-knob' }), ...refs.sessionOpts]);

      refs.reuseSelect = el('select', {
        className: 'ti-select ti-session-select',
        attrs: { 'aria-label': t.selectSession },
      });
      refs.reuseDd = createDropdown({
        select: refs.reuseSelect,
        extraClass: 'ti-dd-session',
        label: t.selectSession,
      });
      refs.reuseWrap = el('span', {
        className: 'ti-select-wrap ti-reuse-wrap',
        attrs: { hidden: true },
      }, [refs.reuseDd.el]);

      refs.view = el('button', {
        className: 'ti-btn',
        attrs: { type: 'button' },
        text: t.viewConversation,
      });

      const pane = el('div', { className: 'ti-pane ti-pane-default' }, [
        refs.sessionLine,
        el('div', { className: 'ti-divider' }),
        refs.task,
        el('div', { className: 'ti-row' }, [actions, refs.handoff]),
        el('div', { className: 'ti-session-row' }, [refs.session, refs.reuseWrap]),
        refs.view,
      ]);
      const body = el('div', { className: 'ti-body' }, [pane]);

      const nodeId = node.id;

      refs.task.addEventListener('input', () => {
        emit(EVENTS.NODE_TASK_CHANGED, { nodeId, task: refs.task.value });
      });
      refs.run.addEventListener('click', () => {
        emit(EVENTS.NODE_RUN_CLICKED, { nodeId });
      });
      refs.stop.addEventListener('click', () => {
        if (refs.stop.getAttribute('aria-disabled') === 'true') return;
        emit(EVENTS.NODE_RUN_STOP_CLICKED, { nodeId });
      });
      refs.handoff.addEventListener('click', () => {
        const on = refs.handoff.classList.contains('on');
        emit(EVENTS.NODE_HANDOFF_CHANGED, { nodeId, handoffEnabled: on });
      });
      refs.session.addEventListener('click', () => {
        const on = refs.session.classList.contains('on');
        emit(EVENTS.NODE_SESSION_CHANGED, { nodeId, sessionMode: on ? 'new' : 'reuse' });
      });
      refs.reuseSelect.addEventListener('change', () => {
        emit(EVENTS.NODE_SESSION_CHANGED, {
          nodeId,
          sessionMode: 'reuse',
          sessionId: refs.reuseSelect.value,
        });
      });
      refs.view.addEventListener('click', () => {
        emit(EVENTS.TEAM_FOCUS_CHANGED, { teamId: team.id, nodeId, pane: 'result' });
      });
      refs.edit.addEventListener('click', () => {
        startRename(refs, team);
      });
      refs.trash.addEventListener('click', () => {
        const sessionId = refs.sessionLine.dataset.sessionId;
        if (!sessionId) return;
        emit(EVENTS.SESSION_DELETE_CLICKED, { teamId: team.id, sessionId });
      });

      card.root.appendChild(body);
      card.body = body;
      card.nodeId = node.id;
      card.refs = refs;
      card.node = node;
      refs.task.value = String(node.task || '');
    }

    /* 产物屏：这条线起点节点最近一次运行收集到的文件（单选），
     * 加一个给下游节点的任务框和“确认并退出”。
     * 选中只是本屏的临时态，点确认才发事件（和旧逻辑一致）。 */
    function buildProductsBody(card, team, node) {
      const t = labels();
      const refs = { options: [] };

      refs.runTag = el('span', { className: 'ti-run-tag' });
      refs.list = el('div', { className: 'ti-list' });
      refs.downstream = el('textarea', {
        className: 'ti-input ti-input-downstream',
        attrs: { rows: '2', placeholder: t.downstreamPlaceholder },
      });
      refs.confirm = el('button', {
        className: 'ti-check',
        attrs: { type: 'button', 'aria-label': t.confirmExit, 'aria-disabled': 'true' },
      }, createIcon(document, 'check'));

      const pane = el('div', { className: 'ti-pane ti-pane-products' }, [
        el('p', { className: 'ti-title' }, [t.products, refs.runTag]),
        el('div', { className: 'ti-divider' }),
        refs.list,
        refs.downstream,
        el('div', { className: 'ti-foot' }, [refs.confirm]),
      ]);
      const body = el('div', { className: 'ti-body' }, [pane]);

      const nodeId = node.id;

      refs.downstream.addEventListener('input', () => {
        const edge = props.activeEdge;
        if (!edge) return;
        emit(EVENTS.NODE_TASK_CHANGED, { nodeId: edge.to, task: refs.downstream.value });
      });

      refs.confirm.addEventListener('click', () => {
        if (refs.confirm.getAttribute('aria-disabled') === 'true') return;
        const edge = props.activeEdge;
        const chosen = refs.options.find((option) => option.classList.contains('active'));
        if (!edge || !chosen) return;
        /* 与旧顺序一致：先收起（同一个入口再点一次），再写下游任务，最后记文件。 */
        emit(EVENTS.TEAM_FOCUS_CHANGED, {
          teamId: team.id,
          nodeId,
          edgeId: edge.id,
          pane: 'products',
        });
        emit(EVENTS.NODE_TASK_CHANGED, { nodeId: edge.to, task: refs.downstream.value });
        emit(EVENTS.EDGE_FILES_CHANGED, { edgeId: edge.id, files: [chosen.dataset.name] });
      });

      card.root.appendChild(body);
      card.body = body;
      card.nodeId = node.id;
      card.edgeId = props.activeEdge?.id || null;
      card.refs = refs;
      card.node = node;
      refs.downstream.value = String(props.downstreamTask || '');
    }

    /* 结果屏：先只有“选对话 + 看正文”的骨架。
     * 正文暂按纯文本画（Markdown 的 DOM 渲染是下一步），工具条目保持文本。
     * 换对话只发 session.view.changed，读内容由后续切片/效果负责。 */
    function buildResultBody(card, team, node) {
      const t = labels();
      const refs = { autoViewTried: false };

      refs.outSelect = el('select', {
        className: 'ti-select ti-out-select',
        attrs: { 'aria-label': t.selectConversation },
      });
      refs.outDd = createDropdown({
        select: refs.outSelect,
        extraClass: 'ti-dd-out',
        label: t.selectConversation,
      });
      refs.out = el('div', { className: 'ti-out' });
      refs.scroll = el('div', { className: 'ti-scroll' }, [refs.out]);
      refs.confirm = el('button', {
        className: 'ti-check',
        attrs: { type: 'button', 'aria-label': t.confirmExit },
      }, createIcon(document, 'check'));

      const pane = el('div', { className: 'ti-pane ti-pane-result' }, [
        el('div', { className: 'ti-head-row' }, [
          el('span', { className: 'ti-select-wrap' }, [refs.outDd.el]),
        ]),
        el('div', { className: 'ti-outbox' }, [refs.scroll]),
        el('div', { className: 'ti-foot' }, [refs.confirm]),
      ]);
      const body = el('div', { className: 'ti-body' }, [pane]);

      const nodeId = node.id;

      refs.outSelect.addEventListener('change', () => {
        const sessionId = refs.outSelect.value;
        if (!sessionId) return;
        emit(EVENTS.SESSION_VIEW_CHANGED, { teamId: team.id, sessionId });
      });

      refs.confirm.addEventListener('click', () => {
        /* 同一个入口再点一次 = 收起（和默认屏、产物屏共用一条规则）。 */
        emit(EVENTS.TEAM_FOCUS_CHANGED, {
          teamId: team.id,
          nodeId,
          edgeId: props.activeEdge?.id || null,
          pane: 'result',
        });
      });

      card.root.appendChild(body);
      card.body = body;
      card.nodeId = node.id;
      card.refs = refs;
      card.node = node;
    }

    function buildBody(card, team, node, pane) {
      if (pane === 'products') buildProductsBody(card, team, node);
      else if (pane === 'result') buildResultBody(card, team, node);
      else buildDefaultBody(card, team, node);
      card.pane = pane;
    }

    /* 改名是会话行的就地编辑：回车/失焦保存，Esc 取消，空标题不提交。
     * 编辑期间先把原名字藏起来，提交后由下一次 sync 写回最新标题。 */
    function startRename(refs, team) {
      if (refs.editing) return;
      const sessionId = refs.sessionLine.dataset.sessionId;
      if (!sessionId) return;

      const original = refs.sessionName.textContent;
      const input = el('input', {
        className: 'ti-session-name-input',
        attrs: { type: 'text', 'aria-label': labels().renameSession },
      });
      input.value = original;
      refs.sessionName.hidden = true;
      refs.sessionLine.appendChild(input);
      refs.editing = { input, sessionId, original };
      if (typeof input.focus === 'function') input.focus();

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') finishRename(refs, team, true);
        else if (event.key === 'Escape') finishRename(refs, team, false);
      });
      input.addEventListener('blur', () => finishRename(refs, team, true));
    }

    function finishRename(refs, team, commit) {
      const editing = refs.editing;
      if (!editing) return;
      refs.editing = null;
      editing.input.remove();
      refs.sessionName.hidden = false;

      const title = String(editing.input.value || '').trim();
      if (!commit || !title || title === editing.original) return;
      emit(EVENTS.SESSION_RENAME_SUBMITTED, {
        teamId: team.id,
        sessionId: editing.sessionId,
        title,
      });
    }

    function syncDefaultBody(card, team, node) {
      const t = labels();
      const { refs } = card;
      card.node = node;

      const sessions = Array.isArray(props.sessions) ? props.sessions : [];
      const session = sessions.find((item) => item.id === node.sessionId)
        || sessions.find((item) => item.id === node.lastSessionId)
        || sessions[0]
        || null;
      const title = sessionTitle(session, t);
      refs.sessionName.textContent = title;
      refs.sessionName.setAttribute('title', title);
      refs.sessionLine.dataset.sessionId = session?.id || '';

      const handoffOff = node.handoffEnabled === false;
      refs.handoff.classList.toggle('on', handoffOff);
      refs.handoff.setAttribute('aria-checked', String(handoffOff));
      refs.handoffOpts.forEach((opt, index) => opt.classList.toggle('active', (index === 1) === handoffOff));

      const reuse = node.sessionMode === 'reuse';
      refs.session.classList.toggle('on', reuse);
      refs.session.setAttribute('aria-checked', String(reuse));
      refs.sessionOpts.forEach((opt, index) => opt.classList.toggle('active', (index === 1) === reuse));

      refs.reuseWrap.hidden = !reuse;
      syncOptions(
        refs.reuseDd,
        sessions.map((item) => ({ value: item.id, text: sessionTitle(item, t) })),
        node.sessionId || '',
        t.noSession,
      );
      refs.stop.setAttribute('aria-disabled', String(!node.running));
      refs.task.setAttribute('placeholder', t.taskPlaceholder);
      refs.run.setAttribute('aria-label', t.run);
      refs.stop.setAttribute('aria-label', t.abort);
      refs.view.textContent = t.viewConversation;
      refs.handoffOpts[0].textContent = t.readUpstream;
      refs.handoffOpts[1].textContent = t.noRead;
      refs.sessionOpts[0].textContent = t.newSession;
      refs.sessionOpts[1].textContent = t.reuseSession;
      refs.edit.setAttribute('aria-label', t.renameSession);
      refs.trash.setAttribute('aria-label', t.deleteSession);
    }

    /* 产物列表按“文件名 + 路径”重建，选中项按这条线的 edge.files 回填。
     * 本屏的点击只改本屏选中态，不发事件（点确认时才发）。 */
    function syncProductsBody(card, team, node) {
      const t = labels();
      const refs = card.refs;
      const artifacts = Array.isArray(props.artifacts) ? props.artifacts : [];
      const selected = new Set(Array.isArray(props.activeEdge?.files) ? props.activeEdge.files : []);
      const runTag = '';
      if (refs.runTag.textContent !== runTag) refs.runTag.textContent = runTag;

      const listKey = artifacts.map((file) => `${file.name}:${file.path || ''}`).join('|');
      const selectedKey = [...selected].join('|');
      if (refs.listKey !== listKey || refs.selKey !== selectedKey) {
        refs.listKey = listKey;
        refs.selKey = selectedKey;
        refs.options = artifacts.map((file) => {
          const option = el('div', {
            className: 'ti-option',
            dataset: { name: file.name, path: file.path || '' },
            text: file.name,
          });
          option.classList.toggle('active', selected.has(file.name));
          option.addEventListener('click', () => {
            for (const item of refs.options) item.classList.toggle('active', item === option);
            syncConfirm(refs);
            /* 与旧行为一致：点产物既选中（给确认按钮用），也打开右侧查看器。
             * 没有 path 的条目只选中，不发打开事件。 */
            const path = file.path || '';
            if (path) {
              emit(EVENTS.ARTIFACT_OPEN_CLICKED, {
                name: file.name,
                path,
                color: hsl(team),
              });
            }
          });
          return option;
        });
        if (refs.options.length) refs.list.replaceChildren(...refs.options);
        else refs.list.replaceChildren(el('p', { className: 'ti-empty', text: t.emptyArtifacts }));
      }

      refs.downstream.setAttribute('placeholder', t.downstreamPlaceholder);
      refs.confirm.setAttribute('aria-label', t.confirmExit);
      syncConfirm(refs);
    }

    /* 会话下拉与正文都按“内容签名”重建，签名没变就一个节点都不动。 */
    function syncResultBody(card, team, node) {
      const t = labels();
      const refs = card.refs;
      /* 结果屏只看 pi 已经落盘的对话：下拉值用 piSessionId，后端按它取正文。 */
      const sessions = (Array.isArray(props.sessions) ? props.sessions : [])
        .filter((item) => item?.piSessionId);

      const viewId = props.viewSessionId || props.sessionView?.sessionId || '';
      /* 第一次进结果屏时状态里还没有“看哪段”：默认看上次对话的那段
       *（节点记下的 lastSessionId），没有就取最新一段。否则下拉看着选中了，
       * 正文却不会加载，必须手动再选一次。 */
      if (viewId) {
        refs.autoViewTried = false;
      } else if (sessions.length && !refs.autoViewTried) {
        refs.autoViewTried = true;
        const fallback = sessions.find((item) => item.id === node.lastSessionId)
          || sessions.find((item) => item.id === node.sessionId)
          || sessions[0];
        if (fallback?.piSessionId) {
          emit(EVENTS.SESSION_VIEW_CHANGED, { teamId: team.id, sessionId: fallback.piSessionId });
        }
      }

      syncOptions(
        refs.outDd,
        sessions.map((item) => ({ value: item.piSessionId, text: sessionTitle(item, t) })),
        viewId,
        t.noSession,
      );

      /* 运行中有实时转录就画它；跑完（transcript 变 null）再回历史会话。 */
      if (Array.isArray(props.transcript)) {
        refs.viewKey = '';
        renderLive(refs, props.transcript, t);
        return;
      }
      refs.liveKey = '';
      renderHistory(refs, props.sessionView || null, t);
    }

    function scrollToBottom(refs) {
      if (typeof refs.scroll.scrollHeight === 'number') {
        refs.scroll.scrollTop = refs.scroll.scrollHeight;
      }
    }

    /* 实时转录：thinking / 回复用 Markdown 渲染，工具调用保持纯文本。
     * 工具条目带状态与耗时；空列表显示“正在启动…”。 */
    function renderLive(refs, entries, t) {
      const key = entries
        .map((entry) => `${entry?.type || ''}:${String(entry?.text || '').length}:${entry?.status || ''}:${entry?.durationMs ?? ''}`)
        .join('|');
      if (refs.liveKey === key) return;
      refs.liveKey = key;

      if (!entries.length) {
        refs.out.replaceChildren();
        refs.out.textContent = t.starting;
        return;
      }

      const format = (value) => (typeof value === 'string' ? value : JSON.stringify(value ?? ''));
      refs.out.replaceChildren(...entries.map((entry) => {
        if (entry?.type === 'tool') {
          const status = entry.status === 'running'
            ? t.toolRunning
            : entry.isError ? t.toolFailed : t.toolDone;
          return el('div', {
            className: 'ti-entry tool',
            text: `${t.toolPrefix} ${entry.toolName || ''} ${format(entry.args)}`.trim()
              + ` · ${status}`
              + (entry.durationMs != null ? ` (${entry.durationMs}ms)` : ''),
          });
        }
        const box = el('div', {
          className: `ti-entry ${entry?.type === 'thinking' ? 'thinking' : 'assistant'}`,
        });
        box.replaceChildren(...rich.toNodes(renderMarkdown(entry?.text || '')));
        return box;
      }));
      scrollToBottom(refs);
    }

    /* 历史会话：按“会话 + 状态 + 条目长度”重建，滚到顶部。 */
    function renderHistory(refs, view, t) {
      const entries = Array.isArray(view?.entries) ? view.entries : [];
      const entryKey = entries
        .map((entry) => `${entry?.kind || ''}:${String(entry?.text || '').length}:${String(entry?.html || '').length}`)
        .join(',');
      const viewKey = view
        ? `${view.sessionId || ''}|${view.loading ? 1 : 0}|${view.error || ''}|${view.missing ? 1 : 0}|${entryKey}`
        : '';
      if (refs.viewKey === viewKey) return;
      refs.viewKey = viewKey;
      refs.out.replaceChildren();

      if (!view || !view.sessionId) {
        refs.out.textContent = t.resultEmpty;
        return;
      }
      if (view.loading) {
        refs.out.textContent = t.loading;
        return;
      }
      if (view.error) {
        refs.out.textContent = String(view.error);
        return;
      }
      if (view.missing) {
        refs.out.textContent = t.missingContent;
        return;
      }
      if (!entries.length) {
        refs.out.textContent = t.noContent;
        return;
      }

      const format = (value) => (typeof value === 'string' ? value : JSON.stringify(value ?? ''));
      refs.out.replaceChildren(...entries.map((entry) => {
        if (entry?.kind === 'tool') {
          return el('div', {
            className: 'ti-entry tool',
            text: `${t.toolPrefix} ${entry.name || ''} ${format(entry.args)}`.trim()
              + (entry.output ? `\n${entry.output}` : ''),
          });
        }
        /* 正文优先用 HTML 片段（后端预渲染或 renderMarkdown 的输出），
         * 交给白名单解析器换成节点；没有片段就退回纯文本。 */
        const box = el('div', { className: `ti-entry ${entry?.kind || ''}`.trim() });
        const html = typeof entry?.html === 'string' ? entry.html : '';
        if (html) box.replaceChildren(...rich.toNodes(html));
        else box.textContent = String(entry?.text || '');
        return box;
      }));
      refs.scroll.scrollTop = 0;
    }

    function syncConfirm(refs) {
      const has = refs.options.some((option) => option.classList.contains('active'));
      refs.confirm.setAttribute('aria-disabled', String(!has));
    }

    function animateCard(card, keyframes, options) {
      if (!card?.root || typeof props.animate !== 'function') return;
      try {
        const result = props.animate(card.root, keyframes, options);
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {
        /* 动画失败不影响布局；几何已由状态与样式决定。 */
      }
    }

    function dropBody(card) {
      /* 下拉节点会随 body 一起移除；这里把它从全局集合摘掉，
       * 否则反复展开/收起会留下越来越长的死引用。 */
      if (card.refs) {
        if (card.refs.reuseDd) dropdowns.delete(card.refs.reuseDd);
        if (card.refs.outDd) dropdowns.delete(card.refs.outDd);
      }
      if (card.body) card.body.remove();
      card.body = null;
      card.nodeId = null;
      card.pane = null;
      card.edgeId = null;
      card.refs = null;
      card.node = null;
      card.root.style.height = '';
    }

    function render() {
      const teams = Array.isArray(props.teams) ? props.teams : [];
      const activeTeamId = props.activeTeamId || null;
      const activeNode = activeTeamId ? (props.activeNode || null) : null;
      /* 屏未知时一律按默认屏画。 */
      const pane = props.pane === 'products' || props.pane === 'result'
        ? props.pane
        : 'default';
      const activeEdgeId = props.activeEdge?.id || null;

      /* 换语言：按钮、占位符、选项文案都是建卡时写进去的，整块重建最稳。 */
      const langChanged = props.lang !== undefined
        && currentLang !== undefined
        && props.lang !== currentLang;
      if (props.lang !== undefined) currentLang = props.lang;
      if (langChanged) {
        for (const card of cards.values()) dropBody(card);
      }

      for (const team of teams) {
        if (!cards.has(team.id)) cards.set(team.id, makeCard(team));
      }

      for (const [id, card] of cards) {
        if (!teams.some((team) => team.id === id)) {
          card.root.remove();
          cards.delete(id);
        }
      }

      const key = teams.map((team) => team.id).join(',');
      if (key !== orderKey) {
        orderKey = key;
        for (const team of teams) root.appendChild(cards.get(team.id).root);
      }

      const t = labels();
      for (const team of teams) {
        const card = cards.get(team.id);
        const color = hsl(team);
        if (card.name.textContent !== team.name) card.name.textContent = team.name;
        if (card.folder) {
          if (card.folder.getAttribute('aria-label') !== t.openFolder) {
            card.folder.setAttribute('aria-label', t.openFolder);
          }
          if (card.folder.title !== t.openFolder) card.folder.title = t.openFolder;
        }
        if (card.root.style.background !== color) card.root.style.background = color;
        if (card.root.style.borderColor !== color) card.root.style.borderColor = color;
        if (typeof card.root.style.setProperty === 'function'
          && card.root.style.getPropertyValue?.('--team') !== color) {
          card.root.style.setProperty('--team', color);
        }

        const active = team.id === activeTeamId;
        card.root.classList.toggle('active', active);
        card.root.setAttribute('aria-current', active ? 'true' : 'false');

        const expanded = active && Boolean(activeNode);
        const wasExpanded = card.expanded;
        card.root.classList.toggle('expanded', expanded);
        card.root.classList.toggle('mode-products', expanded && pane === 'products');
        card.root.classList.toggle('mode-result', expanded && pane === 'result');

        if (expanded) {
          /* 展开卡的高度由区域量（列表可用高度），这里只负责写到 DOM。 */
          const height = typeof props.measureExpanded === 'function'
            ? props.measureExpanded(card.root)
            : 0;
          if (Number.isFinite(height) && height > 0) {
            const next = `${height}px`;
            if (card.root.style.height !== next) card.root.style.height = next;
          }

          const stale = card.nodeId !== activeNode.id
            || card.pane !== pane
            || (pane === 'products' && card.edgeId !== activeEdgeId);
          if (stale) {
            if (card.body) card.body.remove();
            buildBody(card, team, activeNode, pane);
          }
          if (pane === 'products') syncProductsBody(card, team, activeNode);
          else if (pane === 'result') syncResultBody(card, team, activeNode);
          else syncDefaultBody(card, team, activeNode);

          if (!wasExpanded) {
            /* 从槽位长出来：高度走 CSS 过渡，位移/淡入交给动画 Port。 */
            animateCard(card, [
              { opacity: 0, transform: 'translateY(12px)' },
              { opacity: 1, transform: 'translateY(0px)' },
            ], { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
          }
        } else if (card.body) {
          dropBody(card);
          card.root.classList.toggle('expanded', false);
          animateCard(card, [
            { opacity: 1, transform: 'translateY(0px)' },
            { opacity: 0.55, transform: 'translateY(6px)' },
          ], { duration: 180, easing: 'ease' });
        }
        card.expanded = expanded;
      }
    }

    render();

    return {
      el: root,
      update(nextProps) {
        props = nextProps || {};
        render();
      },
      destroy() {
        cards.clear();
        dropdowns.clear();
        root.remove();
      },
    };
  };
}
