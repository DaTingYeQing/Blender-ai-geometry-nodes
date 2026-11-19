/* ===== 命令总线：全应用唯一的跨模块通道 =====
 * 组件想做事 → send(意图名) → 总线查表找到登记过的 handler → handler 干活。
 * 组件不知道谁处理，handler 不知道谁点的。
 *
 * 两条纪律（写在代码里，不是写在文档里）：
 *   1. 所有 handler 一律 async，返回 { ok, data, error }。
 *      今天 return 一个内存对象，明天换成真实网络请求，调用方一行不用改。
 *      一旦允许同步返回，调用点就会习惯性不等结果，换后端时得回头改遍每一处。
 *   2. 同一个意图只允许登记一次。重复登记直接抛错 —— 这种错静默下去最难查。
 *
 * emit / on 是旁路广播，只用于"提示"这类没有对应状态的事件（如 toast）。
 * 状态变化不走它，走 store 的订阅 —— 否则谁改了什么就又说不清了。
 */

export function createBus({ dev = false } = {}) {
  const handlers = new Map();
  const channels = new Map();

  /** 登记一个意图的处理器。整份代码里，这是唯一知道"某意图归谁管"的地方。 */
  function handle(intent, fn) {
    if (handlers.has(intent)) {
      throw new Error(`[bus] 意图被重复登记：${intent}`);
    }
    handlers.set(intent, fn);
  }

  /**
   * 发出一个意图。
   * 永远不抛错 —— 失败也返回 { ok:false }，这样调用点不必套 try/catch，
   * 但也不会出现"某个按钮点了没反应、控制台也没动静"的情况。
   */
  async function send(intent, payload = {}) {
    const fn = handlers.get(intent);
    if (!fn) {
      if (dev) throw new Error(`[bus] 意图没有登记：${intent}`);
      console.warn(`[bus] 意图没有登记：${intent}`);
      return { ok: false, error: `unhandled:${intent}` };
    }
    try {
      const res = await fn(payload);
      return res ?? { ok: true };
    } catch (err) {
      emit('toast', err?.message || String(err));
      return { ok: false, error: err };
    }
  }

  function on(channel, fn) {
    if (!channels.has(channel)) channels.set(channel, new Set());
    channels.get(channel).add(fn);
    return () => channels.get(channel)?.delete(fn);
  }

  function emit(channel, data) {
    channels.get(channel)?.forEach((fn) => fn(data));
  }

  return { handle, send, on, emit };
}
