import { $ } from "../../../app/js/core/dom.mjs";
import { EVENTS } from "../../../app/js/core/events.mjs";
import { t } from "../../../app/js/core/i18n.mjs";
import { loadStyle } from "../../../app/js/core/style.mjs";
import { toast } from "../../../app/js/core/toast.mjs";
import { bindModal, bindSegmented, confirmDialog, createThumbTracker } from "../../../app/js/ui/index.mjs";
import { createCanvas } from "./canvas.mjs";
import { createInspector } from "./inspector.mjs";
import { createMinimap } from "./minimap.mjs";
import { createFlowState } from "./state.mjs";
import { createTranscript } from "./transcript.mjs";
import { canvasDecorMarkup, flowListMarkup, flowModalMarkup } from "./views.mjs";
import { createWorkspaceModal } from "./workspace.mjs";

export function mountFlow({ events, request, agents, artifacts, shell, initialFlows }) {
  loadStyle("/modules/flow/web/canvas.css");
  loadStyle("/modules/flow/web/inspector.css");
  loadStyle("/modules/flow/web/transcript.css");
  loadStyle("/modules/flow/web/flows.css");

  $("#canvasWrap").innerHTML = `
    <div id="canvas" class="canvas">
      <svg id="edgeLayer" class="edge-layer"></svg>
      <svg id="tempLayer" class="temp-layer"></svg>
      <div id="nodeLayer" class="node-layer"></div>
    </div>
    ${canvasDecorMarkup()}
    <div id="emptyHint" class="empty-hint">
      <div class="empty-title">${t("把左侧 Agent 拖到这里")}</div>
      <div class="empty-sub">${t("按住 Alt 从节点拖到另一个节点，建立连线")}</div>
    </div>`;

  const quickAdd = $("#quickAddAgentBtn");
  quickAdd?.addEventListener("pointerdown", (event) => event.stopPropagation());
  quickAdd?.addEventListener("click", () => openFlowModal());

  const quickSecondary = $("#quickSecondaryBtn");
  quickSecondary?.addEventListener("pointerdown", (event) => event.stopPropagation());

  document.body.insertAdjacentHTML("beforeend", flowModalMarkup());

  const model = createFlowState(null);
  let flows = Array.isArray(initialFlows) ? initialFlows : [];
  let saveTimer = null;
  let mode = "team";
  let selectedFlowId = null;
  let flowTouched = false;
  let modeControl = null;
  let flowTracker = null;

  modeControl = bindSegmented($("#modeSwitch .ui-segmented"), {
    value: "team",
    onChange: (next) => setMode(next),
  });

  const flowModal = bindModal($("#flowModal"), {
    canDismiss: () => Boolean(model.flow.id) || mode === "single",
    initialFocus: "#modeSwitch .ui-seg.is-active",
  });

  const workspace = createWorkspaceModal({
    agents,
    openWorkspace: async (agentId) => {
      const openAgentWorkspace = window.piFlow?.openAgentWorkspace;
      if (!openAgentWorkspace) {
        toast(t("浏览器调试模式无法打开文件管理器"), true);
        return false;
      }
      const error = await openAgentWorkspace(agentId);
      if (error) {
        toast(error, true);
        return false;
      }
      return true;
    },
    loadSolo: () => window.piFlow?.getSoloWorkspace?.(),
    openSolo: async () => {
      const openSoloWorkspace = window.piFlow?.openSoloWorkspace;
      if (!openSoloWorkspace) {
        toast(t("浏览器调试模式无法打开文件管理器"), true);
        return false;
      }
      const error = await openSoloWorkspace();
      if (error) {
        toast(error, true);
        return false;
      }
      return true;
    },
  });
  quickSecondary?.addEventListener("click", () => workspace.open());

  function isRunning() {
    return model.flow.nodes.some((node) => node.status === "running");
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const flow = model.flow;
    if (!flow?.id) return;
    shell.setSaveState(t("保存中…"));
    try {
      await request(`/api/flows/${encodeURIComponent(flow.id)}`, {
        method: "PUT",
        body: JSON.stringify({ nodes: flow.nodes, edges: flow.edges }),
      });
      const summary = flows.find((item) => item.id === flow.id);
      if (summary) {
        summary.nodeCount = flow.nodes.length;
        summary.edgeCount = flow.edges.length;
      }
      renderFlowList();
      shell.setSaveState(t("已保存"));
    } catch (error) {
      shell.setSaveState(t("保存失败"));
      toast(error.message, true);
    }
  }

  function scheduleSave() {
    if (!model.flow.id) return;
    shell.setSaveState(t("保存中…"));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 350);
  }

  function renderFlowList() {
    const list = $("#flowItems");
    list.innerHTML = flowListMarkup(flows, selectedFlowId);
    const count = $("#flowCount");
    if (count) count.textContent = t("{n} 个", { n: flows.length });

    for (const item of list.querySelectorAll("[data-flow-id]")) {
      item.addEventListener("click", () => selectFlowItem(item.dataset.flowId));
    }
    for (const button of list.querySelectorAll("[data-delete-flow-id]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const flow = flows.find((item) => item.id === button.dataset.deleteFlowId);
        if (flow) deleteFlow(flow);
      });
    }
    const closable = Boolean(model.flow.id) || mode === "single";
    $("#flowClose").classList.toggle("hidden", !closable);
    $("#flowCancel").classList.toggle("hidden", !closable);

    // 首次出现固定在列表最上方，交互后才跟随选中项。
    if (!flowTracker) {
      flowTracker = createThumbTracker({
        track: $("#flowList"),
        thumb: $("#flowThumb"),
        resolve: () => {
          const items = $("#flowItems");
          if (!items) return null;
          return flowTouched ? items.querySelector(".flow-item.is-active") : items.querySelector(".flow-item");
        },
      });
    } else {
      flowTracker.refresh();
    }
  }

  function syncFlowSelection() {
    for (const item of $("#flowItems").querySelectorAll("[data-flow-id]")) {
      const active = item.dataset.flowId === selectedFlowId;
      item.classList.toggle("is-active", active);
      item.querySelector(".flow-delete")?.classList.toggle("ui-btn--ghost", !active);
    }
    flowTracker?.place(true);
  }

  async function deleteFlow(flow) {
    if (flow.id === model.flow.id && isRunning()) {
      toast(t("有节点正在运行，结束后再删除流程"), true);
      return;
    }

    const confirmed = await confirmDialog({
      title: t("删除流程"),
      message: t("确定删除流程「{name}」吗？", { name: flow.name }),
      detail: t(
        "该流程在各 Agent 项目下的 <code>.pi/flow/&lt;flowId&gt;</code> 工作区（inputs / output）会一并删除，无法恢复。",
      ),
      confirmText: t("确认删除"),
      danger: true,
    });
    if (!confirmed) return;

    if (flow.id === model.flow.id && isRunning()) {
      toast(t("有节点正在运行，结束后再删除流程"), true);
      return;
    }
    if (flow.id === model.flow.id) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      await request(`/api/flows/${encodeURIComponent(flow.id)}`, { method: "DELETE" });
      await refreshFlows();
      if (flow.id === model.flow.id) {
        context.transcript.close();
        model.setFlow(null);
        rememberFlow(null);
        render();
        openFlowModal();
      }
      toast(t("已删除「{name}」", { name: flow.name }));
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function refreshFlows() {
    try {
      const data = await request("/api/flows");
      flows = data.flows || [];
    } catch (error) {
      toast(error.message, true);
    }
    if (selectedFlowId && !flows.some((flow) => flow.id === selectedFlowId)) {
      selectedFlowId = model.flow.id || flows[0]?.id || null;
    }
    renderFlowList();
  }

  function updateConfirm() {
    const button = $("#modeConfirm");
    if (button) button.disabled = mode === "team" && !selectedFlowId;
  }

  function selectFlowItem(id) {
    flowTouched = true;
    selectedFlowId = id;
    syncFlowSelection();
    updateConfirm();
  }

  function setMode(next, animate = true) {
    mode = next === "single" ? "single" : "team";
    modeControl?.set(mode, { emit: false, animate });
    $("#teamPanel")?.classList.toggle("hidden", mode !== "team");
    $("#singlePanel")?.classList.toggle("hidden", mode !== "single");
    $("#flowClose")?.classList.toggle("hidden", !(model.flow.id || mode === "single"));
    updateConfirm();
  }

  function openFlowModal() {
    selectedFlowId = model.flow.id || flows[0]?.id || null;
    flowTouched = false;
    flowModal.open();
    setMode("team", false);
    renderFlowList();
    updateConfirm();
    // 样式 / 字体加载完成后按首项再校正一次初始位置。
    requestAnimationFrame(() => {
      modeControl?.place(false);
      flowTracker?.place(false);
    });
  }

  function closeFlowModal() {
    if (model.flow.id || mode === "single") flowModal.close("close");
  }

  async function launchSingleMode() {
    const button = $("#modeConfirm");
    button.disabled = true;
    try {
      await request("/api/single/launch", { method: "POST" });
      toast(t("已在外部终端启动 GEO_Single"));
      flowModal.close("single");
    } catch (error) {
      toast(error.message, true);
    } finally {
      updateConfirm();
    }
  }

  async function switchFlow(id) {
    if (!id) return false;
    if (id === model.flow.id) {
      closeFlowModal();
      return true;
    }
    if (isRunning()) {
      toast(t("有节点正在运行，结束后再切换流程"), true);
      return false;
    }
    try {
      await saveNow();
      const { flow } = await request(`/api/flows/${encodeURIComponent(id)}`);
      context.transcript.close();
      model.setFlow(flow);
      selectedFlowId = id;
      rememberFlow(id);
      closeFlowModal();
      renderFlowList();
      render();
      return true;
    } catch (error) {
      toast(error.message, true);
      return false;
    }
  }

  /** 切换语言会刷新页面，记住当前流程以免回到流程选择器。 */
  function rememberFlow(id) {
    try {
      sessionStorage.setItem("pi-flow-current-flow", id || "");
    } catch {
      // 存储不可用时忽略。
    }
  }

  function render() {
    shell.setPipeline({ nodes: model.flow.nodes.length, edges: model.flow.edges.length });
    context.canvas.renderNodes();
    context.canvas.renderEdges();
    inspector.render();
    context.minimap?.render(context.canvas.getView());
  }

  const context = { model, events, request, agents, artifacts, shell, render, scheduleSave };
  context.canvas = createCanvas(context);
  context.transcript = createTranscript();
  const inspector = createInspector(context);
  context.minimap = createMinimap({ model });

  events.on(EVENTS.AGENTS_CHANGED, render);
  events.on(EVENTS.FLOW_ADD_NODE, ({ agentId }) => {
    const index = model.flow.nodes.length;
    context.canvas.addNodeFromAgent(agentId, 70 + (index % 3) * 330, 110 + Math.floor(index / 3) * 150);
  });
  events.on(EVENTS.RUN_CHANGED, (patch) => {
    const node = model.nodeOf(patch.nodeId);
    if (!node) return;
    if (patch.select) model.ui.selection = { type: "node", id: node.id };
    if (patch.status) node.status = patch.status;
    if (patch.runId) node.lastRunId = patch.runId;
    if (patch.sessionInternalId) node.sessionId = patch.sessionInternalId;
    if (patch.status === "done") {
      node.artifacts = patch.run?.artifacts || [];
      node.lastSessionId = patch.sessionInternalId;
      model.pruneEdges(node);
    }
    if (patch.transcript) context.transcript.update(node.id, patch.transcript);
    if (patch.progress) return;
    render();
    if (patch.status === "done") scheduleSave();
  });

  $("#modeConfirm").addEventListener("click", () => {
    if (mode === "single") launchSingleMode();
    else if (selectedFlowId) switchFlow(selectedFlowId);
  });
  $("#flowForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isRunning()) {
      toast(t("有节点正在运行，结束后再新建流程"), true);
      return;
    }
    const form = event.currentTarget;
    const name = new FormData(form).get("name");
    try {
      const { flow } = await request("/api/flows", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      form.reset();
      await refreshFlows();
      selectedFlowId = flow.id;
      renderFlowList();
      updateConfirm();
    } catch (error) {
      toast(error.message, true);
    }
  });

  context.canvas.bind();
  renderFlowList();
  render();

  const restoreId = (() => {
    try {
      if (sessionStorage.getItem("pi-flow-keep-flow") !== "1") return null;
      sessionStorage.removeItem("pi-flow-keep-flow");
      return sessionStorage.getItem("pi-flow-current-flow") || null;
    } catch {
      return null;
    }
  })();

  if (restoreId && flows.some((flow) => flow.id === restoreId)) {
    switchFlow(restoreId).then((ok) => {
      if (!ok) openFlowModal();
    });
  } else {
    openFlowModal();
  }

  return {
    nodeOf: model.nodeOf,
    collectInputs: model.collectInputs,
    currentId: () => model.flow.id,
  };
}
