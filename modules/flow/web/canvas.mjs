import { $, clamp, esc, uid } from "../../../app/js/core/dom.mjs";
import { EVENTS } from "../../../app/js/core/events.mjs";
import { t } from "../../../app/js/core/i18n.mjs";
import { toast } from "../../../app/js/core/toast.mjs";
import { confirmDialog } from "../../../app/js/ui/index.mjs";
import { NODE_H, NODE_W } from "./state.mjs";
import { nodeMarkup } from "./node-view.mjs";

const EDGE_PADDING = 2000;
const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
const EDGE_OFFSET = 14;

export function createCanvas(context) {
  const nodeLayer = $("#nodeLayer");
  nodeLayer?.style.setProperty("--node-w", `${NODE_W}px`);
  nodeLayer?.style.setProperty("--node-h", `${NODE_H}px`);

  let connectDrag = null;
  let panDrag = null;
  const view = { x: 0, y: 0, scale: 1 };
  let edgeOffset = { x: 0, y: 0 };
  let mapTimer = null;

function setMapMoving(on) {
  if (on) {
    clearTimeout(mapTimer);
    mapTimer = null;
  }
  $("#canvasWrap").classList.toggle("is-moving", on);
}

function stopMap() {
  clearTimeout(mapTimer);
  mapTimer = null;
  setMapMoving(false);
}

/** 滚轮是一串连续事件，最后一次停下后立即收起。 */
function flashMap() {
  setMapMoving(true);
  clearTimeout(mapTimer);
  mapTimer = setTimeout(stopMap, 120);
}

function applyView() {
  $("#canvas").style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  // 点阵固定在屏幕空间：缩放时只移动画布内容，背景密度保持不变。
  $("#canvasWrap").style.backgroundPosition = `${view.x}px ${view.y}px`;
  context.shell?.setZoom(view.scale);
  context.minimap?.render(view);
}

function toWorld(clientX, clientY) {
  const rect = $("#canvasWrap").getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.x) / view.scale,
    y: (clientY - rect.top - view.y) / view.scale,
  };
}

function nodeCenter(node) {
  return { x: node.x + NODE_W / 2, y: node.y + NODE_H / 2 };
}

function sideNormal(side) {
  if (side === "right") return { x: 1, y: 0 };
  if (side === "left") return { x: -1, y: 0 };
  if (side === "top") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function sideTangent(side) {
  return side === "left" || side === "right" ? { x: 0, y: 1 } : { x: 1, y: 0 };
}

/** 从节点中心朝目标方向发出的射线与节点矩形边界的交点。 */
function boundaryAnchor(node, towards) {
  const center = nodeCenter(node);
  let dx = towards.x - center.x;
  let dy = towards.y - center.y;
  if (!dx && !dy) dx = NODE_W;
  const tx = dx ? NODE_W / 2 / Math.abs(dx) : Infinity;
  const ty = dy ? NODE_H / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  const side = tx <= ty ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
  return {
    center,
    side,
    point: { x: center.x + dx * t, y: center.y + dy * t },
  };
}

function shiftAnchor(node, anchor, offset) {
  if (!offset) return anchor.point;
  const tangent = sideTangent(anchor.side);
  const point = {
    x: anchor.point.x + tangent.x * offset,
    y: anchor.point.y + tangent.y * offset,
  };
  if (anchor.side === "left" || anchor.side === "right") {
    point.y = clamp(point.y, node.y + 10, node.y + NODE_H - 10);
  } else {
    point.x = clamp(point.x, node.x + 10, node.x + NODE_W - 10);
  }
  return point;
}

/** 两端都贴在节点边界上的三次贝塞尔，控制点沿所在边的法线向外。 */
function buildCurve(from, to, offset = 0) {
  const fromAnchor = boundaryAnchor(from, nodeCenter(to));
  const toAnchor = boundaryAnchor(to, nodeCenter(from));
  const start = shiftAnchor(from, fromAnchor, offset);
  const end = shiftAnchor(to, toAnchor, offset);
  const distance = Math.hypot(nodeCenter(to).x - nodeCenter(from).x, nodeCenter(to).y - nodeCenter(from).y);
  const pull = Math.max(50, Math.min(140, distance * 0.3));
  const n1 = sideNormal(fromAnchor.side);
  const n2 = sideNormal(toAnchor.side);
  return {
    start,
    c1: { x: start.x + n1.x * pull, y: start.y + n1.y * pull },
    c2: { x: end.x + n2.x * pull, y: end.y + n2.y * pull },
    end,
  };
}

function curvePath({ start, c1, c2, end }) {
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

function curveMid({ start, c1, c2, end }) {
  return {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
  };
}

function renderNodes() {
  const layer = $("#nodeLayer");
  layer.innerHTML = context.model.flow.nodes
    .map((node) => {
      const agent = context.agents.get(node?.agentId);
      const selected = context.model.ui.selection?.type === "node" && context.model.ui.selection.id === node.id;
      const inCount = context.model.flow.edges.reduce(
        (count, edge) => (edge.to === node.id ? count + (edge.files?.length || 0) : count),
        0,
      );
      const outCount = node.artifacts?.length || 0;
      return nodeMarkup({ node, agent, selected, inCount, outCount });
    })
    .join("");

  $("#emptyHint").style.display = context.model.flow.nodes.length ? "none" : "grid";
}

function edgeBounds() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of context.model.flow.nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + NODE_W);
    maxY = Math.max(maxY, node.y + NODE_H);
  }
  if (!Number.isFinite(minX)) {
    return { x: -EDGE_PADDING, y: -EDGE_PADDING, w: EDGE_PADDING * 2, h: EDGE_PADDING * 2 };
  }
  return {
    x: minX - EDGE_PADDING,
    y: minY - EDGE_PADDING,
    w: maxX - minX + EDGE_PADDING * 2,
    h: maxY - minY + EDGE_PADDING * 2,
  };
}

