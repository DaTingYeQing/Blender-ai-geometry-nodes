/* ===== 全局过渡协调者（TransitionManager）=====
 * animation.md：路由切换、弹窗与背景联动不属于单个区域，
 * 需要一个全局协调者决定“这段时间是否锁输入”。
 *
 * 形态选择：全局一个 Animator 实例 + 各区域注册规则（而不是每种过渡一个协调者）。
 *   - 规则自带 lock 标记：lock=true 的规则在跑时，整页视为“过渡中”。
 *   - 它不碰 DOM、不写状态；锁只通过 subscribe 暴露，由组装根投影到页面。
 *
 * 说明：当前只有 Agent 面板的开 / 关规则（都不锁输入）。路由与语言切换的
 * 锁规则随对应迁移接入，这里不预造。
 */

import { createAnimator } from './animator.js';

/**
 * @param {{
 *   emit: (event: any) => void,
 *   rules?: Array<import('./animator.js').AnimatorRule & { lock?: boolean }>,
 * }} [options]
 */
export function createTransitionManager({ emit, rules = [] } = {}) {
  /** @type {Map<string, boolean>} 规则名 → 是否锁输入 */
  const lockByName = new Map();
  const listeners = new Set();
  let locked = false;

  const animator = createAnimator({
    emit,
    onRunningChange: (running) => recompute(running),
  });

  function recompute(running = animator.getRunning()) {
    const next = running.some((name) => lockByName.get(name) === true);
    if (next === locked) return;
    locked = next;
    const snapshot = { locked, running: [...running] };
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        /* 观察者抛错不影响过渡本身。 */
      }
    }
  }

  /**
   * 注册一条过渡规则。同名的重复注册直接报错（由 Animator 校验）。
   * @param {import('./animator.js').AnimatorRule & { lock?: boolean }} rule
   */
  function register(rule) {
    animator.register(rule);
    lockByName.set(rule.name, rule.lock === true);
    return rule;
  }

  /** 注销规则；若它正在跑，一并取消并重新计算锁。 */
  function unregister(name) {
    if (!animator.unregister(name)) return false;
    lockByName.delete(name);
    recompute();
    return true;
  }

  for (const rule of rules) register(rule);

  return {
    apply: animator.apply,
    cancel: animator.cancel,
    register,
    unregister,
    getRunning: animator.getRunning,
    hasRule: animator.hasRule,
    isLocked: () => locked,
    /**
     * 订阅锁的变化（只在 true/false 翻转时回调）。
     * @param {(snapshot: { locked: boolean, running: string[] }) => void} listener
     * @returns {() => void}
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      listeners.clear();
      animator.cancel();
    },
  };
}
