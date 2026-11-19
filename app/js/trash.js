/* ===== 拖拽时的删除区 =====
 * 全应用只有一个垃圾桶，所以做成单例（和 core/dom.js 里的 toast 同一个路数）：
 * 谁在拖就谁喊一声，不必让拖拽组件互相认识。
 *
 * 两条要点：
 *   1. 位置在"要显示"的那一刻按侧栏矩形算一次 —— 拖拽期间侧栏宽度不会变
 *      （分割栏那一刻按不下去），没必要每帧读一次布局。
 *   2. 指针事件是关着的（它盖在列表上，开了会吃掉卡片的点击），
 *      所以"在不在上面"用几何判断。
 */

let el = null;
let sidebar = null;

function refs() {
  if (!el) el = document.getElementById('trashZone');
  if (!sidebar) sidebar = document.getElementById('sidebar');
  return !!el;
}

/** 出现，并摆到侧栏底部居中 */
export function show() {
  if (!refs() || !sidebar) return;
  const r = sidebar.getBoundingClientRect();
  const w = el.offsetWidth || 130;
  const h = el.offsetHeight || 130;
  el.style.left = r.left + (r.width - w) / 2 + 'px';
  el.style.top = r.bottom - 14 - h + 'px';
  document.body.classList.add('dragging-node');
}

/** 判定区的中心（屏幕坐标）。拖拽时把目标点换成它，跟手的立方体自己会滑过去 —— 那就是吸附动画 */
export function center() {
  if (!refs()) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** 松手删除：红色填满整个轮廓 → 整块渐隐。节奏在 CSS 里，这里只挂类和收尾 */
export function burst() {
  if (!refs()) return;
  el.classList.remove('over');
  el.classList.add('burst');
  // 0.16s 填满 + 0.3s 渐隐，留一点余量再收干净
  setTimeout(() => {
    hide();
    el.classList.remove('burst');
  }, 520);
}

/** 消失（同时恢复画布的裁剪） */
export function hide() {
  document.body.classList.remove('dragging-node');
  if (refs()) el.classList.remove('over');
}

/** 指针在不在垃圾桶上方 */
export function hit(x, y) {
  if (!refs() || !document.body.classList.contains('dragging-node')) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** 每帧更新"指着它了"的高亮 */
export function mark(x, y) {
  if (!refs()) return;
  el.classList.toggle('over', hit(x, y));
}