function renderEdges() {
  const layer = $("#edgeLayer");
  const bounds = edgeBounds();
  edgeOffset = { x: bounds.x, y: bounds.y };
  for (const el of [layer, $("#tempLayer")]) {
    el.style.left = `${bounds.x}px`;
    el.style.top = `${bounds.y}px`;
    el.style.width = `${bounds.w}px`;
    el.style.height = `${bounds.h}px`;
  }
  const defs = `
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#8F8261"></path>
      </marker>
      <marker id="arrowActive" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#C05A2E"></path>
      </marker>
    </defs>`;

  layer.innerHTML =
    defs +
    context.model.flow.edges
      .map((edge) => {
        const from = context.model.nodeOf(edge.from);
        const to = context.model.nodeOf(edge.to);
        if (!from || !to) return "";

        // 互为反向的两条边要错开，避免完全重叠。
        const reciprocal = context.model.flow.edges.some(
          (other) => other.id !== edge.id && other.from === edge.to && other.to === edge.from,
        );
        const offset = reciprocal ? (edge.from < edge.to ? EDGE_OFFSET : -EDGE_OFFSET) : 0;

        const curve = buildCurve(from, to, offset);
        const local = {
          start: { x: curve.start.x - bounds.x, y: curve.start.y - bounds.y },
          c1: { x: curve.c1.x - bounds.x, y: curve.c1.y - bounds.y },
          c2: { x: curve.c2.x - bounds.x, y: curve.c2.y - bounds.y },
          end: { x: curve.end.x - bounds.x, y: curve.end.y - bounds.y },
        };
        const d = curvePath(local);
        const mid = curveMid(local);
        const active = context.model.ui.selection?.type === "edge" && context.model.ui.selection.id === edge.id;
        const count = edge.files?.length || 0;
        const hint = count
          ? t("已选 {n} 个文件 · 节点之间用文件的形式传话", { n: count })
          : t("未选择文件 · 节点之间用文件的形式传话");
        return `
          <g class="edge ${active ? "selected" : ""} ${count ? "" : "no-files"}" data-edge-id="${esc(edge.id)}">
            <title>${esc(hint)}</title>
            <path class="edge-hit" d="${d}"></path>
            <path class="edge-line" d="${d}" marker-end="url(#${active ? "arrowActive" : "arrow"})"></path>
            ${count ? `<text class="edge-count" x="${mid.x}" y="${mid.y}" dominant-baseline="central">${count}</text>` : ""}
          </g>`;
      })
      .join("");
}

function selectNode(id) {
  context.model.ui.selection = { type: "node", id };
  context.render();
}

function selectEdge(id) {
  context.model.ui.selection = { type: "edge", id };
  context.render();
}

function clearSelection() {
  if (!context.model.ui.selection) return;
  context.model.ui.selection = null;
  context.render();
}

