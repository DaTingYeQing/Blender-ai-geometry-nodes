/* ===== 产物读模型（Effects 拥有）=====
 * 只读文件内容，按路径缓存。路径即缓存键；同一文件并发只读一次。
 * 产物列表不在这里，属于 RunReadModel（一次运行的 artifacts）。
 */

import { createResourceCache } from './read-model.js';

const keyOf = (path) => `artifact:${path}`;

/**
 * @param {{
 *   artifactApi: import('../contracts/ports.js').ArtifactApi,
 *   cache?: ReturnType<typeof createResourceCache>,
 * }} deps
 */
export function createArtifactReadModel({ artifactApi, cache = createResourceCache() }) {
  function peek(path) {
    const entry = cache.peek(keyOf(path));
    return entry?.status === 'success' ? entry.data : null;
  }

  return {
    /** @param {{ force?: boolean }} [options] */
    readFile(path, { force = false } = {}) {
      if (!path) throw new Error('artifact: 需要 path');
      return cache.load(keyOf(path), (signal) => artifactApi.readFile({ path, signal }), { force });
    },

    /** 完整返回体（可能还有 name/truncated 等字段）。 */
    peekFile(path) {
      return peek(path);
    },

    /** 只要正文；没读过时返回 null。 */
    peekContent(path) {
      const data = peek(path);
      return typeof data?.content === 'string' ? data.content : null;
    },

    requestState(path) {
      const entry = cache.peek(keyOf(path));
      return entry ? { status: entry.status, error: entry.error } : { status: 'idle' };
    },

    invalidate(path) {
      cache.invalidate(keyOf(path));
    },

    clear() {
      cache.clear();
    },

    /** 产物查看器跟着屏幕走：换屏时停在途读取。 */
    abortScreenScoped() {
      return cache.abortAll();
    },
  };
}
