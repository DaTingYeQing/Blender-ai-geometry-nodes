/* ===== 动画 Adapter（瞬时）=====
 * animation.md：允许在组装时注入“瞬时完成”的实现，测试不依赖真实动画。
 * 不等、不碰 DOM，其他行为与 DOM 版一致：resolve 之后 Animator 照常上报 anim.done。
 */

/**
 * @returns {import('../../ui/contracts/ports.js').AnimationPort}
 */
export function createImmediateAnimationPort() {
  return {
    waitUntilDone: () => Promise.resolve(),
    /* 瞬时实现也不碰 DOM：调用处照常拿到一个已完成的 Promise。 */
    animate: () => Promise.resolve(),
    prefersReducedMotion: () => true,
  };
}