function addNodeFromAgent(agentId, x, y) {
  const agent = context.agents.get(agentId);
  if (!agent) return;
  const node = {
    id: uid("node"),
    agentId: agent.id,
    title: agent.name,
    x,
    y,
    task: "",
    color: Math.floor(Math.random() * 360),
    handoffEnabled: true,
    sessionMode: "new",
    sessionId: null,
    lastSessionId: null,
    status: "idle",
    artifacts: [],
    logs: [],
    lastRunId: null,
  };
  context.model.flow.nodes.push(node);
  context.model.ui.selection = { type: "node", id: node.id };
  context.render();
  context.scheduleSave();
  toast(t("已添加「{name}」节点", { name: agent.name }));
}

async function confirmDeleteNode(nodeId) {
  const node = context.model.nodeOf(nodeId);
  if (!node) return;
  const confirmed = await confirmDialog({
    title: t("删除节点"),
    message: t("确定删除「{name}」吗？", { name: node.title }),
    detail: t("节点上的任务和连线会一起删除。"),
    confirmText: t("删除"),
    danger: true,
  });
  if (confirmed) deleteNode(nodeId);
}

function deleteNode(nodeId) {
  context.model.flow.nodes = context.model.flow.nodes.filter((node) => node.id !== nodeId);
  context.model.flow.edges = context.model.flow.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  context.model.ui.selection = null;
  context.render();
  context.scheduleSave();
}

function deleteEdge(edgeId) {
  context.model.flow.edges = context.model.flow.edges.filter((edge) => edge.id !== edgeId);
  context.model.ui.selection = null;
  context.render();
  context.scheduleSave();
}

function connect(from, to) {
  if (from === to) return toast(t("不能连接到自身"), true);
  if (context.model.flow.edges.some((edge) => edge.from === from && edge.to === to)) {
    return toast(t("这条连线已存在"), true);
  }

  const edge = { id: uid("edge"), from, to, files: [] };
  context.model.flow.edges.push(edge);
  selectEdge(edge.id);
  context.scheduleSave();
  toast(t("连线已创建，运行上游后在这里选择文件"));
}

function tempCurve(node, cursor) {
  const anchor = boundaryAnchor(node, cursor);
  const normal = sideNormal(anchor.side);
  const distance = Math.hypot(cursor.x - anchor.center.x, cursor.y - anchor.center.y);
  const pull = Math.max(50, Math.min(140, distance * 0.3));
  const dx = distance ? (cursor.x - anchor.center.x) / distance : 1;
  const dy = distance ? (cursor.y - anchor.center.y) / distance : 0;
  return {
    start: anchor.point,
    c1: { x: anchor.point.x + normal.x * pull, y: anchor.point.y + normal.y * pull },
    c2: { x: cursor.x - dx * pull, y: cursor.y - dy * pull },
    end: cursor,
  };
}

function paintTempEdge(node, cursor) {
  const curve = tempCurve(node, cursor);
  const local = {
    start: { x: curve.start.x - edgeOffset.x, y: curve.start.y - edgeOffset.y },
    c1: { x: curve.c1.x - edgeOffset.x, y: curve.c1.y - edgeOffset.y },
    c2: { x: curve.c2.x - edgeOffset.x, y: curve.c2.y - edgeOffset.y },
    end: { x: curve.end.x - edgeOffset.x, y: curve.end.y - edgeOffset.y },
  };
  const path = $("#tempLayer .temp-edge");
  if (path) path.setAttribute("d", curvePath(local));
}

function startConnect(node, event) {
  connectDrag = { from: node.id };
  $("#tempLayer").innerHTML = `<path class="temp-edge" d=""></path>`;
  paintTempEdge(node, toWorld(event.clientX, event.clientY));
  event.preventDefault();
}

function updateTempEdge(clientX, clientY) {
  if (!connectDrag) return;
  const node = context.model.nodeOf(connectDrag.from);
  if (!node) return;
  paintTempEdge(node, toWorld(clientX, clientY));
}

