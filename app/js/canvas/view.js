/* ===== 画布视图：坐标换算 + 平移缩放 =====
 * 世界层的 transform 只在这里改；"屏幕 ↔ 世界"的换算也只从这里出。
 * 以前拖拽组件里还手算过一遍（绕过这里），两套公式两处维护，现在只留这一处。
 *
 * 平移缩放是纯粹的界面状态：只有画布自己关心，所以不上总线，
 * 直接写 store（silent，不广播 —— 这个值每帧都变，广播出去会让所有组件白重绘）。
 */

/** 立方体在布局里的边长。必须和 canvas.css 里 .ghost-cube-lockup svg 的 width/height 一致。 */
export const CUBE_SIZE = 90;

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.1;

export function createView({ store, canvasEl, worldEl }) {
  const view = () => store.getState().view.canvas;

  /** 把当前平移缩放写进世界层的 transform */
  function apply() {
    const { panX, panY, zoom } = view();
    worldEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  /** 屏幕坐标 → 世界坐标。只在鼠标事件里调，不在渲染循环里调。 */
  function screenToWorld(clientX, clientY) {
    const rect = canvasEl.getBoundingClientRect();
    const { panX, panY, zoom } = view();
    return {
      x: (clientX - rect.left - panX) / zoom,
      y: (clientY - rect.top - panY) / zoom,
    };
  }

  /** 节点中心 (x,y) 在世界坐标里的外框。纯算术，不碰 DOM —— 每帧给 N 条连线算锚点也扛得住。 */
  function boxOf(x, y) {
    return {
      left: x - CUBE_SIZE / 2,
      top: y - CUBE_SIZE / 2,
      cx: x,
      cy: y,
      width: CUBE_SIZE,
      height: CUBE_SIZE,
    };
  }

  function setCanvas(patch) {
    store.commit((s) => {
      Object.assign(s.view.canvas, patch);
    }, { silent: true });
    apply();
  }

  let panning = false;
  let px0 = 0, py0 = 0, panX0 = 0, panY0 = 0;

  function stopPan() {
    if (!panning) return;
    panning = false;
    canvasEl.classList.remove('dragging');
  }

  function bindPanZoom() {
    canvasEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const { panX, panY } = view();
      panning = true;
      px0 = e.clientX; py0 = e.clientY;
      panX0 = panX; panY0 = panY;
      canvasEl.classList.add('dragging');
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!panning) return;
      setCanvas({ panX: panX0 + (e.clientX - px0), panY: panY0 + (e.clientY - py0) });
    });

    window.addEventListener('mouseup', stopPan);
    window.addEventListener('blur', stopPan);   // 失焦兜底，别让画布粘在鼠标上

    // 滚轮缩放：以鼠标所指的点为中心。
    // 缩放前后鼠标指向的"世界坐标"必须重合 → 由此反推新的平移量。
    canvasEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvasEl.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { panX, panY, zoom } = view();

      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
      const ratio = next / zoom;

      setCanvas({
        panX: mx - (mx - panX) * ratio,
        panY: my - (my - panY) * ratio,
        zoom: next,
      });
    }, { passive: false });
  }

  return { apply, screenToWorld, boxOf, bindPanZoom };
}
