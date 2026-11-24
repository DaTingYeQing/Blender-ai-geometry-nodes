/* ===== Reporter（记录员）=====
 * region.md 5.1.4：订阅事件流和聚焦变化，只做日志、调试、统计，不参与决策、不改状态。
 *
 * 它挂在 store 的“每条事件都会通知”的钩子上，所以能看见：
 *   - 被守卫丢掉的 mutate（accepted=false）；
 *   - observe 事件（不进状态，但必须能到达出口）；
 *   - 正常采纳的事件。
 * 聚焦变化单独从 FocusManager 订阅，避免与派发事件重复记录。
 *
 * 环形缓冲只保留最近 capacity 条；统计计数独立累计，不受裁剪影响。
 */

/**
 * @param {{
 *   store: { subscribeEvent: (fn: (info: { event: any, accepted: boolean }) => void) => () => void },
 *   focus?: { subscribe: (fn: (path: string[]) => void) => () => void } | null,
 *   capacity?: number,
 *   sink?: ((record: object) => void) | null,
 *   now?: () => number,
 *   ignoreTypes?: string[],
 * }} options
 */
export function createReporter({
  store,
  focus = null,
  capacity = 200,
  sink = null,
  now = () => Date.now(),
  ignoreTypes = [],
} = {}) {
  if (!store || typeof store.subscribeEvent !== 'function') {
    throw new Error('createReporter: 需要 store.subscribeEvent');
  }

  const limit = Math.max(1, Number(capacity) || 1);
  const ignore = new Set(ignoreTypes);

  /** @type {object[]} */
  const records = [];
  let seq = 0;
  let lastAt = null;

  const byType = new Map();
  const byKind = new Map();
  let rejected = 0;
  let observed = 0;

  function emit(record) {
    if (sink) {
      try {
        sink(record);
      } catch {
        /* 出口坏了不影响记录本身。 */
      }
    }
  }

  function push(record) {
    seq += 1;
    const at = now();
    const full = {
      seq,
      at,
      gapMs: lastAt === null ? 0 : Math.max(0, at - lastAt),
      ...record,
    };
    lastAt = at;

    byType.set(full.type, (byType.get(full.type) || 0) + 1);
    byKind.set(full.kind, (byKind.get(full.kind) || 0) + 1);
    if (full.kind === 'observe') observed += 1;
    if (full.accepted === false) rejected += 1;

    records.push(full);
    if (records.length > limit) records.splice(0, records.length - limit);

    emit(full);
  }

  const offEvent = store.subscribeEvent(({ event, accepted }) => {
    const type = event?.type;
    if (typeof type !== 'string' || ignore.has(type)) return;

    push({
      source: 'event',
      type,
      kind: event.kind || 'unknown',
      regionId: event.regionId || null,
      requestId: event.requestId ?? null,
      accepted: Boolean(accepted),
    });
  });

  const offFocus = focus
    ? focus.subscribe((path) => {
      push({
        source: 'focus',
        type: 'focus.path',
        kind: 'focus',
        path: [...path],
        accepted: true,
      });
    })
    : null;

  function snapshot() {
    return records.map((record) => ({ ...record }));
  }

  function stats() {
    return {
      total: seq,
      buffered: records.length,
      rejected,
      observed,
      byType: Object.fromEntries(byType),
      byKind: Object.fromEntries(byKind),
    };
  }

  function clear() {
    records.length = 0;
    byType.clear();
    byKind.clear();
    rejected = 0;
    observed = 0;
    seq = 0;
    lastAt = null;
  }

  function destroy() {
    offEvent();
    offFocus?.();
  }

  return { snapshot, stats, clear, destroy };
}
