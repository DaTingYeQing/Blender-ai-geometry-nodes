import { t } from "../../../app/js/core/i18n.mjs";

export const NODE_W = 236;
export const NODE_H = 95;

export function nodeHue(node) {
  if (Number.isFinite(node?.color)) return ((node.color % 360) + 360) % 360;
  // 旧节点没有 color：用 id 算一个稳定的色相，保证同一节点刷新后颜色不变。
  let hash = 0;
  for (const char of String(node?.id || "")) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

export function createFlowState(initialFlow) {
  let flow = initialFlow || { id: null, nodes: [], edges: [] };
  const ui = { selection: null };
  normalize(flow);

  function normalize(target) {
    target.nodes ||= [];
    target.edges ||= [];
    for (const node of target.nodes) {
      node.artifacts ||= [];
      node.logs ||= [];
      node.sessionMode ||= "new";
      node.status ||= "idle";
      if (node.handoffEnabled === undefined) node.handoffEnabled = true;
    }
    for (const edge of target.edges) edge.files ||= [];
  }

  function setFlow(next) {
    flow = next || { id: null, nodes: [], edges: [] };
    normalize(flow);
    ui.selection = null;
  }

  function nodeOf(id) {
    return flow.nodes.find((node) => node.id === id);
  }

  function edgeOf(id) {
    return flow.edges.find((edge) => edge.id === id);
  }

  function collectInputs(node) {
    const seen = new Set();
    const files = [];
    for (const edge of flow.edges.filter((item) => item.to === node.id)) {
      for (const file of edge.files || []) {
        if (!file?.path || seen.has(file.path)) continue;
        seen.add(file.path);
        files.push(file);
      }
    }
    return files;
  }

  function pruneEdges(node) {
    const latest = new Map((node.artifacts || []).map((file) => [file.name, file]));
    for (const edge of flow.edges.filter((item) => item.from === node.id)) {
      const mapped = [];
      const seen = new Set();
      for (const file of edge.files || []) {
        const next = latest.get(file.name);
        if (!next || seen.has(next.name)) continue;
        seen.add(next.name);
        mapped.push({ name: next.name, path: next.path, size: next.size });
      }
      edge.files = mapped;
    }
  }

  return { get flow() { return flow; }, ui, nodeOf, edgeOf, collectInputs, pruneEdges, setFlow };
}

export function statusLabel(status) {
  return t({ idle: "未运行", running: "运行中", done: "已完成", error: "失败" }[status || "idle"] || "未运行");
}
