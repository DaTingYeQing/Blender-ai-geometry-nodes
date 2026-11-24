/* ===== 组件：画布连线层 =====
 * 一个固定 20000×20000 的 SVG，世界原点在中心；所有连线用世界坐标画，
 * 平移缩放只改外层 world 的 transform，这里不需要跟着重算。
 *
 * 每条线三件东西：可见 path、透明命中带、中点圆点。按 edge.id 复用，
 * 只改 d/transform；线消失就整组摘掉。箭头 marker 按颜色去重。
 */

import { anchorToward, bezierPath, bezierMidpoint, boxOf } from './geometry.js';

const EDGE_LAYER = 20000;

const NS = 'http://www.w3.org/2000/svg';

function svg(doc, tag, attrs = {}) {
  const node = typeof doc.createElementNS === 'function'
    ? doc.createElementNS(NS, tag)
    : doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(name, String(value));
  }
  return node;
}

/**
 * @param {{document: Document}} deps
 */
export function createCanvasEdgeLayer({ document: doc }) {
  return function canvasEdgeLayer(props = {}) {
    const root = svg(doc, 'svg', {
      class: 'canvas-edges',
      width: EDGE_LAYER,
      height: EDGE_LAYER,
      viewBox: `${-EDGE_LAYER / 2} ${-EDGE_LAYER / 2} ${EDGE_LAYER} ${EDGE_LAYER}`,
    });
    root.style.left = `${-EDGE_LAYER / 2}px`;
    root.style.top = `${-EDGE_LAYER / 2}px`;

    const defs = svg(doc, 'defs');
    root.appendChild(defs);

    /* Alt 拉线时的预览虚线：先建一次，整条线始终压在它上面。 */
    const preview = svg(doc, 'path', {
      class: 'edge-preview',
      fill: 'none',
      'stroke-width': 2,
      'stroke-dasharray': '6 5',
    });
    preview.style.display = 'none';
    root.appendChild(preview);

    /** @type {Map<string, {path:any, hit:any, dot:any}>} */
    const records = new Map();
    const markers = new Map();

    function markerFor(color) {
      if (markers.has(color)) return markers.get(color);
      const id = `arrow-${markers.size}`;
      const marker = svg(doc, 'marker', {
        id,
        viewBox: '0 0 10 10',
        markerWidth: 13,
        markerHeight: 13,
        refX: 9,
        refY: 5,
        orient: 'auto',
        markerUnits: 'userSpaceOnUse',
      });
      marker.appendChild(svg(doc, 'path', {
        d: 'M0,0 L10,5 L0,10 Z',
        fill: color,
      }));
      defs.appendChild(marker);
      markers.set(color, id);
      return id;
    }

    function createEdge(edge) {
      const path = svg(doc, 'path', {
        fill: 'none',
        stroke: edge.color,
        'stroke-width': 2.5,
        'stroke-opacity': 0.9,
        'marker-end': `url(#${markerFor(edge.color)})`,
      });

      const hit = svg(doc, 'path', {
        class: 'edge-hit',
        fill: 'none',
        stroke: 'transparent',
        'stroke-width': 16,
      });
      hit.dataset.edgeId = edge.id;

      const dot = svg(doc, 'g', { class: 'edge-dot' });
      if (typeof dot.style?.setProperty === 'function') dot.style.setProperty('--dot', edge.color);
      else if (dot.style) dot.style['--dot'] = edge.color;
      dot.dataset.edgeId = edge.id;
      dot.appendChild(svg(doc, 'circle', { class: 'edge-dot-hit', r: 14 }));
      dot.appendChild(svg(doc, 'circle', {
        class: 'edge-dot-core',
        r: 6,
        stroke: edge.color,
      }));

      root.appendChild(path);
      root.appendChild(hit);
      root.appendChild(dot);

      return { path, hit, dot };
    }

    function paint() {
      const nodes = Array.isArray(props.nodes) ? props.nodes : [];
      const edges = Array.isArray(props.edges) ? props.edges : [];
      const byId = new Map(nodes.map((node) => [node.id, node]));

      const alive = new Set();
      for (const edge of edges) {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) continue;
        alive.add(edge.id);

        let record = records.get(edge.id);
        if (!record) {
          record = createEdge(edge);
          records.set(edge.id, record);
        }

        const p1 = anchorToward(boxOf(a.x, a.y), { x: b.x, y: b.y });
        const p2 = anchorToward(boxOf(b.x, b.y), { x: a.x, y: a.y });
        const d = bezierPath(p1, p2, edge.bow || 0);
        record.path.setAttribute('d', d);
        record.hit.setAttribute('d', d);

        const mid = bezierMidpoint(p1, p2, edge.bow || 0);
        record.dot.setAttribute('transform', `translate(${mid.x}, ${mid.y})`);
      }

      for (const [id, record] of [...records]) {
        if (alive.has(id)) continue;
        record.path.remove();
        record.hit.remove();
        record.dot.remove();
        records.delete(id);
      }

      paintPreview(byId);
    }

    /* 拉线过程：一条从起点伸向鼠标的虚线。位置随 live 坐标一起算。 */
    function paintPreview(byId) {
      const edgePreview = props.preview;
      const from = edgePreview ? byId.get(edgePreview.fromId) : null;
      if (!from || !Number.isFinite(Number(edgePreview.x)) || !Number.isFinite(Number(edgePreview.y))) {
        preview.style.display = 'none';
        preview.setAttribute('d', '');
        return;
      }

      const point = { x: Number(edgePreview.x), y: Number(edgePreview.y) };
      const start = anchorToward(boxOf(from.x, from.y), point);
      preview.setAttribute('d', bezierPath(start, point));
      preview.setAttribute('stroke', edgePreview.color || '#71717a');
      preview.style.display = '';
    }

    paint();

    return {
      el: root,
      update(next = {}) {
        props = next;
        paint();
      },
      destroy() {
        root.remove();
      },
    };
  };
}
