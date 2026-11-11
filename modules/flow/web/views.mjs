import { esc } from "../../../app/js/core/dom.mjs";
import { t } from "../../../app/js/core/i18n.mjs";
import { segmentedMarkup } from "../../../app/js/ui/index.mjs";

export function canvasDecorMarkup() {
  return `
    <div class="ruler" aria-hidden="true"></div>
    <div class="canvas-quick-stack">
      <div class="canvas-quick-plate">
        <button type="button" id="quickAddAgentBtn" class="canvas-quick" title="${esc(
          t("新建流程"),
        )}" aria-label="${esc(t("新建流程"))}">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M5.5 1V10M1 5.5H10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <div class="canvas-quick-plate">
        <button type="button" id="quickSecondaryBtn" class="canvas-quick" title="${esc(
          t("工作区"),
        )}" aria-label="${esc(t("工作区"))}">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M1 3.1C1 2.49 1.49 2 2.1 2H4.1L5.1 3.1H8.9C9.51 3.1 10 3.59 10 4.2V8.1C10 8.71 9.51 9.2 8.9 9.2H2.1C1.49 9.2 1 8.71 1 8.1V3.1Z"
              stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </div>
    <i class="cross tr" aria-hidden="true"></i>
    <i class="cross bl" aria-hidden="true"></i>
    <i class="cross br" aria-hidden="true"></i>
    <div class="map" aria-hidden="true">
      <div class="map__head"><span>MAP</span></div>
      <div class="map__body">
        <svg id="miniMapSvg" width="280" height="190" viewBox="0 0 280 190" fill="none"></svg>
      </div>
    </div>`;
}

export function flowModalMarkup() {
  return `
    <div id="flowModal" class="ui-modal-backdrop flow-launcher hidden">
      <div class="ui-modal flow-modal">
        <div class="ui-modal__head">
          <h2>${esc(t("选择模式"))}</h2>
          <button id="flowClose" class="ui-btn ui-btn--icon" data-modal-close title="${esc(
            t("关闭"),
          )}" aria-label="${esc(t("关闭"))}">×</button>
        </div>
        <div id="modeSwitch">
          ${segmentedMarkup({
            value: "team",
            items: [
              { value: "team", label: t("团队"), dot: false },
              { value: "single", label: t("单人"), dot: false },
            ],
          })}
        </div>
        <div id="teamPanel" class="mode-panel">
          <div class="flow-list-head">
            <span>${esc(t("流程"))}</span>
            <i id="flowCount">${esc(t("{n} 个", { n: 0 }))}</i>
          </div>
          <div id="flowList" class="ui-well flow-list">
            <i id="flowThumb" class="ui-thumb" aria-hidden="true"></i>
            <div id="flowItems" class="flow-items"></div>
          </div>
          <form id="flowForm" class="flow-form">
            <label class="ui-field">
              <span>${esc(t("新建流程"))}</span>
              <div class="ui-field__row">
                <input name="name" type="text" class="ui-input" placeholder="${esc(t("流程名称"))}" />
                <button class="ui-btn ui-btn--primary ui-btn--sm" type="submit">${esc(t("创建"))}</button>
              </div>
            </label>
          </form>
        </div>
        <div id="singlePanel" class="mode-panel hidden">
          <p class="ui-hint">${t(
            "单人模式会在外部终端启动 <code>GEO_Single</code>；新建或继续历史会话由 pi 自己管理，Pi Flow 不会关闭。",
          )}</p>
        </div>
        <div class="ui-modal__actions">
          <button type="button" id="flowCancel" class="ui-btn ui-btn--ghost" data-modal-close>${esc(
            t("取消"),
          )}</button>
          <button type="button" id="modeConfirm" class="ui-btn ui-btn--primary">${esc(t("确定"))}</button>
        </div>
      </div>
    </div>`;
}

export function flowListMarkup(flows, selectedFlowId) {
  if (!flows.length) return `<div class="ui-empty">${esc(t("还没有流程。在下面创建一个。"))}</div>`;
  return flows
    .map((flow) => {
      const active = flow.id === selectedFlowId;
      return `
      <div class="flow-item ${active ? "is-active" : ""}" data-flow-id="${esc(flow.id)}">
        <span class="flow-name">${esc(flow.name)}</span>
        <span class="flow-meta">${esc(
          t("{nodes} 节点 · {edges} 连线", { nodes: flow.nodeCount, edges: flow.edgeCount }),
        )}</span>
        <button type="button" class="ui-btn ui-btn--sm flow-delete ${active ? "" : "ui-btn--ghost"}"
          data-delete-flow-id="${esc(flow.id)}" title="${esc(t("删除流程"))}">${esc(t("删除"))}</button>
      </div>`;
    })
    .join("");
}
