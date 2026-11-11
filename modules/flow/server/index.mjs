import { t } from "../../../app/js/core/i18n.mjs";

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
      if (node.status !== "running") continue;
      node.status = "error";
      node.logs ||= [];
      node.logs.push(t("应用重启，上次运行已中断"));
      recovered = true;
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
    flow.nodes = Array.isArray(body.nodes) ? body.nodes : [];
    flow.edges = Array.isArray(body.edges) ? body.edges : [];
    flow.updatedAt = now();
    return flow;
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
    api: { list, get, create, save, remove },
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
