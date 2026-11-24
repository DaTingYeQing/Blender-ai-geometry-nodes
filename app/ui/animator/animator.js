/* ===== Animator（动画插件）=====
 * animation.md：动画不是第四段流程，是状态之间的过渡。
 *
 * 它只做三件事：
 *   1. 比较 prev / next 两个状态快照，命中规则才播。
 *   2. 维护自己的取消令牌；状态又变了，旧过渡立刻作废。
 *   3. 真正需要等待时，播完上报 anim.done，由 reducer 决定隐藏/继续。
 *
 * 它不写 UI State、不决定显隐、不读业务数据。规则里的 DOM 引用由组装根传入。
 * 规则可以随时注册 / 注销（全局 TransitionManager 用这一点收集各区域的过渡）。
 */

import { EVENTS } from '../contracts/events.js';

/**
 * @typedef {Object} AnimatorRule
 * @property {string} name                 规则名（必须唯一），用于取消与 isRunning
 * @property {'opening' | 'closing' | string} [phase] 过渡阶段；会原样带回 anim.done
 * @property {string} [target]             上报时的事件名（默认同 name），用于“一个目标多条规则”
 * @property {(prev: any, next: any) => boolean} when
 * @property {(ctx: { prev: any, next: any, token: number, isCurrent: () => boolean })
 *   => Promise<void> | void} play
 */

/**
 * @param {{
 *   emit: (event: any) => void,
 *   rules?: AnimatorRule[],
 *   onRunningChange?: (running: string[]) => void,
 * }} options
 */
export function createAnimator({ emit, rules = [], onRunningChange } = {}) {
  if (typeof emit !== 'function') throw new Error('createAnimator: 需要 emit(event)');

  /** @type {Map<string, AnimatorRule>} */
  const managed = new Map();

  /** @type {Map<string, { token: number }>} */
  const running = new Map();
  let seq = 0;

  function notifyRunning() {
    if (typeof onRunningChange !== 'function') return;
    try {
      onRunningChange([...running.keys()]);
    } catch {
      /* 观察者抛错不能影响动画本身。 */
    }
  }

  function register(rule) {
    if (!rule?.name || typeof rule.when !== 'function' || typeof rule.play !== 'function') {
      throw new Error('createAnimator: 规则需要 name / when / play');
    }
    if (managed.has(rule.name)) throw new Error(`createAnimator: 规则重名：${rule.name}`);
    managed.set(rule.name, rule);
    return rule;
  }

  for (const rule of rules) register(rule);

  function cancel(name) {
    if (name) {
      if (!running.delete(name)) return;
      notifyRunning();
      return;
    }
    if (running.size === 0) return;
    running.clear();
    notifyRunning();
  }

  function unregister(name) {
    if (!managed.delete(name)) return false;
    cancel(name);
    return true;
  }

  function start(rule, prev, next) {
    const token = ++seq;
    running.set(rule.name, { token });
    notifyRunning();

    const isCurrent = () => running.get(rule.name)?.token === token;

    let result;
    try {
      result = rule.play({ prev, next, token, isCurrent });
    } catch {
      running.delete(rule.name);
      notifyRunning();
      return;
    }

    Promise.resolve(result)
      .then(() => {
        if (!isCurrent()) return;          // 已被新的过渡取代，旧回调直接丢弃
        running.delete(rule.name);
        notifyRunning();
        /* payload.name 是目标（如面板 id）；phase 让 reducer 区分开/关，
         * 避免“关闭途中的旧完成回调”把刚打开的过渡误判为已结束。 */
        const payload = { name: rule.target || rule.name };
        if (rule.phase) payload.phase = rule.phase;
        emit({ type: EVENTS.ANIM_DONE, kind: 'mutate', payload });
      })
      .catch(() => {
        /* 播放失败就当没播过：不阻塞状态，也不上报完成。 */
        if (isCurrent()) {
          running.delete(rule.name);
          notifyRunning();
        }
      });
  }

  /**
   * 每次状态变化调用一次。命中规则就播；不再命中的旧过渡作废。
   * @param {any} prev
   * @param {any} next
   */
  function apply(prev, next) {
    for (const rule of managed.values()) {
      if (rule.when(prev, next)) {
        start(rule, prev, next);
      } else if (running.has(rule.name)) {
        cancel(rule.name);
      }
    }
  }

  return {
    apply,
    cancel,
    register,
    unregister,
    isRunning: (name) => running.has(name),
    getRunning: () => [...running.keys()],
    hasRule: (name) => managed.has(name),
  };
}
