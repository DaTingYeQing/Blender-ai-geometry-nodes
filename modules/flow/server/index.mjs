import { t } from "../../../shared/messages.mjs";

/** 流程节点上只清掉纯运行日志类字段；文件已经改为各自工作区，流程不再记运行索引。 */
const LEGACY_NODE_FIELDS = ["status", "logs", "artifacts", "lastSessionId", "lastRunId"];

function stripLegacyNodeFields(node) {
  if (!node || typeof node !== "object") return false;
  let changed = false;
  for (const key of LEGACY_NODE_FIELDS) {
    if (!Object.hasOwn(node, key)) continue;
    delete node[key];
    changed = true;
  }
  return changed;
}

export function createFlowServer({ store, onDelete }) {
  const { ApiError, db, now, rid, saveState } = store;
  let recovered = false;

  if (!Array.isArray(db.state.flows)) db.state.flows = [];
  if (db.state.flow) {
    const legacy = db.state.flow;
    db.state.flows.push({
      id: legacy.id || "default",
      name: t("默认流程"),
      nodes: Array.isArray(legacy.nodes) ? legacy.nodes : [],
      edges: Array.isArray(legacy.edges) ? legacy.edges : [],
      createdAt: now(),
      updatedAt: now(),
    });
    delete db.state.flow;
    recovered = true;
  }

  for (const flow of db.state.flows) {
    flow.nodes ||= [];
    flow.edges ||= [];
    for (const node of flow.nodes) {
      if (stripLegacyNodeFields(node)) recovered = true;
    }
  }

  function list() {
    return db.state.flows.map((flow) => ({
      id: flow.id,
      name: flow.name || t("未命名流程"),
      nodeCount: flow.nodes.length,
      edgeCount: flow.edges.length,
      updatedAt: flow.updatedAt || null,
    }));
  }

  function get(id) {
    return db.state.flows.find((flow) => flow.id === id) || null;
  }

  function create(body) {
    const name = String(body?.name || "").trim();
    const flow = {
      id: rid("flow"),
      name: name || t("流程 {n}", { n: db.state.flows.length + 1 }),
      nodes: [],
      edges: [],
      createdAt: now(),
      updatedAt: now(),
    };
    db.state.flows.push(flow);
    return flow;
  }

  function save(id, body) {
    const flow = get(id);
    if (!flow) throw new ApiError(404, t("流程不存在"));
    /* 整份保存：名字可以不传，传了就更新（重命名和画布保存共用一个端点）。 */
    const name = String(body?.name ?? "").trim();
    if (name) flow.name = name;
    flow.nodes = (Array.isArray(body.nodes) ? body.nodes : []).map((node) => {
      stripLegacyNodeFields(node);
      return node;
    });
    /* 线只保留两端都还在的节点：节点没了，线不能连在一个不存在的地方。 */
    const nodeIds = new Set(flow.nodes.map((node) => node.id));
    flow.edges = (Array.isArray(body.edges) ? body.edges : [])
      .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
    flow.updatedAt = now();
    return flow;
  }

  /* 用户删掉某个 Agent 后，它在所有流程里的节点都该一起消失：
   * 先删该 Agent 名下的节点，再删两端不全的连线。只按传进来的 agentId 清，
   * 不按"当前 Agent 列表"反推 —— 项目目录临时不可用时 Agent 只是没注册，
   * 流程里的节点不能因此被永久删掉。
   * 返回是否真的改过，调用方据此决定要不要落盘。 */
  function prune(agentId) {
    let changed = false;
    for (const flow of db.state.flows) {
      let flowChanged = false;
      const nodes = flow.nodes.filter((node) => node.agentId !== agentId);
      if (nodes.length !== flow.nodes.length) {
        flow.nodes = nodes;
        flowChanged = true;
      }
      const nodeIds = new Set(nodes.map((node) => node.id));
      const edges = flow.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
      if (edges.length !== flow.edges.length) {
        flow.edges = edges;
        flowChanged = true;
      }
      if (flowChanged) {
        flow.updatedAt = now();
        changed = true;
      }
    }
    return changed;
  }

  async function remove(id) {
    const flow = get(id);
    if (!flow) throw new ApiError(404, t("流程不存在"));
    if (onDelete) await onDelete(flow.id);
    db.state.flows = db.state.flows.filter((item) => item.id !== id);
    return flow;
  }

  return {
    recovered,
    api: { list, get, create, save, remove, prune },
    routes: [
      {
        method: "GET",
        path: "/api/flows",
        handler: () => ({ flows: list() }),
      },
      {
        method: "POST",
        path: "/api/flows",
        handler: async ({ body }) => {
          const flow = create(body);
          await saveState();
          return { flow };
        },
      },
      {
        method: "POST",
        path: "/api/flows/prune",
        handler: async ({ body }) => {
          const agentId = String(body?.agentId || "").trim();
          if (!agentId) throw new ApiError(400, t("缺少 Agent"));
          const changed = prune(agentId);
          if (changed) await saveState();
          return { ok: true, changed };
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/flows\/([^/]+)$/,
        handler: ({ params }) => {
          const flow = get(params[1]);
          if (!flow) throw new ApiError(404, t("流程不存在"));
          return { flow };
        },
      },
      {
        method: "PUT",
        pattern: /^\/api\/flows\/([^/]+)$/,
        handler: async ({ params, body }) => {
          save(params[1], body);
          await saveState();
          return { ok: true };
        },
      },
      {
        method: "DELETE",
        pattern: /^\/api\/flows\/([^/]+)$/,
        handler: async ({ params }) => {
          await remove(params[1]);
          await saveState();
          return { ok: true };
        },
      },
    ],
  };
}
