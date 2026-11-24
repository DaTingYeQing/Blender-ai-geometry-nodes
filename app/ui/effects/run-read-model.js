/* ===== 运行读模型（Effects 拥有）=====
 * 一次运行的只读快照：状态、转录、产物列表。
 * 轮询节奏属于 effects/run.js；这里只负责合并“同一次运行”的新数据，并按 runId 隔离缓存。
 */

import { createResourceCache } from './read-model.js';

const keyOf = (runId) => `run:${runId}`;

/**
 * @param {{
 *   runApi: import('../contracts/ports.js').RunApi,
 *   cache?: ReturnType<typeof createResourceCache>,
 * }} deps
 */
export function createRunReadModel({ runApi, cache = createResourceCache() }) {
  function peek(runId) {
    const entry = cache.peek(keyOf(runId));
    return entry?.status === 'success' ? entry.data : null;
  }

  function patch(runId, updater) {
    const current = peek(runId);
    if (!current) return;
    cache.setData(keyOf(runId), updater(current));
  }

  return {
    /** @param {{ force?: boolean }} [options] */
    getRun(runId, { force = false } = {}) {
      if (!runId) throw new Error('run: 需要 runId');
      return cache.load(keyOf(runId), (signal) => runApi.getRun({ id: runId, signal }), { force });
    },

    peekRun(runId) {
      return peek(runId);
    },

    /** 启动成功后把 runNode 的返回值直接种进缓存，首次轮询前就有快照。 */
    seedRun(runId, run) {
      if (!runId || !run || typeof run !== 'object') return;
      cache.setData(keyOf(runId), run);
    },

    requestState(runId) {
      const entry = cache.peek(keyOf(runId));
      return entry ? { status: entry.status, error: entry.error } : { status: 'idle' };
    },

    /** 轮询回来先合并状态，再决定是否追加转录/产物。 */
    updateRun(runId, changes) {
      if (!changes || typeof changes !== 'object') return;
      patch(runId, (current) => ({ ...current, ...changes }));
    },

    /** 只追加新转录；空数组或未缓存时什么都不做。 */
    appendTranscript(runId, entries) {
      if (!Array.isArray(entries) || entries.length === 0) return;
      patch(runId, (current) => ({
        ...current,
        transcript: [...(Array.isArray(current.transcript) ? current.transcript : []), ...entries],
      }));
    },

    setArtifacts(runId, artifacts) {
      if (!Array.isArray(artifacts)) return;
      patch(runId, (current) => ({ ...current, artifacts }));
    },

    invalidate(runId) {
      cache.invalidate(keyOf(runId));
    },

    clear() {
      cache.clear();
    },
  };
}
