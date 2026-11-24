/* ===== Run Adapter：实现 RunApi =====
 * 启动、查询、中止一次运行。轮询节奏不属于 Adapter，由调用方决定。
 */

/** @param {{ request: (path: string, init?: Object) => Promise<any> }} deps */
export function createRunAdapter({ request }) {
  return {
    /* POST /api/run -> { runId, sessionInternalId, status, ... } */
    async runNode({ flowId, node, inputFiles = [] }) {
      return request('/api/run', {
        method: 'POST',
        body: { node, flowId, inputFiles },
      });
    },

    /* GET /api/runs/:id -> { status, transcript, artifacts, ... } */
    async getRun({ id, signal }) {
      return request(`/api/runs/${encodeURIComponent(id)}`, { signal });
    },

    /* POST /api/runs/:id/abort */
    async abortRun({ id }) {
      return request(`/api/runs/${encodeURIComponent(id)}/abort`, { method: 'POST' });
    },
  };
}
