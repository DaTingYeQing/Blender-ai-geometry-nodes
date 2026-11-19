/* ===== 业务：工作区 =====
 * "进/退工作区"和"团队模式/单人模式"都挂在这里。
 * 注意 entered 是业务状态而不是界面状态：将来它决定要不要去后端拉这个工作区的内容。
 */

import { BIZ } from '../core/intent.js';
import { t } from '../core/i18n.js';
import { fromFlow } from './flow-sync.js';

export function registerWorkspace(bus, { api, getState, commit, saveFlow }) {
  /* 进工作区 = 打开选中的那个流程，节点和连线从后端读，不再用前端自己造的。 */
  bus.handle(BIZ.WORKSPACE_ENTER, async () => {
    const state = getState();

    /* 单人模式：真正开外部终端这个动作绑在"确定"上。
     * 滑块只是选模式，选完不启动；否则点一下滑块就弹一个终端窗口。 */
    if (state.business.settings.mode === 'solo') {
      await api.setMode({ mode: 'solo' });
      /* 单人模式没有团队画布：外部终端就是工作区。
       * 按确定只启动终端并退回首页，不把上一次的团队节点当成 Solo 工作区显示。 */
      commit((s) => {
        s.business.workspace.entered = false;
        s.business.focus = { teamId: null, nodeId: null, edgeId: null, pane: 'default' };
      });
      return { ok: true };
    }

    const flowId = state.business.workspace.selectedId;

    let loaded = null;
    if (flowId) {
      const flow = await api.getFlow({ id: flowId });
      loaded = fromFlow(flow, state.business.teams);
    }

    commit((s) => {
      s.business.workspace.entered = true;
      if (loaded) {
        s.business.nodes = loaded.nodes;
        s.business.edges = loaded.edges;
      }
    });
    return { ok: true };
  });

  /* 退出工作区：除了把画布收起来，侧栏也必须立刻收回"彩虹条"。
   * 这条规则放在业务层而不是挂在某个按钮的回调里 —— 离开工作区有三个入口
   * （点左上角缩小后的标题、将来可能还有快捷键、面包屑），挂在按钮上就得挂三遍，
   * 漏一个就会出现"退出了但侧栏还开着"的岔子。
   * focus 一清，侧栏自己就收；不用管它当时停在默认屏、产物屏还是结果屏。 */
  bus.handle(BIZ.WORKSPACE_LEAVE, async () => {
    commit((s) => {
      s.business.workspace.entered = false;
      s.business.focus = { teamId: null, nodeId: null, edgeId: null, pane: 'default' };
    });
    return { ok: true };
  });

  /* 切换模式只改本地选择。单人模式要等用户按"确定"才真正启动终端，
   * 启动动作在 WORKSPACE_ENTER 里。 */
  bus.handle(BIZ.WORKSPACE_SET_MODE, async ({ mode }) => {
    if (mode !== 'team' && mode !== 'solo') throw new Error(t('未知模式：{mode}', { mode }));
    commit((s) => {
      s.business.settings.mode = mode;
    });
    return { ok: true };
  });

  /* 面板里选中哪个方框：只改一个 id，界面（高亮、确定/垃圾桶的可用性）由它派生。 */
  bus.handle(BIZ.WORKSPACE_SELECT, async ({ id }) => {
    commit((s) => {
      s.business.workspace.selectedId = id;
    });
    return { ok: true };
  });

  /* 新增一个方框，顺手选中它 —— 刚加完就能直接按确定。 */
  bus.handle(BIZ.WORKSPACE_ADD, async () => {
    const ws = await api.createFlow();
    commit((s) => {
      s.business.workspaces.push(ws);
      s.business.workspace.selectedId = ws.id;
    });
    return { ok: true, data: ws };
  });

  /* 删除方框；删的是当前选中的那个就把选中清掉，否则确定会指向一个不存在的方框。 */
  bus.handle(BIZ.WORKSPACE_REMOVE, async ({ id }) => {
    await api.deleteFlow({ id });
    commit((s) => {
      s.business.workspaces = s.business.workspaces.filter((w) => w.id !== id);
      if (s.business.workspace.selectedId === id) {
        s.business.workspace.selectedId = null;
      }
    });
    return { ok: true };
  });

  /* 重命名方框。空名不落（前端也会拦一道，这里兜底）。 */
  bus.handle(BIZ.WORKSPACE_RENAME, async ({ id, name }) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return { ok: true };
    commit((s) => {
      const ws = s.business.workspaces.find((w) => w.id === id);
      if (ws) ws.name = trimmed;
    });
    /* 改名也走整份保存（流程名跟着一起 PUT）；只有当前打开的流程会被保存。 */
    if (id === getState().business.workspace.selectedId) saveFlow();
    return { ok: true };
  });
}
