import { $, $$, esc, fmtSize } from "../../../app/js/core/dom.mjs";
import { EVENTS } from "../../../app/js/core/events.mjs";
import { t } from "../../../app/js/core/i18n.mjs";
import { toast } from "../../../app/js/core/toast.mjs";
import { bindSegmented, bindSwitch, segmentedMarkup, switchMarkup } from "../../../app/js/ui/index.mjs";
import { statusLabel } from "./state.mjs";

const STATUSES = new Set(["idle", "running", "done", "error"]);

export function createInspector(context) {
const disposers = [];

function resetBindings() {
  for (const dispose of disposers.splice(0)) dispose?.();
}

function renderInspector() {
  resetBindings();

  const inspector = $("#inspector");
  const selection = context.model.ui.selection;
  const visible = selection?.type === "node" || selection?.type === "edge";
  $(".workspace")?.classList.toggle("inspector-hidden", !visible);

  if (!visible) {
    inspector.innerHTML = "";
    return;
  }

  if (selection.type === "node") {
    const node = context.model.nodeOf(context.model.ui.selection.id);
    if (!node) {
      context.model.ui.selection = null;
      return context.render();
    }
    inspector.innerHTML = nodeInspector(node);
    wireNodeInspector(node);
    return;
  }

  if (selection.type === "edge") {
    const edge = context.model.edgeOf(context.model.ui.selection.id);
    if (!edge) {
      context.model.ui.selection = null;
      return context.render();
    }
    inspector.innerHTML = edgeInspector(edge);
    wireEdgeInspector(edge);
    return;
  }

  inspector.innerHTML = "";
}

function nodeInspector(node) {
  const agent = context.agents.get(node?.agentId);
  const sessions = agent?.sessions || [];
  const incoming = context.model.collectInputs(node);
  const reuse = node.sessionMode === "reuse";
  const running = node.status === "running";
  const status = STATUSES.has(node.status) ? node.status : "idle";
  const projectPath = String(agent?.projectPath || "").replace(/\\/g, "/");

  return `
    <div class="insp-head">
      <span class="insp-kicker">${esc(t("节点"))}</span>
      <span class="ui-status ${status === "idle" ? "" : `ui-status--${status}`}">${statusLabel(status)}</span>
      <button type="button" class="ui-btn ui-btn--icon" data-action="close-inspector" title="${esc(
        t("关闭"),
      )}">×</button>
    </div>
    <div class="insp-info ui-well">
      <div class="info-row"><span>Agent</span><b>${esc(agent?.name || t("未知"))}</b></div>
      <div class="info-row"><span>${esc(t("项目"))}</span><b title="${esc(agent?.projectPath || "")}">${esc(
        projectPath,
      )}</b></div>
    </div>

    <div class="insp-section">
      <h3 class="with-count">${esc(t("任务 / Prompt"))} <span id="taskCount">${(node.task || "").length} / 4000</span></h3>
      <textarea id="nodeTask" class="ui-textarea" maxlength="4000" rows="5" placeholder="${esc(
        t("描述这个节点要做什么。可以引用上游产物路径。"),
      )}">${esc(node.task || "")}</textarea>
    </div>

    <div class="insp-section">
      <div class="toggle-row">
        <div class="toggle-text">
          <h3>${esc(t("交接提示词"))}</h3>
          <p class="ui-hint">${esc(t("开启后，运行时会在任务后面附上本次上游 inputs 的绝对路径"))}</p>
        </div>
        ${switchMarkup({ id: "nodeHandoff", checked: node.handoffEnabled !== false, label: t("交接提示词") })}
      </div>
    </div>

    <div class="insp-section">
      <h3 class="with-count">${esc(t("会话"))} <button type="button" class="ui-btn ui-btn--sm" data-action="open-transcript">${esc(
        t("会话记录"),
      )}</button></h3>
      <div id="sessionMode">
        ${segmentedMarkup({
          value: reuse ? "reuse" : "new",
          items: [
            { value: "new", label: t("新对话") },
            { value: "reuse", label: t("复用历史对话") },
          ],
        })}
      </div>
      <select id="sessionSelect" class="ui-select ${reuse ? "" : "hidden"}">
        ${
          sessions.length
            ? sessions
                .map(
                  (session) =>
                    `<option value="${esc(session.id)}" ${
                      session.id === node.sessionId ? "selected" : ""
                    }>${esc(session.title)} · ${esc(
                      t("{n} 条", { n: session.messageCount || 0 }),
                    )}</option>`,
                )
                .join("")
            : `<option value="">${esc(t("暂无历史会话"))}</option>`
        }
      </select>
    </div>

    ${
      incoming.length
        ? `<div class="insp-section">
            <h3 class="with-count">${esc(t("输入文件（来自连线）"))}<span>${esc(
              t("{n} 个", { n: incoming.length }),
            )}</span></h3>
            ${incoming
              .map(
                (file) => `
                <div class="ui-file-row">
                  <span class="ui-file-row__grow">${esc(file.name)}</span>
                  <span class="ui-file-row__size">${fmtSize(file.size)}</span>
                </div>`,
              )
              .join("")}
          </div>`
        : ""
    }

    <div class="insp-section">
      ${
        running
          ? `<button id="abortNodeBtn" class="ui-btn ui-btn--danger ui-btn--block">${esc(t("中止运行"))}</button>`
          : `<button id="runNodeBtn" class="ui-btn ui-btn--primary ui-btn--block ui-btn--lg">${esc(
              t("▶ 运行节点"),
            )}</button>`
      }
    </div>

    <div class="insp-section">
      ${
        node.artifacts?.length
          ? `<h3 class="with-count">${esc(t("产物"))}<span>${esc(
              t("{n} 个文件", { n: node.artifacts.length }),
            )}</span></h3>
             ${node.artifacts
               .map(
                 (file) => `
                <div class="ui-file-row">
                  <span class="ui-file-row__grow" title="${esc(file.path)}">${esc(file.name)}</span>
                  <span class="ui-file-row__size">${fmtSize(file.size)}</span>
                  <button class="ui-link-btn" data-preview="${esc(file.path)}" data-preview-name="${esc(
                    file.name,
                  )}">${esc(t("预览"))}</button>
                </div>`,
               )
               .join("")}`
          : `<div class="ui-empty ui-empty--well">${t("产物 0 个文件<br />运行后在这里看到产物")}</div>`
      }
    </div>`;
}

function wireNodeInspector(node) {
  $("#nodeTask")?.addEventListener("input", (event) => {
    node.task = event.target.value;
    const count = $("#taskCount");
    if (count) count.textContent = `${event.target.value.length} / 4000`;
    context.scheduleSave();
  });

  const handoff = bindSwitch($("#nodeHandoff"), {
    onChange: (checked) => {
      node.handoffEnabled = checked;
      context.scheduleSave();
    },
  });

  const session = bindSegmented($("#sessionMode .ui-segmented"), {
    value: reuseMode(node),
    onChange: (mode) => {
      node.sessionMode = mode;
      if (mode === "reuse" && !node.sessionId) {
        node.sessionId = context.agents.get(node.agentId)?.sessions?.[0]?.id || null;
      }
      const select = $("#sessionSelect");
      select?.classList.toggle("hidden", mode !== "reuse");
      if (select && node.sessionId) select.value = node.sessionId;
      context.scheduleSave();
    },
  });

  disposers.push(() => handoff?.destroy(), () => session?.destroy());

  $("#sessionSelect")?.addEventListener("change", (event) => {
    node.sessionId = event.target.value;
    context.scheduleSave();
  });

  $("#runNodeBtn")?.addEventListener("click", () => {
    context.events.emit(EVENTS.RUN_REQUEST, { nodeId: node.id });
  });

  $("#abortNodeBtn")?.addEventListener("click", () => {
    context.events.emit(EVENTS.RUN_ABORT, { nodeId: node.id });
  });

  $('[data-action="open-transcript"]')?.addEventListener("click", () => {
    context.transcript.open(node);
  });

  $$("[data-preview]").forEach((button) => {
    button.addEventListener("click", () =>
      context.artifacts.preview(button.dataset.preview, button.dataset.previewName),
    );
  });

  $('[data-action="close-inspector"]')?.addEventListener("click", () => {
    context.model.ui.selection = null;
    context.render();
  });
}

function edgeInspector(edge) {
  const from = context.model.nodeOf(edge.from);
  const to = context.model.nodeOf(edge.to);
  const artifacts = from?.artifacts || [];
  const selected = new Set((edge.files || []).map((file) => file.path));

  return `
    <div class="insp-head">
      <span class="insp-kicker">${esc(t("连线"))}</span>
      <button type="button" class="ui-btn ui-btn--icon" data-action="close-inspector" title="${esc(
        t("关闭"),
      )}">×</button>
    </div>
    <h2>${esc(from?.title || "?")} <span class="arrow">→</span> ${esc(to?.title || "?")}</h2>
    <p class="ui-hint">${t(
      "从上游产物中显式勾选要传递的文件。下游运行时会把它们复制到本次 run 的 <code>inputs/</code>。",
    )}</p>

    <div class="insp-section">
      <h3>${esc(t("上游产物"))}</h3>
      ${
        artifacts.length
          ? artifacts
              .map(
                (file) => `
                <label class="ui-file-row">
                  <input type="checkbox" class="ui-check" data-artifact-path="${esc(file.path)}" ${
                    selected.has(file.path) ? "checked" : ""
                  } />
                  <span class="ui-file-row__grow" title="${esc(file.path)}">${esc(file.name)}</span>
                  <span class="ui-file-row__size">${fmtSize(file.size)}</span>
                </label>`,
              )
              .join("")
          : `<div class="ui-empty">${esc(t("上游还没有产物。先运行上游节点。"))}</div>`
      }
    </div>

    <div class="insp-section">
      <div class="radio-row">
        <button class="ui-btn ui-btn--ghost ui-btn--sm" data-action="select-all" ${
          artifacts.length ? "" : "disabled"
        }>${esc(t("全选"))}</button>
        <button class="ui-btn ui-btn--ghost ui-btn--sm" data-action="clear-all" ${
          edge.files?.length ? "" : "disabled"
        }>${esc(t("清空"))}</button>
      </div>
      <div class="ui-kv"><span>${esc(t("已选"))}</span><b>${esc(
        t("{n} 个文件", { n: edge.files?.length || 0 }),
      )}</b></div>
    </div>

    <div class="insp-section">
      <button class="ui-btn ui-btn--danger ui-btn--block" data-action="delete-edge">${esc(t("删除连线"))}</button>
    </div>`;
}

function wireEdgeInspector(edge) {
  const from = context.model.nodeOf(edge.from);
  const artifacts = from?.artifacts || [];

  const sync = () => {
    const checked = new Set(
      $$('#inspector input[data-artifact-path]:checked').map((input) => input.dataset.artifactPath),
    );
    edge.files = artifacts
      .filter((file) => checked.has(file.path))
      .map((file) => ({ name: file.name, path: file.path, size: file.size }));
    context.render();
    context.scheduleSave();
  };

  $$('#inspector input[data-artifact-path]').forEach((input) => {
    input.addEventListener("change", sync);
  });

  $('[data-action="select-all"]')?.addEventListener("click", () => {
    edge.files = artifacts.map((file) => ({ name: file.name, path: file.path, size: file.size }));
    context.render();
    context.scheduleSave();
  });

  $('[data-action="clear-all"]')?.addEventListener("click", () => {
    edge.files = [];
    context.render();
    context.scheduleSave();
  });

  $('[data-action="delete-edge"]')?.addEventListener("click", () => {
    context.canvas.deleteEdge(edge.id);
    toast(t("连线已删除"));
  });

  $('[data-action="close-inspector"]')?.addEventListener("click", () => {
    context.model.ui.selection = null;
    context.render();
  });
}

return { render: renderInspector };
}

function reuseMode(node) {
  return node.sessionMode === "reuse" ? "reuse" : "new";
}

