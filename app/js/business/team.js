/* ===== 业务：团队 =====
 * 登记的是"团队"这件事的所有规则。界面怎么画、动画怎么播，这里一概不管。
 * handler 签名统一：(payload, ctx) => Promise<{ ok, data?, error? }>
 *   ctx = { api, getState, commit }
 */

import { BIZ } from '../core/intent.js';

export function registerTeam(bus, { api, getState, commit, saveFlow }) {
  bus.handle(BIZ.TEAM_CREATE, async ({ name }) => {
    const team = await api.createAgent({ name });
    commit((s) => {
      s.business.teams.push(team);
    });
    return { ok: true, data: team };
  });

  /* 聚焦规则集中在这一处，三个入口（点节点 / 点连线中点的圆点 / 侧栏按钮）共用：
   *   - 再点一次同一个入口（同节点 + 同视图）→ 收起
   *   - 换视图（节点 ↔ 圆点）→ 只切视图，不收起
   *   - 换节点（同团队的另一个副本）→ 切归属，不收起：副本本质上是两个不同的节点
   * 归属记在 nodeId 上，不是 teamId —— 团队可以无限复制放好多次，谁打开就属于谁。 */
  bus.handle(BIZ.TEAM_FOCUS, async ({ teamId, nodeId = null, edgeId = null, pane = 'default' }) => {
    commit((s) => {
      const cur = s.business.focus;
      /* edgeId 也参与"同一个入口"的判断：点同一条线两次收起，
       * 换到另一条线只切换，不收起。 */
      const collapsing = cur.teamId === teamId && cur.nodeId === nodeId
        && cur.pane === pane && (cur.edgeId || null) === (edgeId || null);
      s.business.focus = collapsing
        ? { teamId: null, nodeId: null, edgeId: null, pane: 'default' }
        : { teamId, nodeId, edgeId, pane };
    });
    return { ok: true };
  });

  bus.handle(BIZ.TEAM_REMOVE, async ({ teamId }) => {
    await api.deleteAgent({ id: teamId });
    /* 这个团队可能在别的流程里也放了节点。服务端把所有流程一起清：
     * 指向它的节点删掉，连到这些节点的线也一并删掉。 */
    await api.pruneFlows({ agentId: teamId });
    commit((s) => {
      const { teams, nodes } = s.business;
      s.business.teams = teams.filter((t) => t.id !== teamId);
      s.business.nodes = nodes.filter((n) => n.agentId !== teamId);
      const alive = new Set(s.business.nodes.map((n) => n.id));
      s.business.edges = s.business.edges.filter((e) => alive.has(e.from) && alive.has(e.to));
      if (s.business.focus.teamId === teamId) {
        s.business.focus = { teamId: null, nodeId: null, edgeId: null, pane: 'default' };
      }
    });
    saveFlow();
    return { ok: true };
  });
}
