/* ===== 流程同步：前端草稿与后端流程之间的唯一映射 =====
 *
 * 两件事：
 *   1. toBackendFlow / fromFlow —— 字段映射。后端节点只认 agentId/title/x/y/task/
 *      color/handoffEnabled/sessionMode/sessionId；前端节点上的 alert/running/runId/
 *      artifacts 属于运行态，不写进流程。
 *   2. createFlowSaver —— 手动保存。节点/连线的改动只调 save() 打"未保存"标记，
 *      用户点工作区右上角的 save 才把一个 PUT 发出去（后端只有整份保存）。
 *
 * 这里不碰 DOM，也不决定"什么算一次改动"，只负责把当前状态搬过去。
 */

import { hsl } from '../core/theme.js';

const BOW = 40;        // 反向成对的两条线各弯开多少，和 business/canvas.js 保持一致

/** 前端状态 -> 后端流程。运行态字段一律不写。 */
export function toBackendFlow(state, flowId) {
  const { nodes, edges, teams, workspaces } = state.business;
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const flow = workspaces.find((item) => item.id === flowId);

  return {
    name: flow?.name || "",
    nodes: nodes.map((node) => {
      const team = teamById.get(node.agentId);
      return {
        id: node.id,
        agentId: node.agentId,
        title: node.title || "",
        x: node.x,
        y: node.y,
        task: node.task || "",
        color: team ? team.h : 0,
        handoffEnabled: node.handoffEnabled !== false,
        sessionMode: node.sessionMode === 'reuse' ? 'reuse' : 'new',
        sessionId: node.sessionId || null,
        /* 只记"上次用的 run"：重进工作区后要靠它把产物列表找回来。
         * 其他运行态（展平后的文件、日志）仍然不写。 */
        lastRunId: node.runId || null,
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      files: Array.isArray(edge.files) ? edge.files : [],
    })),
  };
}

/** 后端流程 -> 前端状态。运行态字段重新初始化，颜色和弯曲由前端自己算。 */
export function fromFlow(flow, teams) {
  const teamById = new Map(teams.map((team) => [team.id, team]));

  /* 团队被删后，旧流程里可能还留着它名下的节点。
   * 这种节点画不出来也跑不了，直接丢掉；下面连线再做一次端点检查。 */
  const nodes = (flow.nodes || [])
    .filter((node) => teamById.has(node.agentId))
    .map((node) => ({
      id: node.id,
      agentId: node.agentId,
      title: node.title || "",
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      task: String(node.task || ""),
      handoffEnabled: node.handoffEnabled !== false,
      sessionMode: node.sessionMode === 'reuse' ? 'reuse' : 'new',
      sessionId: node.sessionId || null,
      alert: false,
      running: false,
      runId: node.lastRunId || null,   // 上次运行的 id：产物按它重新拉
      artifacts: [],
      artifactsLoaded: false,
    }));

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = (flow.edges || [])
    .filter((edge) => byId.has(edge.from) && byId.has(edge.to))
    .map((edge) => {
      const from = byId.get(edge.from);
      return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        color: hsl(teamById.get(from.agentId)),
        bow: 0,
        files: Array.isArray(edge.files) ? edge.files : [],
      };
    });

  /* 反向成对的两条线各弯开一侧 —— 和拉线时 business/canvas.js 的规则一致。 */
  for (const edge of edges) {
    const reverse = edges.find((item) => item.from === edge.to && item.to === edge.from);
    if (reverse) {
      edge.bow = BOW;
      reverse.bow = -BOW;
    }
  }

  return { nodes, edges };
}

/** 手动保存器：改动只打"未保存"标记，用户点右上角 save 才 PUT 整份流程。 */
export function createFlowSaver({ api, getState, commit }) {
  let dirty = false;
  let version = 0;        // 每次改动 +1；用来判断保存期间有没有又改过
  let pending = null;     // 正在进行的保存。并发调用一律复用它，不再当成失败
  let resetTimer = null;

  function setState(next) {
    commit((s) => {
      s.view.saveState = next;
    });
  }

  /* 业务改动只打标记，不发请求。 */
  function save() {
    if (!getState().business.workspace.selectedId) return;
    version += 1;
    if (dirty) return;
    dirty = true;
    setState('dirty');
  }

  /* 真正落盘。返回是否成功；保存期间又有改动就继续保持未保存。
   *
   * 并发时不能直接返回 false —— 关窗 / 切语言 / 连点保存都可能撞上正在进行的
   * 请求，false 会被当成"保存失败"而拦住用户。这里把同一个 Promise 交出去，
   * 所有调用方等的是同一次结果。 */
  async function flush() {
    if (pending) return pending;

    const state = getState();
    const flowId = state.business.workspace.selectedId;
    if (!flowId) return true;

    const snapshot = version;
    setState('saving');
    pending = (async () => {
      try {
        await api.saveFlow({ id: flowId, ...toBackendFlow(state, flowId) });
        if (version === snapshot) {
          dirty = false;
          setState('saved');
          /* 绿灯亮一会儿就回落成普通 save，别一直挂着。 */
          if (resetTimer) clearTimeout(resetTimer);
          resetTimer = setTimeout(() => {
            if (!dirty) setState('idle');
          }, 1800);
        } else {
          setState('dirty');     // 保存过程中又改了，依旧算未保存
        }
        return true;
      } catch (error) {
        console.warn('[flow-save]', error);
        setState('failed');
        return false;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  function isDirty() {
    return dirty;
  }

  /* 换流程时清掉上一份的绿/红状态。 */
  function reset() {
    dirty = false;
    version = 0;
    if (resetTimer) clearTimeout(resetTimer);
    if (getState().view.saveState !== 'idle') setState('idle');
  }

  return { save, flush, isDirty, reset };
}
