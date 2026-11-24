/* ===== 动画 Adapter（DOM）=====
 * api.md：animation.md 规定“动画 Adapter 是唯一允许直接操作 WAAPI / CSS 动画的地方”。
 * 这个文件就是那个地方：向上只暴露 AnimationPort（等一次过渡结束），
 * 不解释业务、不读写状态、不决定显隐。
 *
 * 三层兜底：
 *   1. prefers-reduced-motion 时立即完成 —— 但依旧 resolve，Animator 照常上报
 *      anim.done，状态不会被跳过（animation.md 要求）。
 *   2. 只认指定 animationName 的 animationend；animationcancel 也视为结束。
 *   3. 超时兜底，避免动画被系统关掉 / 元素被替换时永远卡在 closing。
 */

export const DEFAULT_ANIMATION_TIMEOUT_MS = 320;

/**
 * @param {{ window?: any, timeoutMs?: number }} [options]
 * @returns {import('../../ui/contracts/ports.js').AnimationPort}
 */
export function createDomAnimationPort({
  window: win = globalThis,
  timeoutMs = DEFAULT_ANIMATION_TIMEOUT_MS,
} = {}) {
  function prefersReducedMotion() {
    try {
      return win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch {
      return false;
    }
  }

  /**
   * @param {Element | null} element
   * @param {{ animationName?: string, timeoutMs?: number }} [options]
   */
  function waitUntilDone(element, options = {}) {
    const animationName = options.animationName;
    const limit = Number.isFinite(options.timeoutMs) ? options.timeoutMs : timeoutMs;

    if (!element?.addEventListener) return Promise.resolve();
    if (prefersReducedMotion()) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        element.removeEventListener('animationend', onEnd);
        element.removeEventListener('animationcancel', onEnd);
        win.clearTimeout(timer);
        resolve();
      };

      const onEnd = (event) => {
        if (animationName && event?.animationName !== animationName) return;
        finish();
      };

      const timer = win.setTimeout(finish, limit);
      element.addEventListener('animationend', onEnd);
      element.addEventListener('animationcancel', onEnd);
    });
  }

  const animation = {
    waitUntilDone,
    prefersReducedMotion,

    /**
     * 播放一次 WAAPI 动画并等它结束。Adapter 是唯一碰 element.animate 的地方；
     * 元素不支持 / 旧浏览器 / 减少动效时立即完成。
     * @param {Element | null} element
     * @param {Keyframe[]} keyframes
     * @param {KeyframeAnimationOptions} [options]
     */
    animate(element, keyframes, options = {}) {
      if (!element || typeof element.animate !== 'function') return Promise.resolve();
      if (prefersReducedMotion()) return Promise.resolve();
      try {
        return element.animate(keyframes, options).finished.catch(() => {});
      } catch {
        return Promise.resolve();
      }
    },
  };

  return animation;
}
