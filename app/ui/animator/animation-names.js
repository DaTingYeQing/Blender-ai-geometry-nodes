/* ===== CSS 过渡名 =====
 * 与 css/modal.css 里的 @keyframes 一一对应。
 * 改 CSS 时同步这里；架构测试会解析 css 并校验这些名字仍然存在，
 * 避免“名字写错 → 只能等超时兜底”。
 */

export const ANIMATION_NAMES = Object.freeze({
  modalIn: 'modalIn',
  modalOut: 'modalOut',
  /* 标题点击时的缩放弹跳（css/layout.css .logo-inner.pop）。 */
  pop: 'shrink',
});
