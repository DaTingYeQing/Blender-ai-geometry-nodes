import { $, $$ } from "./core/dom.mjs";
import { getLocale, setLocale } from "./core/i18n.mjs";
import { bindSegmented } from "./ui/index.mjs";

/** 外壳层：顶栏与状态条上的跨模块读数都从这里更新。 */
export function mountShell() {
  let clockTimer = null;

  bindSegmented($("#langSwitch"), {
    value: getLocale(),
    onChange: (next) => {
      setLocale(next);
      try {
        sessionStorage.setItem("pi-flow-keep-flow", "1");
      } catch {
        // 隐私模式禁用存储时仅失去当前流程上下文。
      }
      location.reload();
    },
  });

  const windowActions = {
    minimize: () => window.piFlow?.minimizeWindow?.(),
    "toggle-maximize": () => window.piFlow?.toggleMaximizeWindow?.(),
    close: () => window.piFlow?.closeWindow?.(),
  };

  for (const button of $$("[data-window-action]")) {
    button.addEventListener("click", () => windowActions[button.dataset.windowAction]?.());
  }

  $(".topbar")?.addEventListener("dblclick", (event) => {
    if (event.target.closest("button, select, .flow-controls, .socket, .lamps")) return;
    windowActions["toggle-maximize"]?.();
  });

  function setSaveState(text) {
    const element = $("#saveState");
    if (element) element.textContent = text;
  }

  function pipelineText(nodes, edges) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(nodes)} SLOTS · ${pad(edges)} LINKS`;
  }

  function setPipeline({ nodes = 0, edges = 0 } = {}) {
    const readout = $("#pipelineReadout");
    if (readout) readout.textContent = `PIPELINE / ${pipelineText(nodes, edges)}`;
  }

  function setZoom(scale) {
    const element = $("#zoomReadout");
    if (element) element.textContent = `ZOOM ${Math.round(scale * 100)}%`;
  }

  function tickClock() {
    const element = $("#clockReadout");
    if (element) element.textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });
  }

  function startClock() {
    if (clockTimer || !$("#clockReadout")) return;
    tickClock();
    clockTimer = setInterval(tickClock, 1000);
  }

  startClock();

  return { setSaveState, setPipeline, setZoom, startClock };
}
