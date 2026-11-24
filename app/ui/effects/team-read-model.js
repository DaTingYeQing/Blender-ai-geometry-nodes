/* ===== 团队读模型（Effects 拥有）=====
 * 侧栏里的“团队”就是后端的 Agent：复用 AgentReadModel 的缓存，不另发请求，
 * 只在读出时补上颜色（h/s/l）与会话列表的默认值。
 *
 * 颜色是纯展示投影，由组装根注入（旧内核暂时仍用 core/theme.js 的色板）；
 * 读模型自己不认识任何 UI 模块。
 */

/**
 * @param {{
 *   agents: ReturnType<typeof import('./read-model.js').createAgentReadModel>,
 *   colorFor?: (agent: Object, index: number) => { h?: number, s?: number, l?: number },
 * }} deps
 */
export function createTeamReadModel({ agents, colorFor = () => ({}) }) {
  if (!agents) throw new Error('createTeamReadModel: 需要 AgentReadModel');

  /* 同一份 Agent 数组只投影一次：peekAgents 返回的是缓存里的同一个引用，
   * 因此每次重画拿到的是同一批团队对象，区域可以按引用跳过更新。 */
  let lastAgents = null;
  let lastTeams = [];

  function project(agent, index) {
    const color = colorFor(agent, index) || {};
    return {
      id: agent.id,
      name: agent.name,
      sessions: Array.isArray(agent.sessions) ? agent.sessions : [],
      h: color.h ?? 0,
      s: color.s ?? 0,
      l: color.l ?? 0,
    };
  }

  function projectAll(list) {
    if (list === lastAgents) return lastTeams;
    const source = Array.isArray(list) ? list : [];
    lastAgents = list;
    lastTeams = source.map(project);
    return lastTeams;
  }

  function peek() {
    return projectAll(agents.peekAgents());
  }

  return {
    /** 读取团队列表；底层 Agent 列表已缓存时不会重复请求。 */
    getTeams() {
      return agents.getAgents().then(projectAll);
    },

    /** 给区域 / 选择器的快照，不触发请求。 */
    peekTeams: peek,

    teamOf(teamId) {
      if (!teamId) return null;
      return peek().find((team) => team.id === teamId) || null;
    },

    /** 团队删除成功后同步摘掉缓存，侧栏下次重画就不再出现。 */
    removeTeam(teamId) {
      if (!teamId) return;
      agents.removeAgent(teamId);
    },

    /** 结果屏的会话下拉只需要这个 Agent 的会话列表。 */
    sessionsOf(teamId) {
      if (!teamId) return [];
      return peek().find((team) => team.id === teamId)?.sessions || [];
    },
  };
}
