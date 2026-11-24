/* ===== 画布组件注册 =====
 * 类型名集中在 contracts/component-types.js，区域只按名字取组件。
 */

import { CANVAS_COMPONENT } from '../../contracts/component-types.js';
import { createCanvasScene } from './scene.js';
import { createCanvasEdgeLayer } from './edge-layer.js';
import { createCanvasNode } from './node.js';

export { CANVAS_COMPONENT };

/**
 * @param {{ registry: import('../../contracts/components.js').ComponentRegistry, document: Document }} deps
 */
export function registerCanvasComponents({ registry, document }) {
  registry.register(CANVAS_COMPONENT.SCENE, createCanvasScene({ document }));
  registry.register(CANVAS_COMPONENT.EDGE_LAYER, createCanvasEdgeLayer({ document }));
  registry.register(CANVAS_COMPONENT.NODE, createCanvasNode({ document }));
}
