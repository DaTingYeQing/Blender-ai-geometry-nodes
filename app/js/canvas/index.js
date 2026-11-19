/* ===== 画布：接线 =====
 * 三个子模块各管一件事，这里只把它们接起来：
 *   view.js         坐标换算 + 平移缩放
 *   scene.js        nodes/edges → DOM
 *   interactions.js 鼠标手势 → 意图
 *
 * 依赖是靠参数传进去的，不是互相 import 出来的 —— 所以场景层能被单测、
 * 手势层能被换掉（比如换成触摸手势），互不影响。
 */

import { createView } from './view.js';
import { createScene } from './scene.js';
import { bindInteractions } from './interactions.js';

export function mountCanvas({ store, bus }) {
  const canvasEl = document.getElementById('wsCanvas');
  const worldEl = document.getElementById('canvasWorld');

  const view = createView({ store, canvasEl, worldEl });
  const scene = createScene({ store, worldEl, boxOf: view.boxOf });

  view.bindPanZoom();
  bindInteractions({ store, bus, scene, view, canvasEl, worldEl });
  view.apply();

  store.subscribe(scene.render);

  // 拖拽组件要"屏幕 → 世界"的换算，从这里取，不自己抄一份公式
  return { screenToWorld: view.screenToWorld };
}
