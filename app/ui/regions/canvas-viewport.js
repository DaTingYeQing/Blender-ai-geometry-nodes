/* ===== 画布视口：纯数学 =====
 * 平移缩放是“只有画布自己关心”的界面状态，不进 UiState。
 * 这里只做换算与变换字符串，不读 DOM、不挂事件；区域拿到结果后写 transform。
 * 将来接手手势时，pointer 事件也只调这几个函数，不自己抄一份公式。
 */

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 1.1;

/** 夹到合法缩放区间；非法值（NaN/字符串）回退 1。 */
export function clampZoom(zoom) {
  const value = Number(zoom);
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

/** 补全缺省值，保证后续换算不会得到 NaN。 */
export function normalizeView(view = {}) {
  return {
    panX: Number.isFinite(Number(view.panX)) ? Number(view.panX) : 0,
    panY: Number.isFinite(Number(view.panY)) ? Number(view.panY) : 0,
    zoom: clampZoom(view.zoom),
  };
}

export function panBy(view, dx, dy) {
  const base = normalizeView(view);
  const x = Number(dx);
  const y = Number(dy);
  return {
    ...base,
    panX: base.panX + (Number.isFinite(x) ? x : 0),
    panY: base.panY + (Number.isFinite(y) ? y : 0),
  };
}

/**
 * 以 point（画布内坐标，左上角为原点）为锚点缩放：
 * 缩放前后这个点指向的世界坐标必须重合，由此反推新的平移量。
 */
export function zoomAt(view, point, factor) {
  const base = normalizeView(view);
  const px = Number(point?.x);
  const py = Number(point?.y);
  const ratio = clampZoom(base.zoom * (Number(factor) || 1)) / base.zoom;

  return {
    panX: px - (px - base.panX) * ratio,
    panY: py - (py - base.panY) * ratio,
    zoom: base.zoom * ratio,
  };
}

/** 屏幕坐标（clientX/clientY）→ 世界坐标。rect 是画布容器的 getBoundingClientRect()。 */
export function screenToWorld(view, point, rect = {}) {
  const { panX, panY, zoom } = normalizeView(view);
  return {
    x: ((Number(point?.x) - (Number(rect.left) || 0)) - panX) / zoom,
    y: ((Number(point?.y) - (Number(rect.top) || 0)) - panY) / zoom,
  };
}

/** 世界坐标 → 屏幕坐标（主要是给拖拽幽灵/浮层定位用）。 */
export function worldToScreen(view, point, rect = {}) {
  const { panX, panY, zoom } = normalizeView(view);
  return {
    x: (Number(point?.x) || 0) * zoom + panX + (Number(rect.left) || 0),
    y: (Number(point?.y) || 0) * zoom + panY + (Number(rect.top) || 0),
  };
}

/** 世界层的 CSS transform；`transform-origin: 0 0` 由样式保证。 */
export function transformOf(view) {
  const { panX, panY, zoom } = normalizeView(view);
  return `translate(${panX}px, ${panY}px) scale(${zoom})`;
}
