/* ===== 过渡期间的显隐投影 =====
 * animation.md 规则 2/3：显隐的权威值在 state，Animator 只负责“等”。
 * 这里把 panels / transitions 投影成遮罩上的类名，纯函数，不碰状态。
 */

/**
 * @param {HTMLElement} overlay
 * @param {any} state
 * @param {string} panelId
 */
export function applyOverlayPresence(overlay, state, panelId) {
  if (!overlay || !overlay.classList) return;

  const open = state?.panels?.[panelId] === true;
  const closing = state?.transitions?.[panelId] === 'closing';

  /* closing 期间不能再挂 open，否则入场/退场两个 keyframes 会打架。 */
  overlay.classList.toggle('open', open && !closing);
  overlay.classList.toggle('closing', closing);

  if (overlay.setAttribute) {
    overlay.setAttribute('aria-hidden', open || closing ? 'false' : 'true');
  }
}
