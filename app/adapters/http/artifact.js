/* ===== Artifact Adapter：实现 ArtifactApi =====
 * 读取工作区文件、列出某个 Agent 工作区里的文件。
 */

/** @param {{ request: (path: string, init?: Object) => Promise<any> }} deps */
export function createArtifactAdapter({ request }) {
  return {
    /* GET /api/file?path=... -> { content, ... } */
    async readFile({ path, signal }) {
      return request(`/api/file?path=${encodeURIComponent(path)}`, { signal });
    },

    /* GET /api/agents/:id/files -> { files }（name 为工作区相对路径） */
    async listFiles({ agentId, signal }) {
      const data = await request(`/api/agents/${encodeURIComponent(agentId)}/files`, { signal });
      return Array.isArray(data?.files) ? data.files : [];
    },
  };
}
