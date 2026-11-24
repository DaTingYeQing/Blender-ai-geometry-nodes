/* ===== 画布立方体：SVG 用 DOM 拼出来 =====
 * 旧 `app/js/cube.js` 返回一段 HTML 字符串，新层禁止 innerHTML，
 * 所以这里用同一份几何数据逐个建节点。两处动态化保持不变：
 *   1. 顶部圆点 = 团队色；
 *   2. 三根拉线的渐变按团队色明暗衰减。
 * 渐变靠 id 引用，每次生成唯一后缀，否则多个立方体会引用到第一份渐变。
 */

const NS = 'http://www.w3.org/2000/svg';

let uid = 0;

function svg(document, tag, attrs = {}) {
  const node = typeof document.createElementNS === 'function'
    ? document.createElementNS(NS, tag)
    : document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(name, String(value));
  }
  return node;
}

/* 底板的四个角与立方体的六个面：全部是 512 视图里的原始坐标。 */
const BOARD = '35.84,306.93 256.00,422.55 476.16,306.93 256.00,191.31';
const BOARD_SHADE = '130.19,306.93 256.00,373.00 320.05,373.00 514.53,306.93 320.05,240.86 256.00,240.86';

const FACES = [
  { points: '130.19,306.93 256.00,373.00 256.00,221.59', fill: 'rgb(90,91,88)' },
  { points: '256.00,373.00 381.81,306.93 430.33,107.88', fill: 'rgb(31,34,40)' },
  { points: '256.00,373.00 430.33,107.88 256.00,221.59', fill: 'rgb(31,34,40)' },
  { points: '130.19,306.93 256.00,221.59 130.19,155.52', fill: 'rgb(90,91,88)' },
  { points: '130.19,155.52 256.00,221.59 430.33,107.88', fill: 'rgb(182,178,167)' },
  { points: '130.19,155.52 430.33,107.88 256.00,89.45', fill: 'rgb(189,184,173)' },
];

const EDGES = [
  [130.19, 306.93, 130.19, 155.52],
  [130.19, 306.93, 256.00, 373.00],
  [130.19, 155.52, 256.00, 89.45],
  [130.19, 155.52, 256.00, 221.59],
  [256.00, 373.00, 256.00, 221.59],
  [256.00, 373.00, 381.81, 306.93],
];

const PULLS = [
  { id: 'pull0', x2: 256.00, y2: 89.45, from: [256.00, 89.45] },
  { id: 'pull1', x2: 256.00, y2: 221.59, from: [256.00, 221.59] },
  { id: 'pull2', x2: 381.81, y2: 306.93, from: [381.81, 306.93] },
];

/* 原版渐变四段的饱和度/明度衰减节奏（相对起始色）。 */
const RAMP = [
  [0, 1, 1, 1],
  [0.35, 0.65, 0.68, 0.803],
  [0.7, 0.45, 0.45, 0.675],
  [1, 0.12, 0.30, 0.58],
];

function hsl(team, saturation, lightness) {
  return `hsl(${team.h}, ${Math.round(team.s * saturation)}%, ${Math.round(team.l * lightness)}%)`;
}

function stop(document, offset, color, opacity) {
  const node = svg(document, 'stop', {
    offset,
    'stop-color': color,
    'stop-opacity': opacity,
  });
  return node;
}

function linearGradient(document, id, attrs) {
  return svg(document, 'linearGradient', { id, ...attrs });
}

/**
 * 建一个带团队色的立方体 SVG。
 * @param {{document: Document, team: {h:number, s:number, l:number}}} options
 */
export function createCubeSvg({ document, team }) {
  const n = ++uid;
  const dot = hsl(team, 1, 1);

  const root = svg(document, 'svg', {
    xmlns: NS,
    viewBox: '0 0 512 512',
    role: 'img',
    'aria-label': 'Agent cube icon',
  });

  const defs = svg(document, 'defs');

  for (const pull of PULLS) {
    const gradient = linearGradient(document, `${pull.id}-${n}`, {
      gradientUnits: 'userSpaceOnUse',
      x1: 430.33,
      y1: 107.88,
      x2: pull.x2,
      y2: pull.y2,
    });
    for (const [offset, saturation, lightness, opacity] of RAMP) {
      gradient.appendChild(stop(document, offset, hsl(team, saturation, lightness), opacity));
    }
    defs.appendChild(gradient);
  }

  const board = linearGradient(document, `board-${n}`, {
    x1: 0, y1: 0, x2: 1, y2: 1,
  });
  board.appendChild(stop(document, 0, '#faf6ec', 1));
  board.appendChild(stop(document, 0.55, '#f2ecdd', 1));
  board.appendChild(stop(document, 1, '#e4dcc9', 1));
  defs.appendChild(board);

  const clip = svg(document, 'clipPath', { id: `boardClip-${n}` });
  clip.appendChild(svg(document, 'polygon', { points: BOARD }));
  defs.appendChild(clip);

  root.appendChild(defs);

  root.appendChild(svg(document, 'polygon', {
    points: BOARD,
    fill: `url(#board-${n})`,
    stroke: 'rgba(150,141,120,0.45)',
    'stroke-width': 1.2,
    'stroke-linejoin': 'round',
  }));

  root.appendChild(svg(document, 'polygon', {
    points: BOARD_SHADE,
    fill: 'rgba(96,78,52,0.450)',
    'clip-path': `url(#boardClip-${n})`,
  }));

  for (const face of FACES) {
    root.appendChild(svg(document, 'polygon', {
      points: face.points,
      fill: face.fill,
      stroke: face.fill,
      'stroke-width': 0.9,
      'stroke-linejoin': 'round',
    }));
  }

  const seams = svg(document, 'g', {
    stroke: 'rgba(46,44,39,0.550)',
    'stroke-width': 2.44,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  for (const [x1, y1, x2, y2] of EDGES) {
    seams.appendChild(svg(document, 'line', { x1, y1, x2, y2 }));
  }
  root.appendChild(seams);

  const pulls = svg(document, 'g', { 'stroke-linecap': 'round' });
  for (const pull of PULLS) {
    pulls.appendChild(svg(document, 'line', {
      x1: 430.33,
      y1: 107.88,
      x2: pull.from[0],
      y2: pull.from[1],
      stroke: `url(#${pull.id}-${n})`,
      'stroke-width': 5.61,
    }));
  }
  root.appendChild(pulls);

  const dotGroup = svg(document, 'g', { class: 'node-dot' });
  dotGroup.appendChild(svg(document, 'circle', {
    cx: 430.33, cy: 107.88, r: 40, fill: 'rgba(0,0,0,0)', 'pointer-events': 'all',
  }));
  dotGroup.appendChild(svg(document, 'circle', {
    class: 'dot-fill', cx: 430.33, cy: 107.88, r: 16.90, fill: dot,
  }));
  dotGroup.appendChild(svg(document, 'path', {
    class: 'dot-x',
    d: `M398.33,75.88 L462.33,139.88 M462.33,75.88 L398.33,139.88`,
    stroke: dot,
    'stroke-width': 16,
    'stroke-linecap': 'round',
    fill: 'none',
  }));
  root.appendChild(dotGroup);

  return root;
}
