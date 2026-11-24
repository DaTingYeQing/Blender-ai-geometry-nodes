/* ===== 防抖落盘（本地 Adapter）=====
 * 计时与“写失败静默”属于副作用，放适配层；具体写什么由调用方注入的 write 决定。
 * 组装根把 ui/state/persistence.js 的纯编解码接到这里，state 层保持无计时器。
 */

/**
 * @param {{
 *   write: (value: any) => boolean,
 *   delayMs?: number,
 *   timers?: { setTimeout: Function, clearTimeout: Function },
 *   onError?: (error: unknown) => void,
 * }} options
 */
export function createDebouncedWriter({
  write,
  delayMs = 400,
  timers = globalThis,
  onError,
} = {}) {
  let timer = null;
  let pending = null;

  function flushPending() {
    if (!pending) return;
    const value = pending;
    pending = null;
    if (write(value) === false) {
      try {
        onError?.(new Error('持久化写入失败（隐私模式或配额已满）'));
      } catch {
        /* 观察者抛错不影响界面。 */
      }
    }
  }

  function cancel() {
    if (timer == null) return;
    timers.clearTimeout(timer);
    timer = null;
  }

  return {
    /** 记下最新值，延后写入；连续调用只保留最后一次。 */
    save(value) {
      pending = value;
      cancel();
      timer = timers.setTimeout(() => {
        timer = null;
        flushPending();
      }, delayMs);
    },
    /** 立刻写（关闭页面 / 测试用）。 */
    flush() {
      cancel();
      flushPending();
    },
    /** 放弃未写入的变更。 */
    stop() {
      cancel();
      pending = null;
    },
  };
}
