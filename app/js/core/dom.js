/* ===== DOM 小工具 =====
 * 只放无状态的东西。谁都能 import，因为它不持有任何数据，
 * 引它不等于"知道对方的存在"。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 造 SVG 元素（HTML 的 createElement 造不出 SVG，命名空间不对） */
export function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** 造 HTML 元素，顺手挂 class 和 dataset */
export function el(tag, { className, dataset } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (dataset) Object.assign(node.dataset, dataset);
  return node;
}

/* ---------- 轻量提示 ----------
 * 走 API 就一定会失败（网络、校验、权限）。没有提示的话，
 * 用户只会看到"点了没反应"，这比报错更糟。
 * 只在右侧滑入一条，2.4 秒自动消失，不打断任何操作。
 */
let toastHost = null;

export function toast(message) {
  if (!toastHost) {
    toastHost = el('div', { className: 'toast-host' });
    document.body.appendChild(toastHost);
  }
  const item = el('div', { className: 'toast-item' });
  item.textContent = message;
  toastHost.appendChild(item);
  // 下一帧再加 in，让它有入场过渡（同一帧加会跳过）
  requestAnimationFrame(() => item.classList.add('in'));
  setTimeout(() => {
    item.classList.remove('in');
    setTimeout(() => item.remove(), 220);
  }, 2400);
}
