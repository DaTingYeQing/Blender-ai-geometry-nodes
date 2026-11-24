/* ===== Agent Adapter：实现 AgentApi =====
 * 只做"拼路径 + 拆响应"。没有业务判断，不 import UI，不碰状态。
 * 路径与载荷对齐 server/contract.mjs。
 */

/** @param {{ request: (path: string, init?: Object) => Promise<any> }} deps */
export function createAgentAdapter({ request }) {
  return {
    /* GET /api/agents -> { agents } */
    async listAgents({ signal } = {}) {
      return (await request('/api/agents', { signal })).agents;
    },

    /* GET /api/tools -> { tools, profiles } */
    async getTools({ signal } = {}) {
      return request('/api/tools', { signal });
    },

    /* POST /api/agents/create -> { agent } */
    async createAgent({ name, tools }) {
      return (await request('/api/agents/create', {
        method: 'POST',
        body: { name, tools },
      })).agent;
    },

    /* GET /api/agents/:id/config -> { agent, config } */
    async getAgentConfig({ agentId, signal }) {
      return request(`/api/agents/${encodeURIComponent(agentId)}/config`, { signal });
    },

    /* PUT /api/agents/:id/config -> { agent } */
    async saveAgentConfig({ agentId, name, tools }) {
      return request(`/api/agents/${encodeURIComponent(agentId)}/config`, {
        method: 'PUT',
        body: { name, tools },
      });
    },

    /* DELETE /api/agents/:id */
    async deleteAgent({ id }) {
      return request(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    /* 读一段对话正文。sessionId 传内部 id 或 pi 的会话 id 都行，后端两种都认；
     * 前端现在传的是 pi 的会话 id。 */
    async getSession({ agentId, sessionId, signal }) {
      return request(
        `/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
        { signal },
      );
    },

    /* 会话改名。sessionId 是后端 session.id（内部 id），不是 pi 的会话 id。 */
    async renameSession({ agentId, sessionId, title }) {
      return request(
        `/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'PATCH', body: { title } },
      );
    },

    /* 删除会话注册记录（不碰 pi 的会话文件）。 */
    async deleteSession({ agentId, sessionId }) {
      return request(
        `/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      );
    },
  };
}
