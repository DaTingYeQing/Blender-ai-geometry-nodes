import { $ } from "../../../app/js/core/dom.mjs";
import { NODE_H, NODE_W } from "./state.mjs";
import { paletteOf } from "./node-view.mjs";

const MAP_W = 280;
const MAP_H = 190;
const PAD = 14;
const MAX_SCALE = 0.29;

const round = (value) => Number(value.toFixed(1));

export function createMinimap({ model }) {
  function render(view) {
    const svg = $("#miniMapSvg");
    if (!svg) return;

    const nodes = model.flow.nodes || [];

    if (!nodes.length) {
      svg.innerHTML = "";
      return;
    }

    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxX = Math.max(...nodes.map((node) => node.x + NODE_W));
    const maxY = Math.max(...nodes.map((node) => node.y + NODE_H));
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min((MAP_W - PAD * 2) / spanX, (MAP_H - PAD * 2) / spanY, MAX_SCALE);
    const offsetX = (MAP_W - spanX * scale) / 2 - minX * scale;
    const offsetY = (MAP_H - spanY * scale) / 2 - minY * scale;

    const mx = (x) => round(offsetX + x * scale);
    const my = (y) => round(offsetY + y * scale);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const edges = (model.flow.edges || [])
      .map((edge) => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        if (!from || !to) return "";
        return `<line x1="${mx(from.x + NODE_W / 2)}" y1="${my(from.y + NODE_H / 2)}" x2="${mx(
          to.x + NODE_W / 2,
        )}" y2="${my(to.y + NODE_H / 2)}" />`;
      })
      .join("");

    const rects = nodes
      .map(
        (node) =>
          `<rect x="${mx(node.x)}" y="${my(node.y)}" width="${round(NODE_W * scale)}" height="${round(
            NODE_H * scale,
          )}" fill="#EDE3CC" stroke="${paletteOf(node).c}" />`,
      )
      .join("");

    let viewport = "";
    const wrap = $("#canvasWrap");
    if (view && wrap) {
      const left = -view.x / view.scale;
      const top = -view.y / view.scale;
      const width = wrap.clientWidth / view.scale;
      const height = wrap.clientHeight / view.scale;
      viewport = `<rect x="${mx(left)}" y="${my(top)}" width="${round(width * scale)}" height="${round(
        height * scale,
      )}" fill="rgba(192,90,46,0.07)" stroke="#C05A2E" stroke-width="1" stroke-dasharray="3 3" />`;
    }

    svg.innerHTML = `<g stroke="#8F8261" stroke-width="1">${edges}</g><g>${rects}</g>${viewport}`;
  }

  return { render };
}
