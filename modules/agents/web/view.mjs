import { esc } from "../../../app/js/core/dom.mjs";
import { t } from "../../../app/js/core/i18n.mjs";
import { RUN_LOG } from "../../../app/js/fixtures/decor.mjs";

const SWATCHES = ["exec", "scout", "plan", "explore", "trans"];

export function emptyAgentsMarkup() {
  return `<div class="ui-empty">${t("还没有注册 Agent。<br />点下方「新建 Agent」添加一个真实项目目录。")}</div>`;
}

export function agentRowsMarkup(agents) {
  return agents
    .map((agent, index) => {
      const sessions = agent.sessions?.length || 0;
      return `
      <div class="agent-card ui-press ui-press--lift" draggable="true" data-agent-id="${esc(agent.id)}">
        <div class="row-top">
          <span class="row-num">${String(index + 1).padStart(2, "0")}</span>
          <i class="sw sw--${SWATCHES[index % SWATCHES.length]}"></i>
          <strong class="row-name">${esc(agent.name)}</strong>
          <span class="row-meta">${esc(t("{n} 会话", { n: sessions }))}</span>
          <button type="button" class="ui-btn ui-btn--icon ui-btn--icon-sm agent-delete"
            data-delete-agent-id="${esc(agent.id)}" title="${esc(t("删除 Agent"))}">×</button>
        </div>
        <div class="row-path" title="${esc(agent.projectPath)}">${esc(agent.projectPath)}</div>
      </div>`;
    })
    .join("");
}

export function runLogMarkup() {
  return `
    <div class="log ui-well" aria-label="${esc(t("运行日志（静态占位）"))}">
      <div class="log-head"><span>${esc(t("RUN LOG / 今日"))}</span><span>${RUN_LOG.length} EVENTS</span></div>
      ${RUN_LOG.map(
        (entry) => `
        <div class="log-row">
          <i class="dot dot--${entry.status}"></i>
          <time>${esc(entry.time)}</time>
          <span class="${entry.status === "fail" ? "fail" : ""}">${esc(t(entry.text))}</span>
        </div>`,
      ).join("")}
    </div>`;
}
