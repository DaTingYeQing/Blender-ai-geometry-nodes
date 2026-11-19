/* ===== 业务：注册 agent =====
 * 现在的行为：登记地址 → 侧栏出现一个以该地址命名的团队。
 * （保留了原来 main.js 里"确定后加一个团队方块"的效果，只是把规则从按钮回调里挪出来。）
 */

import { BIZ } from '../core/intent.js';
import { pickHue } from '../core/theme.js';
import { t } from '../core/i18n.js';

export function registerAgent(bus, { api, getState, commit, saveFlow }) {
  bus.handle(BIZ.AGENT_REGISTER, async ({ address }) => {
    /* 后端要的是项目文件夹的绝对路径，名字取最后一段目录名。
     * 路径不存在 / 不是目录，后端会拒绝，提示由总线统一弹。 */
    const projectPath = String(address || '').trim();
    if (!projectPath) throw new Error(t('请先选择项目文件夹'));

    const name = projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || projectPath;
    const agent = await api.createAgent({ name, projectPath });

    commit((s) => {
      /* 后端返回的 Agent 没有颜色，按当前数量补一个。 */
      s.business.teams.push({ ...agent, ...pickHue(s.business.teams.length) });
    });
    return { ok: true, data: agent };
  });

  /* 读一段对话：状态放在 sessionView 里，结果屏只负责显示。
   * 失败也写进状态（不抛错），这样界面能显示错误而不是一片空白。 */
  bus.handle(BIZ.SESSION_LOAD, async ({ agentId, sessionId }) => {
    if (!agentId || !sessionId) throw new Error(t('缺少 Agent 或对话'));

    commit((s) => {
      s.business.sessionView = {
        agentId, sessionId, entries: [], missing: false, error: '', loading: true,
      };
    });

    try {
      const data = await api.getSession({ agentId, sessionId });
      commit((s) => {
        s.business.sessionView = {
          agentId,
          sessionId,
          entries: data.entries || [],
          missing: Boolean(data.missing),
          error: '',
          loading: false,
        };
      });
    } catch (error) {
      commit((s) => {
        s.business.sessionView = {
          agentId, sessionId, entries: [], missing: false,
          error: String(error?.message || error), loading: false,
        };
      });
    }

    return { ok: true };
  });

  /* 重命名对话：后端只改 title，界面跟着更新下拉和默认屏那一行。 */
  bus.handle(BIZ.SESSION_RENAME, async ({ agentId, sessionId, title }) => {
    const data = await api.renameSession({ agentId, sessionId, title });
    const next = String(data?.session?.title || title || '');
    commit((s) => {
      const team = s.business.teams.find((t) => t.id === agentId);
      const session = team?.sessions?.find((item) => item.id === sessionId);
      if (session) session.title = next;
    });
    return { ok: true, data: data?.session };
  });

  /* 删除对话：只删注册记录，不碰 pi 的会话文件。
   * 顺手清掉两个引用：结果屏正看着它、以及有节点正复用它（后者要存回流程）。 */
  bus.handle(BIZ.SESSION_DELETE, async ({ agentId, sessionId }) => {
    const team = getState().business.teams.find((t) => t.id === agentId);
    const target = team?.sessions?.find((item) => item.id === sessionId) || null;
    await api.deleteSession({ agentId, sessionId });

    commit((s) => {
      const current = s.business.teams.find((t) => t.id === agentId);
      if (current) current.sessions = (current.sessions || []).filter((x) => x.id !== sessionId);

      if (target?.piSessionId && s.business.sessionView.sessionId === target.piSessionId) {
        s.business.sessionView = {
          agentId: null, sessionId: null, entries: [], missing: false, error: '', loading: false,
        };
      }

      for (const node of s.business.nodes) {
        if (node.sessionId === sessionId) {
          node.sessionId = null;
          node.sessionMode = 'new';
        }
      }
    });
    saveFlow();   // 节点引用变了，流程要跟着存
    return { ok: true };
  });
}
