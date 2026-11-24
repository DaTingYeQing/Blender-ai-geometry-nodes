/* ===== 组装根：拖拽层 =====
 * 4.4：拖拽区域只发 node.drop.submitted / team.delete.submitted；
 * 这里回答一件它不该知道的事：能不能落在画布上（进没进工作区、
 * 在不在主区域、屏幕 → 世界坐标）。
 *
 * 两个动作都已由状态切片接住：新建节点走画布控制器，删除团队由团队切片
 * 产出 team.remove 命令（composition/team-control.js 执行）。这里不再转旧意图。
 *
 * 拖拽跨越两个区域（侧栏起手、画布落点），但它本身注册为 dragLayer 区域：
 * 真拖起来时 requestFocus，松手事件带 regionId，守卫按正常 mutate 处理。
 */

import { createDragLayer } from '../ui/regions/drag-layer.js';
import { createTrashZone, pointInRect } from '../ui/regions/trash-zone.js';
import { createRegionHost } from '../ui/regions/region-host.js';

const REGION_ID = 'dragLayer';

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   getTeams?: () => Array<Object>,
 *   screenToWorld: (clientX: number, clientY: number) => { x: number, y: number },
 *   mainArea: HTMLElement,
 *   animation: import('../ui/contracts/ports.js').AnimationPort,
 *   document?: Document,
 *   window?: any,
 * }} options
 */
export function mountDragDropLayer({
  kernel,
  getTeams = () => [],
  screenToWorld,
  mainArea,
  animation,
  document: doc = globalThis.document,
  window: win = null,
}) {
  if (!doc) throw new Error('mountDragDropLayer: 需要 document');
  if (!kernel) throw new Error('mountDragDropLayer: 需要 kernel');
  if (!kernel.root || !kernel.focus) {
    throw new Error('mountDragDropLayer: 需要 kernel.root / kernel.focus（拖拽层是一个区域）');
  }
  if (typeof screenToWorld !== 'function') throw new Error('mountDragDropLayer: 需要 screenToWorld');

  const teamListEl = doc.getElementById?.('teamList') || doc.querySelector?.('#teamList');
  const trashEl = doc.getElementById?.('trashZone') || doc.querySelector?.('#trashZone');
  const sidebarEl = doc.getElementById?.('sidebar') || doc.querySelector?.('#sidebar');
  if (!teamListEl) throw new Error('mountDragDropLayer: 找不到 #teamList');
  if (!trashEl) throw new Error('mountDragDropLayer: 找不到 #trashZone');
  if (!sidebarEl) throw new Error('mountDragDropLayer: 找不到 #sidebar');

  const trash = createTrashZone({
    trashEl,
    sidebarEl,
    body: doc.body,
  });

  /* “能不能放”由状态决定：没进工作区或不在主区域就返回 null，画布自己弹回。 */
  function getDropTarget(clientX, clientY) {
    if (!kernel.store.getState().workspace?.entered) return null;
    const rect = mainArea?.getBoundingClientRect?.();
    if (!rect || !pointInRect(rect, clientX, clientY)) return null;
    return screenToWorld(clientX, clientY);
  }

  /* 帧调度是动画细节：组装根注入，区域里不出现浏览器全局。 */
  const frameWindow = win || doc.defaultView || globalThis;
  const requestFrame = (fn) => frameWindow.requestAnimationFrame(fn);
  const cancelFrame = (id) => frameWindow.cancelAnimationFrame(id);

  /* 拖拽层是一个真实区域：起手在侧栏、落点在画布，但事件身份统一记在
   * dragLayer 上，松手前先 requestFocus，守卫不用再猜“没有 regionId 是谁”。 */
  const host = createRegionHost({
    id: REGION_ID,
    parent: kernel.root,
    focus: kernel.focus,
    dispatch: kernel.dispatch,
  });

  const region = createDragLayer({
    document: doc,
    window: frameWindow,
    teamListEl,
    animation,
    trash,
    getTeams,
    getDropTarget,
    emit: host.emit,
    requestFocus: () => host.requestFocus(),
    requestFrame,
    cancelFrame,
  });

  let destroyed = false;
  return {
    host,
    region,
    trash,
    getDropTarget,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      region.destroy();
      host.destroy();
      trash.destroy();
    },
  };
}
