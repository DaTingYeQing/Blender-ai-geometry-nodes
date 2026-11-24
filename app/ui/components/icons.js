/* ===== 组件图标 =====
 * 行内 SVG 路径表：侧栏卡片、工作区底栏共用。
 * 图形是纯展示，颜色交给 CSS（stroke: currentColor），组件不写主题色。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 24×24 视图里的描边图标。 */
const ICONS = {
  check: ['M4 12.5 L9.5 18 L20 6'],
  x: ['M6 6 L18 18', 'M18 6 L6 18'],
  pencil: ['M4 20h4L19 9l-4-4L4 16z'],
  trash: ['M5 7h14', 'M9 7V5h6v2', 'M7 7l1 13h8l1-13'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
};

function createSvg(document, tag) {
  return typeof document?.createElementNS === 'function'
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
}

function setAttrs(node, attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(name, String(value));
  }
}

/**
 * @param {Document} document
 * @param {'check' | 'x' | 'pencil' | 'trash' | 'folder'} name
 * @param {{ className?: string }} [options]
 * @returns {SVGElement}
 */
export function createIcon(document, name, { className = 'ti-icon' } = {}) {
  const paths = ICONS[name] || [];
  const svg = createSvg(document, 'svg');
  setAttrs(svg, {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    ...(className ? { class: className } : {}),
  });

  for (const d of paths) {
    const path = createSvg(document, 'path');
    setAttrs(path, { d });
    svg.appendChild(path);
  }
  return svg;
}