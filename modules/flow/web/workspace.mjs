import { esc } from "../../../app/js/core/dom.mjs";
import { t } from "../../../app/js/core/i18n.mjs";
import { loadStyle } from "../../../app/js/core/style.mjs";
import { toast } from "../../../app/js/core/toast.mjs";
import { bindSegmented, createModal, segmentedMarkup } from "../../../app/js/ui/index.mjs";

export function createWorkspaceModal({ agents, openWorkspace, loadSolo, openSolo }) {
  loadStyle("/modules/flow/web/workspace.css");

  const modal = createModal({
    title: t("工作区"),
    className: "workspace-modal",
    initialFocus: ".workspace-mode .ui-seg.is-active",
    body: `
      <div class="workspace-mode">
        ${segmentedMarkup({
          value: "solo",
          items: [
            { value: "solo", label: t("Solo 工作区") },
            { value: "team", label: t("Team 工作区") },
          ],
        })}
      </div>
      <div id="workspaceSoloPanel" class="workspace-panel">
        <p class="workspace-warning" role="note">
          <span class="workspace-warning__mark" aria-hidden="true">!</span>
          ${esc(t("请及时清理工作区，最好一次任务完成后清理一次。"))}
        </p>
        <div id="workspaceSoloList" class="ui-well workspace-list"></div>
        <p class="ui-hint workspace-note">
          ${t("Solo 工作区由运行环境的 <code>workspace.root</code> 动态解析。")}
        </p>
      </div>
      <div id="workspaceTeamPanel" class="workspace-panel hidden">
        <div id="workspaceTeamList" class="ui-well workspace-list"></div>
        <p class="ui-hint workspace-note">
          ${t(
            "工作区是 Agent 注册时填写的项目目录；运行产物在项目下的 <code>.pi/flow/&lt;flowId&gt;/runs/</code>。",
          )}
        </p>
      </div>`,
  });

  const soloPanel = modal.panel.querySelector("#workspaceSoloPanel");
  const teamPanel = modal.panel.querySelector("#workspaceTeamPanel");
  const soloList = modal.panel.querySelector("#workspaceSoloList");
  const teamList = modal.panel.querySelector("#workspaceTeamList");

  const mode = bindSegmented(modal.panel.querySelector(".workspace-mode .ui-segmented"), {
    value: "solo",
    onChange: (next) => showMode(next),
  });

  let soloToken = 0;

  function showMode(next) {
    const team = next === "team";
    teamPanel.classList.toggle("hidden", !team);
    soloPanel.classList.toggle("hidden", team);
    mode.set(team ? "team" : "solo", { emit: false });
    if (team) renderTeam();
    else renderSolo();
  }

  async function browse(action) {
    try {
      const opened = await action();
      if (opened) modal.close("browse");
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderTeam() {
    const items = agents.list?.() || [];
    if (!items.length) {
      teamList.innerHTML = `<div class="ui-empty">${esc(t("还没有注册 Agent。"))}</div>`;
      return;
    }

    teamList.innerHTML = items
      .map(
        (agent) => `
        <div class="workspace-row">
          <div class="workspace-row__main">
            <span class="workspace-row__name">${esc(agent.name)}</span>
            <span class="workspace-row__path" title="${esc(agent.projectPath)}">${esc(agent.projectPath)}</span>
          </div>
          <button type="button" class="ui-btn ui-btn--sm" data-workspace-agent="${esc(agent.id)}">${esc(
            t("浏览"),
          )}</button>
        </div>`,
      )
      .join("");

    for (const button of teamList.querySelectorAll("[data-workspace-agent]")) {
      button.addEventListener("click", () =>
        browse(() => openWorkspace?.(button.dataset.workspaceAgent)),
      );
    }
  }

  async function renderSolo() {
    const token = ++soloToken;
    soloList.innerHTML = `<div class="ui-empty">${esc(t("正在读取 Solo 工作区…"))}</div>`;

    let info = null;
    try {
      info = await loadSolo?.();
    } catch (error) {
      if (token === soloToken) soloList.innerHTML = `<div class="ui-empty">${esc(error.message)}</div>`;
      return;
    }
    if (token !== soloToken) return;

    if (!info?.workspace) {
      soloList.innerHTML = `<div class="ui-empty">${esc(
        t("浏览器调试模式无法解析 Solo 工作区，请用桌面端打开。"),
      )}</div>`;
      return;
    }

    soloList.innerHTML = `
      <div class="workspace-row">
        <div class="workspace-row__main">
          <span class="workspace-row__name">GEO_Single</span>
          <span class="workspace-row__path" title="${esc(info.workspace)}">${esc(info.workspace)}</span>
        </div>
        <button type="button" class="ui-btn ui-btn--sm" data-workspace-solo>${esc(t("浏览"))}</button>
      </div>`;

    soloList.querySelector("[data-workspace-solo]")?.addEventListener("click", () => {
      browse(() => openSolo?.());
    });
  }

  function open() {
    showMode("solo");
    modal.open();
    requestAnimationFrame(() => mode.place(false));
  }

  return { open };
}
