/* ===== 效果：画布对象规则（新建、字段编辑、移动/删除、连线）=====
 * 4.3：画布只做“意图 → 规则 → 结果”，规则从旧 `business/canvas.js` 搬到这里。
 * 节点/连线的字段编辑（任务、上游产物、会话模式、连线文件）也在这里归一，
 * 组装根控制器只负责提交与落盘。
 *
 * 与其它 Effects 的差别：画布事实在 ui/state/canvas 切片，本地编辑没有后端请求，
 * 所以这里不产事件，而是返回一份可直接落地的“计划”，由组装根的画布控制器
 * 用 canvas.patched 写回切片并打未保存标记。
 *
 * 纪律：不读全局状态、不碰 DOM、不 import js/；节点/连线快照与 id 生成都靠注入。
 * 反向成对的两条线各弯 40 像素，与 `ui/state/canvas/codec.js` 的载入规则一致。
 */

/** 反向成对的两条线各弯开多少（世界像素）。 */
export const EDGE_BOW = 40;

function stringId(value) {
  return typeof value === 'string' && value ? value : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 移动命令的字段归一：id 必须非空，坐标必须是有限数字。
 * @param {{ nodeId?: unknown, x?: unknown, y?: unknown }} payload
 * @returns {{ nodeId: string, x: number, y: number } | null}
 */
export function normalizeNodeMove(payload) {
  const nodeId = stringId(payload?.nodeId);
  const x = finiteNumber(payload?.x);
  const y = finiteNumber(payload?.y);
  return nodeId && x !== null && y !== null ? { nodeId, x, y } : null;
}

/**
 * 删节点后聚焦该不该收起：删掉的正是打开的那个节点，或这个团队已经没有节点了。
 * 只认删完之后的节点列表，规则与原业务一致。
 * @param {{ teamId?: string|null, nodeId?: string|null, edgeId?: string|null, pane?: string } | null} focus
 * @param {Array<{ id: string, agentId?: string }>} remainingNodes
 * @returns {typeof focus}
 */
export function nextFocusAfterRemoval(focus, remainingNodes) {
  if (!focus?.teamId) return focus;
  const nodes = listOf(remainingNodes);
  const ownedGone = focus.nodeId ? !nodes.some((node) => node.id === focus.nodeId) : false;
  const teamGone = !nodes.some((node) => node.agentId === focus.teamId);
  if (!ownedGone && !teamGone) return focus;
  return { teamId: null, nodeId: null, edgeId: null, pane: 'default' };
}

/**
 * 连线创建规则：
 *   - 同方向唯一（1→2 只有一条，2→1 是另一条）；
 *   - 两端节点必须存在；
 *   - 同一团队的节点之间不连线；
 *   - 已经有反向那条时，两条各弯向一侧，不叠在一起。
 *
 * @param {{
 *   from: string, to: string,
 *   nodes: Array<{ id: string, agentId?: string }>,
 *   edges: Array<{ id: string, from: string, to: string }>,
 *   teams: Array<{ id: string, color?: string }>,
 *   edgeId: string,
 * }} input
 * @returns {{ ok: true, duplicate: boolean, edge: any, bows: Array<{ edgeId: string, bow: number }> }
 *   | { ok: false, error: string }}
 */
export function planEdgeCreate({ from, to, nodes, edges, teams, edgeId }) {
  const sourceId = stringId(from);
  const targetId = stringId(to);
  if (!sourceId || !targetId) return { ok: false, error: '节点不存在' };

  const edgeList = listOf(edges);
  const duplicate = edgeList.some((edge) => edge.from === sourceId && edge.to === targetId);
  if (duplicate) return { ok: true, duplicate: true, edge: null, bows: [] };

  const nodeList = listOf(nodes);
  const source = nodeList.find((node) => node.id === sourceId);
  const target = nodeList.find((node) => node.id === targetId);
  if (!source || !target) return { ok: false, error: '节点不存在' };
  if (source.agentId === target.agentId) return { ok: false, error: '同一个团队之间不能相互连接' };

  const team = listOf(teams).find((item) => item.id === source.agentId);
  if (!team) return { ok: false, error: '起点节点不存在' };

  const edge = {
    id: stringId(edgeId) || `e-${edgeList.length + 1}`,
    from: sourceId,
    to: targetId,
    color: typeof team.color === 'string' && team.color ? team.color : '#71717a',
    bow: 0,
    files: [],
  };

  const reverse = edgeList.find((item) => item.from === targetId && item.to === sourceId);
  const bows = reverse
    ? [{ edgeId: reverse.id, bow: -EDGE_BOW }]
    : [];
  edge.bow = reverse ? EDGE_BOW : 0;

  return { ok: true, duplicate: false, edge, bows };
}


/**
 * 新建节点的默认形状：运行态字段一律初始化，id 由组装根注入。
 * @param {{ agentId?: unknown, x?: unknown, y?: unknown, nodeId?: string }} input
 * @returns {{ ok: true, data: any } | { ok: false, error: string }}
 */
export function planNodeCreate({ agentId, x, y, nodeId } = {}) {
  const teamId = stringId(agentId);
  const left = finiteNumber(x);
  const top = finiteNumber(y);
  if (!teamId) return { ok: false, error: '团队不存在' };
  if (left === null || top === null) return { ok: false, error: '坐标不合法' };
  return {
    ok: true,
    data: {
      id: stringId(nodeId) || `n-${teamId}`,
      agentId: teamId,
      x: left,
      y: top,
      task: '',
      handoffEnabled: true,
      sessionMode: 'new',
      sessionId: null,
      alert: false,
      running: false,
      runId: null,
      artifacts: [],
      artifactsLoaded: false,
    },
  };
}

/** 节点任务：任务属于节点，不属于团队；空值归一成空串。 */
export function planNodeTask({ nodeId, task, nodes } = {}) {
  const id = stringId(nodeId);
  if (!id) return { ok: false, error: '节点不存在' };
  if (!listOf(nodes).some((node) => node.id === id)) return { ok: false, error: '节点不存在' };
  return { ok: true, data: { nodeId: id, task: String(task ?? '') } };
}

/** 上游产物开关：只有显式 false 才关，缺省按开处理。 */
export function planNodeHandoff({ nodeId, handoffEnabled, nodes } = {}) {
  const id = stringId(nodeId);
  if (!id) return { ok: false, error: '节点不存在' };
  if (!listOf(nodes).some((node) => node.id === id)) return { ok: false, error: '节点不存在' };
  return { ok: true, data: { nodeId: id, handoffEnabled: handoffEnabled !== false } };
}

/** 会话模式：只认 'reuse' / 'new'。 */
export function planNodeSessionMode({ nodeId, sessionMode, nodes } = {}) {
  const id = stringId(nodeId);
  if (!id) return { ok: false, error: '节点不存在' };
  if (!listOf(nodes).some((node) => node.id === id)) return { ok: false, error: '节点不存在' };
  return {
    ok: true,
    data: { nodeId: id, sessionMode: sessionMode === 'reuse' ? 'reuse' : 'new' },
  };
}

/** 复用哪一段对话：空值归 null，其余原样记下。 */
export function planNodeSessionId({ nodeId, sessionId, nodes } = {}) {
  const id = stringId(nodeId);
  if (!id) return { ok: false, error: '节点不存在' };
  if (!listOf(nodes).some((node) => node.id === id)) return { ok: false, error: '节点不存在' };
  return { ok: true, data: { nodeId: id, sessionId: sessionId || null } };
}

/**
 * 连线传哪些产物：文件属于线而不是节点；返回下游节点 id 供组装根触发运行。
 * @param {{ edgeId?: unknown, files?: unknown, edges?: Array<any>, nodes?: Array<any> }} input
 */
export function planEdgeFiles({ edgeId, files, edges, nodes } = {}) {
  const id = stringId(edgeId);
  if (!id) return { ok: false, error: '连线不存在' };
  const edge = listOf(edges).find((item) => item.id === id);
  if (!edge) return { ok: false, error: '连线不存在' };
  const target = listOf(nodes).find((item) => item.id === edge.to);
  return {
    ok: true,
    data: {
      edgeId: id,
      files: Array.isArray(files) ? files : [],
      targetNodeId: target ? target.id : null,
    },
  };
}

/**
 * @param {{ makeEdgeId?: () => string, makeNodeId?: () => string }} [options]
 *   makeEdgeId 由组装根注入（时间戳 + 自增，避免刷新后与后端已有 id 撞车）。
 */
export function createCanvasEffects({ makeEdgeId = () => null, makeNodeId = () => null } = {}) {
  const newEdgeId = typeof makeEdgeId === 'function' ? makeEdgeId : () => null;
  const newNodeId = typeof makeNodeId === 'function' ? makeNodeId : () => null;

  return {
    /** 新建节点：形状归一，id 由组装根生成。 */
    createNode({ agentId, x, y } = {}) {
      return planNodeCreate({ agentId, x, y, nodeId: newNodeId() });
    },

    setTask({ nodeId, task, nodes } = {}) {
      return planNodeTask({ nodeId, task, nodes });
    },

    setHandoff({ nodeId, handoffEnabled, nodes } = {}) {
      return planNodeHandoff({ nodeId, handoffEnabled, nodes });
    },

    setSessionMode({ nodeId, sessionMode, nodes } = {}) {
      return planNodeSessionMode({ nodeId, sessionMode, nodes });
    },

    setSessionId({ nodeId, sessionId, nodes } = {}) {
      return planNodeSessionId({ nodeId, sessionId, nodes });
    },

    setEdgeFiles({ edgeId, files, edges, nodes } = {}) {
      return planEdgeFiles({ edgeId, files, edges, nodes });
    },

    /** 节点落位：坐标归一，节点不存在则不动。 */
    moveNode({ nodeId, x, y, nodes } = {}) {
      const move = normalizeNodeMove({ nodeId, x, y });
      if (!move) return { ok: false, error: '坐标不合法' };
      if (!listOf(nodes).some((node) => node.id === move.nodeId)) {
        return { ok: false, error: '节点不存在' };
      }
      return { ok: true, data: move };
    },

    /** 删节点：连带删线，并按规则决定要不要收起聚焦。 */
    removeNode({ nodeId, nodes, edges, focus } = {}) {
      const id = stringId(nodeId);
      if (!id) return { ok: false, error: '节点不存在' };

      const remaining = listOf(nodes).filter((node) => node.id !== id);
      const removedEdgeIds = listOf(edges)
        .filter((edge) => edge.from === id || edge.to === id)
        .map((edge) => edge.id);

      return {
        ok: true,
        data: {
          nodeId: id,
          nodeIds: remaining.map((node) => node.id),
          removedEdgeIds,
          focus: nextFocusAfterRemoval(focus, remaining),
          existed: remaining.length !== listOf(nodes).length,
        },
      };
    },

    /** 清提醒：只改一个布尔，不落盘（与原业务一致）。 */
    clearAlert({ nodeId, nodes } = {}) {
      const id = stringId(nodeId);
      if (!id) return { ok: false, error: '节点不存在' };
      if (!listOf(nodes).some((node) => node.id === id)) {
        return { ok: false, error: '节点不存在' };
      }
      return { ok: true, data: { nodeId: id, alert: false } };
    },

    /** 拉线：规则见 planEdgeCreate。 */
    createEdge({ from, to, nodes, edges, teams } = {}) {
      return planEdgeCreate({
        from,
        to,
        nodes,
        edges,
        teams,
        edgeId: newEdgeId(),
      });
    },
  };
}
