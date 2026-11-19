/* ===== UI：弹窗 =====
 * 开/关完全由 state.view.panels 决定，不再由"点击回调去调 openPanel"这种命令式流程。
 *
 * 好处是可预测：任何地方想知道"面板开着吗"，读状态就行；
 * 任何地方想把面板关掉，发一个 ui.panel.close，不用去问谁负责这块 DOM。
 *
 * 关闭动画：先摘 open 换 closing 播缩小动画，animationend 后才真正隐藏。
 * 这是唯一一处必须"命令式"的地方 —— 动画播完是个时间事件，只能靠监听。
 */

import { BIZ, UI } from './core/intent.js';
import { t } from './core/i18n.js';
import { confirmDialog } from './core/confirm.js';

export function mountModals({ store, bus, saver }) {
  const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
  const byId = new Map(overlays.map((o) => [o.id, o]));

  /* ---------- 一次性：动画收尾 + 通用关闭手势 ---------- */

  overlays.forEach((overlay) => {
    // 关闭动画播完 → 真正隐藏（display:none）
    overlay.addEventListener('animationend', (e) => {
      if (e.animationName === 'modalOut') overlay.classList.remove('closing');
    });

    // 点 ✕ 或点遮罩空白处
    overlay.addEventListener('click', (e) => {
      if (overlay.classList.contains('closing')) return;   // 动画期间别重复触发
      if (e.target === overlay || e.target.closest('.m-close')) {
        bus.send(UI.PANEL_CLOSE, { id: overlay.id });
      }
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const { panels } = store.getState().view;
    for (const id of Object.keys(panels)) {
      if (panels[id]) bus.send(UI.PANEL_CLOSE, { id });
    }
  });

  /* ---------- 左栏导航：只发意图 ---------- */

  const logoPanel = document.getElementById('logoPanel');
  logoPanel.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      bus.send(UI.PANEL_NAV, { nav: item.dataset.panel });
    });
  });

  /* ---------- 两个滑块：点一下发"切成另一个值"，不是直接改类 ---------- */

  /* 语言：切换后整页重载，静态和动态文案一次刷干净。
   * 有未保存改动先问，避免切语言把草稿冲掉。 */
  document.getElementById('langToggle').addEventListener('click', async () => {
    const cur = store.getState().business.settings.lang;
    const next = cur === 'zh' ? 'en' : 'zh';

    const { saveState } = store.getState().view;
    if (saveState === 'dirty' || saveState === 'failed' || saveState === 'saving') {
      const choice = await confirmDialog({
        title: t('切换语言要先处理未保存的改动'),
        message: t('界面会重新加载，未保存的改动会丢失。'),
        buttons: [t('保存并切换'), t('直接切换'), t('取消')],
      });
      if (choice === 2) return;
      if (choice === 0) {
        const ok = await saver.flush();
        if (!ok) {
          bus.emit('toast', t('保存失败'));
          return;
        }
      }
    }

    const res = await bus.send(BIZ.SETTINGS_SET_LANG, { lang: next });
    if (res.ok) window.location.reload();
  });

  document.getElementById('modeToggle').addEventListener('click', () => {
    const cur = store.getState().business.settings.mode;
    bus.send(BIZ.WORKSPACE_SET_MODE, { mode: cur === 'team' ? 'solo' : 'team' });
  });

  /* ---------- 面板底栏按钮 ---------- */

  const wsCancel = byId.get('logoPanel').querySelector('.ws-actions [data-action="cancel"]');
  const wsConfirm = byId.get('logoPanel').querySelector('.ws-actions [data-action="confirm"]');
  const wsFolder = document.getElementById('wsFolder');

  wsCancel.addEventListener('click', () => bus.send(UI.PANEL_CLOSE, { id: 'logoPanel' }));

  // 确定：团队模式必须先选中一个方框，单人模式直接进。进工作区 + 关面板。
  // 按钮的禁用态由 render 按"模式 + 是否选中"来维护，这里只做最后一道兜底。
  // 单人模式的终端就是在这里启动的；启动失败（总线已提示）就不关面板。
  wsConfirm.addEventListener('click', async () => {
    const state = store.getState();
    if (state.business.settings.mode === 'team' && !state.business.workspace.selectedId) return;
    const res = await bus.send(BIZ.WORKSPACE_ENTER);
    if (res.ok) bus.send(UI.PANEL_CLOSE, { id: 'logoPanel' });
  });

  // 文件夹：打开 Solo 工作区根目录。桌面端走 Electron；浏览器里没有系统能力，只提示。
  wsFolder.addEventListener('click', () => {
    if (!window.piFlow?.openSoloWorkspace) {
      bus.emit('toast', t('当前在浏览器里，只有桌面版能打开目录'));
      return;
    }
    window.piFlow.openSoloWorkspace()
      .then((error) => {
        if (error) bus.emit('toast', error);      // 成功时返回 null
      })
      .catch((error) => bus.emit('toast', String(error?.message || error)));
  });

  byId.get('addPanel').querySelector('[data-action="cancel"]')
    .addEventListener('click', () => bus.send(UI.PANEL_CLOSE, { id: 'addPanel' }));

  /* 注册面板的「选择」：桌面端弹系统目录选择器；浏览器里没有这个能力，
   * 退化成"手动粘贴绝对路径"，点一下给个提示。 */
  byId.get('addPanel').querySelector('.dlg-row .dlg-btn').addEventListener('click', async () => {
    const input = byId.get('addPanel').querySelector('.dlg-input');
    if (window.piFlow?.pickDirectory) {
      const dir = await window.piFlow.pickDirectory();
      if (dir) input.value = dir;
      return;
    }
    bus.emit('toast', t('当前在浏览器里，请直接粘贴项目文件夹的绝对路径'));
  });

  // 确定：读输入框 → 发注册意图 → 成功才清空并关面板
  byId.get('addPanel').querySelector('[data-action="confirm"]').addEventListener('click', async () => {
    const input = byId.get('addPanel').querySelector('.dlg-input');
    const res = await bus.send(BIZ.AGENT_REGISTER, { address: input.value.trim() });
    if (res.ok) {
      input.value = '';
      bus.send(UI.PANEL_CLOSE, { id: 'addPanel' });
    }
  });

  /* ---------- 渲染 ---------- */

  const soloInfo = document.getElementById('soloInfo');
  const teamBox = document.getElementById('teamBox');
  const wsPlus = document.getElementById('wsPlus');
  const wsTrash = document.getElementById('wsTrash');
  const langToggle = document.getElementById('langToggle');
  const modeToggle = document.getElementById('modeToggle');
  const navItems = logoPanel.querySelectorAll('.nav-item');
  const panelEls = logoPanel.querySelectorAll('.panel');

  /* ---------- 工作区方框：选中 / 增 / 删 ---------- */

  teamBox.addEventListener('click', (e) => {
    // 铅笔：进入重命名，别触发"选中"
    const edit = e.target.closest('.box-edit');
    if (edit) {
      e.stopPropagation();
      startRename(edit.closest('.box-item'));
      return;
    }
    const item = e.target.closest('.box-item');
    if (item) bus.send(BIZ.WORKSPACE_SELECT, { id: item.dataset.wsId });
  });

  /* 重命名：把名字换成内联输入框，回车/失焦提交，Esc 取消。
   * 这里只临时改 DOM；落定后发 workspace.rename，由状态 → render 把名字写回。 */
  function startRename(item) {
    const prevInput = teamBox.querySelector('.box-input');
    if (prevInput) finishRename(prevInput.closest('.box-item'), true);   // 一次只编辑一张

    const nameEl = item.querySelector('.box-name');
    const input = document.createElement('input');
    input.className = 'box-input';
    input.type = 'text';
    input.maxLength = 40;
    input.value = nameEl.textContent;
    input.dataset.prev = nameEl.textContent;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finishRename(item, true); }
      else if (e.key === 'Escape') { finishRename(item, false); }
    });
    input.addEventListener('blur', () => finishRename(item, true));
  }

  function finishRename(item, commit) {
    const input = item.querySelector('.box-input');
    if (!input) return;                              // 已经落定过
    const value = input.value.trim();
    const span = document.createElement('span');
    span.className = 'box-name';
    span.textContent = value || input.dataset.prev || '';
    input.replaceWith(span);
    if (commit && value) bus.send(BIZ.WORKSPACE_RENAME, { id: item.dataset.wsId, name: value });
  }

  wsPlus.addEventListener('click', () => bus.send(BIZ.WORKSPACE_ADD));

  wsTrash.addEventListener('click', () => {
    const id = store.getState().business.workspace.selectedId;
    if (id) bus.send(BIZ.WORKSPACE_REMOVE, { id });
  });

  let wsKey = '';   // 方框列表的 id 序列，只在增删时重建 DOM，避免每次 commit 都重绘

  function render(state) {
    // 1. 开关
    for (const [id, overlay] of byId) {
      syncOpen(overlay, state.view.panels[id] === true);
    }

    // 2. 左栏导航
    navItems.forEach((item) => {
      item.classList.toggle('active', item.dataset.panel === state.view.nav);
    });
    panelEls.forEach((p) => {
      p.hidden = p.id !== 'panel-' + state.view.nav;
    });

    // 3. 语言滑块
    const { lang, mode } = state.business.settings;
    langToggle.classList.toggle('en', lang === 'en');
    langToggle.querySelectorAll('.lang-opt').forEach((opt) => {
      opt.classList.toggle('active', opt.dataset.lang === lang);
    });

    // 4. 模式滑块 + 两种模式的内容切换
    const solo = mode === 'solo';
    modeToggle.classList.toggle('en', solo);
    modeToggle.querySelectorAll('.lang-opt').forEach((opt) => {
      opt.classList.toggle('active', opt.dataset.mode === mode);
    });
    soloInfo.hidden = !solo;
    teamBox.hidden = solo;
    wsPlus.hidden = solo;     // 加号只属于团队模式（往框里加条目）
    wsTrash.hidden = solo;    // 垃圾桶同理
    wsFolder.hidden = !solo;  // 文件夹只属于单人模式

    // 5. 方框列表：只在增删时重建 DOM，名字/选中每次都要对
    const workspaces = state.business.workspaces;
    const key = workspaces.map((w) => w.id).join(',');
    if (key !== wsKey) {
      wsKey = key;
      teamBox.replaceChildren(...workspaces.map((w) => {
        const el = document.createElement('div');
        el.className = 'box-item';
        el.dataset.wsId = w.id;
        el.innerHTML = `
          <span class="box-name"></span>
          <button class="box-edit" type="button" aria-label="${t('重命名')}" title="${t('重命名')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
            </svg>
          </button>`;
        el.querySelector('.box-name').textContent = w.name;
        return el;
      }));
    }
    const selectedId = state.business.workspace.selectedId;
    for (const el of teamBox.querySelectorAll('.box-item')) {
      const ws = workspaces.find((w) => w.id === el.dataset.wsId);
      const nameEl = el.querySelector('.box-name');
      // 重命名后 id 序列没变、不会重建，这里单独把新名字对上去；
      // 正在编辑的那张没有 .box-name，跳过即可
      if (ws && nameEl && nameEl.textContent !== ws.name) nameEl.textContent = ws.name;
      el.classList.toggle('selected', el.dataset.wsId === selectedId);
    }

    // 6. 确定 / 垃圾桶的可用性：团队模式没选中时两个都点不动
    wsConfirm.disabled = !solo && !selectedId;
    wsTrash.disabled = !selectedId;
  }

  store.subscribe(render);
}

/* 幂等：开着的重复置开不会重播动画，关着的重复置关不会重播关闭动画 */
function syncOpen(overlay, open) {
  if (open) {
    overlay.classList.remove('closing');
    overlay.classList.add('open');
    return;
  }
  if (overlay.classList.contains('open')) {
    overlay.classList.remove('open');
    overlay.classList.add('closing');
  }
}
