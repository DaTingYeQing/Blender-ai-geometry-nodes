/* ===== 后端接口层 =====
 * 这个文件是前端唯一知道"数据到底存在哪"的地方，方法名直接对齐后端契约
 * （server/contract.mjs）。页面和后端同源（127.0.0.1:4173），所以路径都是相对的。
 *
 * 分两类：
 *   - 已接后端：Agent、流程、运行、产物 —— 直接 fetch。
 *   - 本地占位：后端没有对应端点的那几个（节点/连线的增量操作、改名、语言），
 *     等画布读写那一步改成"整份流程保存"后再删掉。
 *
 * 每个方法都是 async，哪怕现在立刻就能返回 —— 否则调用方会养成不等结果的习惯。
 */

import { pickHue } from '../../js/core/theme.js';

let seq = { team: 0, node: 0, edge: 0 };

/* 语言偏好：默认英文；用户在界面里切到中文后存在 localStorage。
 * 后端按请求头 X-Pi-Locale 切自己的文案。 */
const LOCALE_KEY = 'pi-flow-locale';
let locale = (() => {
  try {
    return localStorage.getItem(LOCALE_KEY) === 'zh' ? 'zh' : 'en';
  } catch {
    return 'en';        // 隐私模式下读不到，按英文
  }
})();

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'X-Pi-Locale': locale,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `请求失败（${res.status}）`);
  return data;
}

export const api = {
  /* ---------- 首屏 ---------- */

  async bootstrap() {
    return request('/api/state');
  },

  /* ---------- Agent（UI 里叫"团队"）---------- */

  async listAgents() {
    return (await request('/api/agents')).agents;
  },

  async createAgent({ name, projectPath }) {
    /* TODO(拼装后): 注册面板改成选目录（F16）后，删掉这个本地分支，一律走后端。 */
    if (!projectPath) {
      const i = seq.team++;
      return { id: 't' + (i + 1), name, ...pickHue(i) };
    }
    return (await request('/api/agents', { method: 'POST', body: { name, projectPath } })).agent;
  },

  async deleteAgent({ id }) {
    if (!String(id || '').startsWith('agent-')) return { ok: true };   // 本地占位的 id 不动后端
    return request(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /* 读一段对话的正文。sessionId 传内部 id 或 pi 的会话 id 都行，
   * 后端两种都认；前端现在传的是 pi 的会话 id。 */
  async getSession({ agentId, sessionId }) {
    return request(
      `/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
    );
  },

  /* 会话改名 / 删除：这里的 sessionId 是后端 session.id（内部 id），
   * 不是 pi 的会话 id —— 和节点上复用的那个字段一致。后端两种 id 都认。 */
  async renameSession({ agentId, sessionId, title }) {
    return request(
      `/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'PATCH', body: { title } },
    );
  },

  async deleteSession({ agentId, sessionId }) {
    return request(
      `/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
    );
  },

  /* ---------- 流程（UI 里叫"工作区"）---------- */

  async listFlows() {
    return (await request('/api/flows')).flows;
  },

  async createFlow({ name } = {}) {
    return (await request('/api/flows', { method: 'POST', body: { name } })).flow;
  },

  async getFlow({ id }) {
    return (await request(`/api/flows/${encodeURIComponent(id)}`)).flow;
  },

  async saveFlow({ id, nodes, edges }) {
    return request(`/api/flows/${encodeURIComponent(id)}`, { method: 'PUT', body: { nodes, edges } });
  },

  async deleteFlow({ id }) {
    return request(`/api/flows/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /* 删掉所有流程里属于这个 Agent 的节点和相连的线。删团队后立刻调用。 */
  async pruneFlows({ agentId }) {
    return request('/api/flows/prune', { method: 'POST', body: { agentId } });
  },

  /* ---------- 运行 ---------- */

  async runNode({ node, flowId, inputFiles = [] }) {
    return request('/api/run', { method: 'POST', body: { node, flowId, inputFiles } });
  },

  async getRun({ id }) {
    return request(`/api/runs/${encodeURIComponent(id)}`);
  },

  async abortRun({ id }) {
    return request(`/api/runs/${encodeURIComponent(id)}/abort`, { method: 'POST' });
  },

  /* ---------- 产物 ---------- */

  async readFile({ path }) {
    return request(`/api/file?path=${encodeURIComponent(path)}`);
  },

  /* ================================================================
   * [临时] 本地占位：后端没有对应端点，或者要等界面改造完才能接。
   * 拼装后统一重构 —— 这一段都是"前端替后端扛着"的部分，不要在这里加新逻辑。
   * ================================================================ */

  /* 节点和连线：后端没有单条增删的端点，只能整份流程 PUT。
   * TODO(拼装后): 改成"改本地流程快照 + saveFlow"，这几个假实现一起删。 */
  async createNode({ agentId, x, y }) {
    return {
      id: 'n' + (++seq.node),
      agentId,
      x,
      y,
      task: '',
      handoffEnabled: true,
      sessionMode: 'new',
      sessionId: null,
      alert: false,
      running: false,
      runId: null,
      artifacts: [],
      artifactsLoaded: false,
    };
  },

  async moveNode() {
    return { ok: true };
  },

  async removeNode() {
    return { ok: true };
  },

  async createEdge({ from, to, color }) {
    return { id: 'e' + (++seq.edge), from, to, color, bow: 0, files: [] };
  },

  /* 连线上带哪些产物：后端 edge.files 字段，随整个流程保存。 */
  async setEdgeFiles() {
    return { ok: true };
  },

  async setTask() {
    return { ok: true };
  },

  /* 上游产物开关：后端节点字段是 handoffEnabled，随整个流程保存。 */
  async setHandoff() {
    return { ok: true };
  },

  /* 会话模式：后端节点字段是 sessionMode（'new' / 'reuse'），随整个流程保存。 */
  async setSessionMode() {
    return { ok: true };
  },

  /* 复用哪一段对话：后端节点字段是 sessionId，随整个流程保存。 */
  async setSession() {
    return { ok: true };
  },

  async raiseAlert() {
    return { ok: true };
  },

  async clearAlert() {
    return { ok: true };
  },

  /* 流程改名不再单独发请求：名字跟着整份保存一起 PUT。 */

  /* 语言：只记住偏好，之后每个请求由 request() 统一带头。
   * 后端文案会跟着切；界面上的固定文字暂时还是中文（没有做文案表）。 */
  async setLang({ lang }) {
    locale = lang === 'en' ? 'en' : 'zh';
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // 隐私模式写不了，忽略
    }
    return { ok: true };
  },

  getLocale() {
    return locale;
  },

  async setMode({ mode }) {
    if (mode === 'solo') return request('/api/single/launch', { method: 'POST' });
    return { ok: true };
  },
};
