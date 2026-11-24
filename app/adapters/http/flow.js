/* ===== Flow Adapter：实现 FlowApi =====
 * 流程（UI 叫"工作区"）。后端只有整份保存，没有逐节点补丁。
 */

/** @param {{ request: (path: string, init?: Object) => Promise<any> }} deps */
export function createFlowAdapter({ request }) {
  return {
    /* GET /api/flows -> { flows } */
    async listFlows({ signal } = {}) {
      return (await request('/api/flows', { signal })).flows;
    },

    /* POST /api/flows -> { flow } */
    async createFlow({ name } = {}) {
      return (await request('/api/flows', { method: 'POST', body: { name } })).flow;
    },

    /* GET /api/flows/:id -> { flow } */
    async getFlow({ id, signal }) {
      return (await request(`/api/flows/${encodeURIComponent(id)}`, { signal })).flow;
    },

    /* PUT /api/flows/:id —— 整份保存 nodes + edges。 */
    async saveFlow({ id, name, nodes, edges }) {
      return request(`/api/flows/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: { name, nodes, edges },
      });
    },

    /* DELETE /api/flows/:id */
    async deleteFlow({ id }) {
      return request(`/api/flows/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    /* 删掉所有流程里属于这个 Agent 的节点和相连的线。删团队后立刻调用。 */
    async pruneFlows({ agentId }) {
      return request('/api/flows/prune', { method: 'POST', body: { agentId } });
    },
  };
}
