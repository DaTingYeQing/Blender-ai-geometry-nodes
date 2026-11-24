/* ===== 流程读模型（Effects 拥有）=====
 * 工作区列表 + 单份 flow 快照。后端只有整份保存，所以保存成功后直接
 * applySavedFlow 回写缓存，不再额外 GET。
 */

import { createResourceCache } from './read-model.js';

const LIST = 'flows';
const keyOf = (id) => `flow:${id}`;

/**
 * @param {{
 *   flowApi: import('../contracts/ports.js').FlowApi,
 *   cache?: ReturnType<typeof createResourceCache>,
 * }} deps
 */
export function createFlowReadModel({ flowApi, cache = createResourceCache() }) {
  function peekFlow(id) {
    const entry = cache.peek(keyOf(id));
    return entry?.status === 'success' ? entry.data : null;
  }

  return {
    getFlows() {
      return cache.load(LIST, (signal) => flowApi.listFlows({ signal }));
    },

    /** @param {{ force?: boolean }} [options] */
    getFlow(id, { force = false } = {}) {
      if (!id) throw new Error('flow: 需要 id');
      return cache.load(keyOf(id), (signal) => flowApi.getFlow({ id, signal }), { force });
    },

    peekFlows() {
      const entry = cache.peek(LIST);
      return entry?.status === 'success' && Array.isArray(entry.data) ? entry.data : [];
    },

    peekFlow,

    /** 列表项 / 单份快照的请求状态（列表用 'list'）。 */
    requestState(id = 'list') {
      const entry = cache.peek(id === 'list' ? LIST : keyOf(id));
      return entry ? { status: entry.status, error: entry.error } : { status: 'idle' };
    },

    /**
     * 保存成功后回写：更新详情缓存，并把列表里的名字一起改掉。
     * 走 setData 会抬 seq，旧请求晚到也覆盖不回来。
     */
    applySavedFlow(flow) {
      if (!flow?.id) return;
      cache.setData(keyOf(flow.id), flow);

      const entry = cache.peek(LIST);
      if (entry?.status !== 'success' || !Array.isArray(entry.data)) return;
      cache.setData(
        LIST,
        entry.data.map((item) => (item.id === flow.id ? { ...item, name: flow.name ?? item.name } : item)),
      );
    },

    /**
     * 新建成功后：已缓存列表就追加；没缓存过就等下次 getFlows 拉全量。
     * 详情不预填，避免把“只有 id/name”的列表项当成完整 flow。
     */
    addFlow(flow) {
      if (!flow?.id) return;
      const entry = cache.peek(LIST);
      if (entry?.status !== 'success' || !Array.isArray(entry.data)) return;
      if (entry.data.some((item) => item.id === flow.id)) return;
      cache.setData(LIST, [...entry.data, flow]);
    },

    /** 删除成功后：详情作废，列表里去掉。 */
    removeFlow(id) {
      cache.invalidate(keyOf(id));
      const entry = cache.peek(LIST);
      if (entry?.status !== 'success' || !Array.isArray(entry.data)) return;
      cache.setData(LIST, entry.data.filter((item) => item.id !== id));
    },

    /** 重命名成功后：列表名字与已缓存的详情一起改；没缓存的部分不预填。 */
    renameFlow(id, name) {
      if (!id || !name) return;

      const detail = cache.peek(keyOf(id));
      if (detail?.status === 'success' && detail.data) {
        cache.setData(keyOf(id), { ...detail.data, name });
      }

      const entry = cache.peek(LIST);
      if (entry?.status !== 'success' || !Array.isArray(entry.data)) return;
      cache.setData(
        LIST,
        entry.data.map((item) => (item.id === id ? { ...item, name } : item)),
      );
    },

    invalidateFlow(id) {
      cache.invalidate(keyOf(id));
    },

    invalidateFlows() {
      cache.invalidate(LIST);
    },

    clear() {
      cache.clear();
    },
  };
}
