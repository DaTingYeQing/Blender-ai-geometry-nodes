/* ===== 组件：画布场景容器 =====
 * 只提供一个定位原点：连线层与节点都以世界坐标绝对定位在它里面。
 * 子节点由注册表按 key 追加，场景自己不重排 children。
 */

/**
 * @param {{document: Document}} deps
 */
export function createCanvasScene({ document: doc }) {
  return function canvasScene() {
    const root = doc.createElement('div');
    root.className = 'canvas-scene';

    return {
      el: root,
      update() {},
      destroy() {
        root.remove();
      },
    };
  };
}
