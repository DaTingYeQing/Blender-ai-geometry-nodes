import { $, esc } from "../../../app/js/core/dom.mjs";
import { t } from "../../../app/js/core/i18n.mjs";
import { renderMarkdown } from "../../../app/js/core/markdown.mjs";
import { createModal } from "../../../app/js/ui/index.mjs";
import { statusLabel } from "./state.mjs";

const STATUSES = new Set(["idle", "running", "done", "error"]);

function describeArgs(toolName, args) {
  if (!args || typeof args !== "object") return "";
  let text;
  if (toolName === "bash" || toolName === "powershell") text = String(args.command || "");
  else if (args.path) text = String(args.path);
  else if (args.file_path) text = String(args.file_path);
  else text = JSON.stringify(args);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

function renderEntry(entry) {
  if (entry.type === "thinking") {
    return `<section class="tr-block tr-thinking">
      <div class="tr-label">${esc(t("思考"))}</div>
      <div class="tr-md">${renderMarkdown(entry.text)}</div>
    </section>`;
  }

  if (entry.type === "text") {
    return `<section class="tr-block tr-text"><div class="tr-md">${renderMarkdown(entry.text)}</div></section>`;
  }

  const state = t(entry.status === "running" ? "运行中" : entry.isError ? "失败" : "完成");
  const duration = Number.isFinite(entry.durationMs) ? ` · ${entry.durationMs}ms` : "";
  const args = describeArgs(entry.toolName, entry.args);
  return `<section class="tr-block tr-tool ${esc(entry.status || "")}">
    <div class="tr-tool-head">
      <span class="tr-tool-name">${esc(entry.toolName || "tool")}</span>
      <span class="tr-tool-state">${state}${duration}</span>
    </div>
    ${args ? `<div class="tr-tool-args">${esc(args)}</div>` : ""}
  </section>`;
}

export function createTranscript() {
  let current = null;
  const transcripts = new Map();

  const modal = createModal({
    id: "transcriptModal",
    title: t("会话"),
    className: "transcript-modal",
    headExtra: `<span id="transcriptStatus" class="ui-status">${esc(t("未运行"))}</span>`,
    body: '<div id="transcriptBody" class="transcript-body"></div>',
  });

  function isOpen() {
    return modal.isOpen();
  }

  function close() {
    modal.close("dismiss");
  }

  function render() {
    if (!current) return;
    const { node, nodeId } = current;
    const entries = transcripts.get(nodeId) || [];
    const status = STATUSES.has(node.status) ? node.status : "idle";

    modal.panel.querySelector(".ui-modal__head h2").textContent = t("{title} · 会话", {
      title: node.title || t("未命名节点"),
    });
    const statusEl = $("#transcriptStatus", modal.panel);
    statusEl.textContent = statusLabel(status);
    statusEl.className = `ui-status ${status === "idle" ? "" : `ui-status--${status}`}`;

    const body = $("#transcriptBody", modal.panel);
    const pinned = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    body.innerHTML = entries.length
      ? entries.map(renderEntry).join("")
      : `<div class="ui-empty">${esc(
          status === "running"
            ? t("会话已启动，等待模型输出…")
            : t("还没有会话内容。运行节点后，这里会实时显示思考、输出和工具调用。"),
        )}</div>`;
    if (pinned) body.scrollTop = body.scrollHeight;
  }

  function open(node) {
    current = { nodeId: node.id, node };
    modal.open();
    render();
  }

  function update(nodeId, entries) {
    transcripts.set(nodeId, Array.isArray(entries) ? entries : []);
    if (current?.nodeId === nodeId && isOpen()) render();
  }

  return { open, update, close };
}
