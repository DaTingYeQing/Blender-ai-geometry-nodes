/* ===== 画布编解码：前端草稿与后端流程之间的唯一映射 =====
 *
 * toBackendFlow / fromFlow —— 字段映射。后端节点只认 agentId/title/x/y/task/
 * color/handoffEnabled/sessionMode/sessionId/lastRunId；前端节点上的
 * alert/running/runId/artifacts 属于运行态，不写进流程。
 *
 * 纯函数：不读全局 store、不碰 DOM，颜色 HSL 由本文件按团队字段算，
 * 方便在状态层与组装根共用。
 */

const BOW = 40;        // 反向成对的两条线各弯开多少，和 ui/effects/canvas.js 保持一致

/** h/s/l → CSS 颜色串；与显示层语义一致，但不依赖旧 theme 模块。 */
function hsl({ h, s, l } = {}) {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/**
 * 画布快照 → 后端流程。运行态字段一律不写。
 * @param {{
 *   nodes: Array<any>,
 *   edges: Array<any>,
 *   teams: Array<any>,
 *   name?: string,
 * }} snapshot
 */
export function toBackendFlow({ nodes = [], edges = [], teams = [], name = '' } = {}) {
  const teamById = new Map((Array.isArray(teams) ? teams : []).map((team) => [team.id, team]));

  return {
    name: name || '',
    nodes: (Array.isArray(nodes) ? nodes : []).map((node) => {
      const team = teamById.get(node.agentId);
      return {
        id: node.id,
        agentId: node.agentId,
        title: node.title || '',
        x: node.x,
        y: node.y,
        task: node.task || '',
        color: team ? team.h : 0,
        handoffEnabled: node.handoffEnabled !== false,
        sessionMode: node.sessionMode === 'reuse' ? 'reuse' : 'new',
        sessionId: node.sessionId || null,
      };
    }),
    edges: (Array.isArray(edges) ? edges : []).map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      files: Array.isArray(edge.files) ? edge.files : [],
    })),
  };
}

/** 后端流程 → 画布切片。运行态字段重新初始化，颜色和弯曲由前端自己算。 */
export function fromFlow(flow, teams = []) {
  const teamById = new Map((Array.isArray(teams) ? teams : []).map((team) => [team.id, team]));

  /* 团队被删后，旧流程里可能还留着它名下的节点。
   * 这种节点画不出来也跑不了，直接丢掉；下面连线再做一次端点检查。 */
  const nodes = (flow?.nodes || [])
    .filter((node) => teamById.has(node.agentId))
    .map((node) => ({
      id: node.id,
      agentId: node.agentId,
      title: node.title || '',
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      task: String(node.task || ''),
      handoffEnabled: node.handoffEnabled !== false,
      sessionMode: node.sessionMode === 'reuse' ? 'reuse' : 'new',
      sessionId: node.sessionId || null,
      alert: false,
      running: false,
      artifacts: [],
      artifactsLoaded: false,
    }));

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = (flow?.edges || [])
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

  /* 反向成对的两条线各弯开一侧 —— 和拉线时 ui/effects/canvas.js 的规则一致。 */
  for (const edge of edges) {
    const reverse = edges.find((item) => item.from === edge.to && item.to === edge.from);
    if (reverse) {
      edge.bow = BOW;
      reverse.bow = -BOW;
    }
  }

  return { nodes, edges };
}
