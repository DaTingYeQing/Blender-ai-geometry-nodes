/* ===== UI Store：单方向循环的入口 =====
 * View → dispatch(event) → reduce → state → 通知订阅者 → 执行 commands → Effects
 * Effects 把结果再作为事件 emit 回来，形成闭环。
 *
 * reduce 保持纯函数；这里只负责“跑一次转移、通知一次、把命令交出去”。
 * 同一个事件里，先更新状态再执行命令：界面先显示 loading，再等接口。
 */

import { commandPayloadProblem } from '../contracts/events.js';
import { shouldAccept } from './guard.js';

/** 订阅者出错时不打断其余订阅者，但要让错误浮出来（异步抛，能被全局捕获）。 */
function defaultOnError(error) {
  queueMicrotask(() => {
    throw error;
  });
}

/**
 * @param {{
 *   initialState: import('../contracts/state.js').UiState,
 *   reduce: (state: any, event: any) => import('../contracts/state.js').UiTransition,
 *   execute?: (command: import('../contracts/events.js').UiCommand) => Promise<unknown> | unknown,
 *   onError?: (error: unknown) => void,
 * }} options
 */
export function createUiStore({ initialState, reduce, execute, onError = defaultOnError } = {}) {
  if (!initialState) throw new Error('createUiStore: 需要 initialState');
  if (typeof reduce !== 'function') throw new Error('createUiStore: 需要 reduce');

  let state = initialState;
  /** @type {Set<(state: any, previous: any) => void>} */
  const listeners = new Set();
  /** @type {Set<(info: { event: any, accepted: boolean }) => void>} */
  const eventListeners = new Set();
  let requestSeq = 0;

  function getState() {
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('store.subscribe: 需要函数');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function notify(previous) {
    for (const listener of [...listeners]) {
      try {
        listener(state, previous);
      } catch (error) {
        onError(error);
      }
    }
  }

  /**
   * 记录员（Reporter）用：每条事件都通知一次，包括被守卫丢掉的和 observe。
   * 记录员自己抛错不能打断业务，所以这里吞掉异常。
   * @param {{ event: any, accepted: boolean }} info
   */
  function notifyEvent(info) {
    for (const listener of [...eventListeners]) {
      try {
        listener(info);
      } catch {
        /* 记录员坏了，不能影响状态推进。 */
      }
    }
  }

  /**
   * @param {import('../contracts/events.js').UiEvent} event
   * @returns {Promise<any>} 处理完命令后的最新状态
   */
  /**
   * 需要后端的界面动作要有 requestId：派发方统一补，View 和组件不用各自生成。
   * 接口回包（tools.loaded 等）自己带 requestId，不会被改写。
   */
  function withRequestId(event) {
    if (!event || event.kind !== 'mutate' || event.requestId !== undefined) return event;
    requestSeq += 1;
    return { ...event, requestId: requestSeq };
  }

  async function dispatch(rawEvent) {
    const event = withRequestId(rawEvent);
    /* accepted 的语义是“事件过了入口守卫”，不是“状态引用变了”。
     * 有些合法意图（如任务输入）由组装根的桥执行、不改新状态；
     * 它们必须让 subscribeEvent 看到 accepted=true，否则会被误当成丢弃。 */
    const accepted = shouldAccept(state, event);
    const transition = reduce(state, event) || { state, commands: [] };
    const changed = transition.state !== state;

    if (changed) {
      const previous = state;
      state = transition.state;
      notify(previous);
    }

    /* 状态先落地，再通知记录员；命令执行前上报，顺序与界面一致。 */
    notifyEvent({ event, accepted });

    for (const command of transition.commands || []) {
      if (typeof execute !== 'function') continue;
      /* 风格约定：命令必须先登记形状。坏命令不执行，也不悄悄吞掉。 */
      const problem = commandPayloadProblem(command);
      if (problem) {
        onError(new Error(problem));
        continue;
      }
      await execute(command);
    }

    return state;
  }

  return {
    getState,
    subscribe,
    dispatch,
    /**
     * @param {(info: { event: any, accepted: boolean }) => void} listener
     * @returns {() => void}
     */
    subscribeEvent(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('store.subscribeEvent: 需要函数');
      }
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
}
