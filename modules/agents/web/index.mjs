import { $, esc } from "../../../app/js/core/dom.mjs";
import { EVENTS } from "../../../app/js/core/events.mjs";
import { t } from "../../../app/js/core/i18n.mjs";
import { loadStyle } from "../../../app/js/core/style.mjs";
import { toast } from "../../../app/js/core/toast.mjs";
import { confirmDialog, createModal } from "../../../app/js/ui/index.mjs";
import { agentRowsMarkup, emptyAgentsMarkup, runLogMarkup } from "./view.mjs";

export function mountAgents({ events, request, initialAgents }) {
  loadStyle("/modules/agents/web/styles.css");
  let agents = initialAgents || [];

  $("#agentsPanel").innerHTML = `
    <div class="rail-head">
      <b>${esc(t("AGENT / 清单"))}</b>
      <i id="agentCount">00 UNITS</i>
    </div>
    <div id="paletteList" class="palette-list"></div>
    <button type="button" id="addAgentBtn" class="ui-btn newkey">
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
        <path d="M4.5 1V8M1 4.5H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      </svg>
      ${esc(t("新建 Agent"))}
    </button>
    ${runLogMarkup()}`;

  const modal = createModal({
    id: "agentModal",
    title: t("注册项目级 Agent"),
    className: "agent-modal",
    initialFocus: "input[name='name']",
    body: `
      <form id="agentForm">
        <label class="ui-field">
          <span>${esc(t("名称"))}</span>
          <input name="name" type="text" class="ui-input" required placeholder="${esc(t("例如：接口实现"))}" />
        </label>
        <label class="ui-field">
          <span>${esc(t("项目路径（绝对路径）"))}</span>
          <div class="ui-field__row">
            <input name="projectPath" type="text" class="ui-input" required placeholder="${esc(
              t("C:/Users/你/Desktop/project"),
            )}" />
            <button type="button" id="pickDirBtn" class="ui-btn ui-btn--ghost ui-btn--sm hidden">${esc(
              t("浏览…"),
            )}</button>
          </div>
        </label>
        <p class="ui-hint">
          ${t(
            "运行时以这个路径作为 <code>pi --mode rpc</code> 的 cwd，自动继承项目级 <code>.pi</code> 配置。产物写到项目内的 <code>.pi/flow/&lt;flowId&gt;/runs/&lt;runId&gt;/output</code>。",
          )}
        </p>
        <div class="ui-modal__actions">
          <button type="button" id="agentCancel" class="ui-btn ui-btn--ghost">${esc(t("取消"))}</button>
          <button type="submit" class="ui-btn ui-btn--primary">${esc(t("注册"))}</button>
        </div>
      </form>`,
  });
  const form = modal.panel.querySelector("#agentForm");

  const list = () => agents;
  const get = (id) => agents.find((agent) => agent.id === id) || null;

  function render() {
    const count = $("#agentCount");
    if (count) count.textContent = `${String(agents.length).padStart(2, "0")} UNITS`;
    const element = $("#paletteList");
    element.innerHTML = agents.length ? agentRowsMarkup(agents) : emptyAgentsMarkup();
  }

  async function reload() {
    const fresh = await request("/api/agents");
    agents = fresh.agents || agents;
    render();
    events.emit(EVENTS.AGENTS_CHANGED, { agents });
    return agents;
  }

  function openCreate() {
    modal.open();
  }

  $("#addAgentBtn").addEventListener("click", openCreate);
  $("#agentCancel").addEventListener("click", () => modal.close("cancel"));

  const pickButton = $("#pickDirBtn");
  if (window.piFlow?.pickDirectory) {
    pickButton.classList.remove("hidden");
    pickButton.addEventListener("click", async () => {
      const dir = await window.piFlow.pickDirectory();
      if (dir) form.querySelector("input[name='projectPath']").value = dir;
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
      await request("/api/agents", {
        method: "POST",
        body: JSON.stringify({ name: formData.get("name"), projectPath: formData.get("projectPath") }),
      });
      await reload();
      form.reset();
      modal.close("submit");
      toast(t("Agent 已注册，可以拖到画布了"));
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#paletteList").addEventListener("dragstart", (event) => {
    if (event.target.closest("[data-delete-agent-id]")) {
      event.preventDefault();
      return;
    }
    const card = event.target.closest(".agent-card");
    if (!card) return;
    card.classList.add("is-pressed");
    event.dataTransfer.setData("text/plain", card.dataset.agentId);
    event.dataTransfer.setData("application/x-agent-id", card.dataset.agentId);
    event.dataTransfer.effectAllowed = "copy";
  });
  $("#paletteList").addEventListener("dragend", (event) => {
    event.target.closest(".agent-card")?.classList.remove("is-pressed");
  });
  $("#paletteList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-agent-id]");
    if (!button) return;
    event.stopPropagation();
    const agent = get(button.dataset.deleteAgentId);
    if (!agent) return;

    const confirmed = await confirmDialog({
      title: t("删除 Agent"),
      message: t("确定删除「{name}」吗？", { name: agent.name }),
      detail: t("只删除注册记录，不会删除项目目录或已有会话。"),
      confirmText: t("删除"),
      danger: true,
    });
    if (!confirmed) return;

    try {
      await request(`/api/agents/${encodeURIComponent(agent.id)}`, { method: "DELETE" });
      await reload();
      toast(t("已删除「{name}」", { name: agent.name }));
    } catch (error) {
      toast(error.message, true);
    }
  });
  $("#paletteList").addEventListener("dblclick", (event) => {
    const card = event.target.closest(".agent-card");
    if (card) events.emit(EVENTS.FLOW_ADD_NODE, { agentId: card.dataset.agentId });
  });

  render();
  return { list, get, reload, openCreate };
}