function bindCanvas() {
  const canvasWrap = $("#canvasWrap");
  applyView();

  // 空白处按住拖动 = 平移画布；没拖动则视为点击空白取消选中。
  canvasWrap.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest(".node") || event.target.closest(".edge") || event.target.closest(".canvas-quick-plate")) return;
    event.preventDefault();

    panDrag = {
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
    };
    canvasWrap.classList.add("panning");

    const onMove = (moveEvent) => {
      if (!panDrag) return;
      const dx = moveEvent.clientX - panDrag.startX;
      const dy = moveEvent.clientY - panDrag.startY;
      if (!panDrag.moved && Math.abs(dx) + Math.abs(dy) > 3) {
        panDrag.moved = true;
        setMapMoving(true);
      }
      view.x = panDrag.originX + dx;
      view.y = panDrag.originY + dy;
      applyView();
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      canvasWrap.classList.remove("panning");
      stopMap();
      const clicked = panDrag && !panDrag.moved;
      panDrag = null;
      if (clicked) clearSelection();
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  });

  canvasWrap.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const delta = event.deltaY * unit;
      if (!delta) return;

      const factor = Math.exp(-delta * 0.0015);
      const next = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
      if (next === view.scale) return;

      // 以鼠标所在位置为锚点缩放，画布上的点保持不动。
      const rect = canvasWrap.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const ratio = next / view.scale;
      view.x = px - (px - view.x) * ratio;
      view.y = py - (py - view.y) * ratio;
      view.scale = next;
      applyView();
      flashMap();
    },
    { passive: false },
  );

  canvasWrap.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  canvasWrap.addEventListener("drop", (event) => {
    event.preventDefault();
    const agentId =
      event.dataTransfer.getData("application/x-agent-id") || event.dataTransfer.getData("text/plain");
    if (!agentId) return;
    const world = toWorld(event.clientX, event.clientY);
    addNodeFromAgent(agentId, world.x - NODE_W / 2, world.y - 30);
  });

  $("#nodeLayer").addEventListener("click", (event) => {
    const runButton = event.target.closest("[data-run]");
    if (runButton) {
      event.stopPropagation();
      const node = context.model.nodeOf(runButton.dataset.run);
      if (node) context.events.emit(EVENTS.RUN_REQUEST, { nodeId: node.id });
      return;
    }
    const nodeEl = event.target.closest(".node");
    if (nodeEl) {
      event.stopPropagation();
      selectNode(nodeEl.dataset.nodeId);
    }
  });

  $("#nodeLayer").addEventListener("pointerdown", (event) => {
    const nodeEl = event.target.closest(".node");
    if (!nodeEl) return;
    if (event.target.closest("[data-run]")) return;
    const node = context.model.nodeOf(nodeEl.dataset.nodeId);
    if (!node) return;

    if (event.altKey) {
      event.preventDefault();
      startConnect(node, event);
      return;
    }

    if (!event.target.closest(".node-header")) {
      selectNode(node.id);
      return;
    }

    event.preventDefault();
    selectNode(node.id);

    // 选中会触发全量重绘，旧元素已失效，重新取一次再挂拖动。
    const dragEl = document.querySelector(`.node[data-node-id="${node.id}"]`);
    if (!dragEl) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const originX = node.x;
    const originY = node.y;
    let moved = false;

    const onMove = (moveEvent) => {
      const rawX = moveEvent.clientX - startX;
      const rawY = moveEvent.clientY - startY;
      if (Math.abs(rawX) + Math.abs(rawY) > 3) moved = true;
      const dx = rawX / view.scale;
      const dy = rawY / view.scale;
      node.x = originX + dx;
      node.y = originY + dy;
      dragEl.style.left = `${node.x}px`;
      dragEl.style.top = `${node.y}px`;
      renderEdges();
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (moved) context.scheduleSave();
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  $("#edgeLayer").addEventListener("click", (event) => {
    const edgeEl = event.target.closest("[data-edge-id]");
    if (!edgeEl) return;
    event.stopPropagation();
    selectEdge(edgeEl.dataset.edgeId);
  });

  document.addEventListener("pointermove", (event) => {
    if (connectDrag) updateTempEdge(event.clientX, event.clientY);
  });

  document.addEventListener("pointerup", (event) => {
    if (!connectDrag) return;
    const targetEl = document.elementFromPoint(event.clientX, event.clientY);
    const targetNode = targetEl?.closest(".node");
    if (targetNode && targetNode.dataset.nodeId !== connectDrag.from) {
      connect(connectDrag.from, targetNode.dataset.nodeId);
    }
    connectDrag = null;
    $("#tempLayer").innerHTML = "";
  });

  document.addEventListener("keydown", (event) => {
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (!context.model.ui.selection) return;
    if (document.querySelector(".ui-modal-backdrop:not(.hidden)")) return;

    const selection = context.model.ui.selection;
    if (selection.type === "node") confirmDeleteNode(selection.id);
    if (selection.type === "edge") deleteEdge(selection.id);
  });
}

return {
  renderNodes,
  renderEdges,
  getView: () => view,
  selectNode,
  selectEdge,
  addNodeFromAgent,
  deleteNode,
  deleteEdge,
  bind: bindCanvas,
};
}
