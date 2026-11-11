import { esc } from "../../../app/js/core/dom.mjs";
import { t } from "../../../app/js/core/i18n.mjs";
import { nodeHue } from "./state.mjs";

const NODE_PALETTE = [
  { c: "#C05A2E", dark: "#8A3B1C", light: "#F0B48E" },
  { c: "#6E5A72", dark: "#4A3B4E", light: "#C0AECC" },
  { c: "#3F7A70", dark: "#28544D", light: "#9FCBC0" },
  { c: "#6E7A48", dark: "#4E5A2E", light: "#B8C48C" },
  { c: "#C39A3E", dark: "#8A6B1C", light: "#FFEDB8" },
];

export function paletteOf(node) {
  const raw = Number(nodeHue(node));
  const hue = Number.isFinite(raw) ? ((raw % 360) + 360) % 360 : 0;
  return NODE_PALETTE[Math.min(NODE_PALETTE.length - 1, Math.floor(hue / 72))];
}

export function nodeMarkup({ node, agent, selected, inCount = 0, outCount = 0 }) {
  const hue = nodeHue(node).toFixed(0);
  const palette = paletteOf(node);
  return `
    <div class="node status-${esc(node.status || "idle")} ${selected ? "selected" : ""}"
         data-node-id="${esc(node.id)}"
         style="--hue:${hue};--c:${palette.c};--c-dark:${palette.dark};--c-light:${palette.light};left:${node.x}px;top:${node.y}px">
      <i class="node__ring" aria-hidden="true"></i>
      <div class="node-header">
        <i class="node__sw" aria-hidden="true"></i>
        <span class="node-title">${esc(node.title)}</span>
        <button class="node-run" data-run="${esc(node.id)}" title="${esc(t("运行节点"))}">▶</button>
      </div>
      <div class="node-path" title="${esc(agent?.projectPath || "")}">${esc(agent?.projectPath || "")}</div>
      <div class="node__stat">${esc(t("入 {in} · 出 {out}", { in: inCount, out: outCount }))}</div>
    </div>`;
}
