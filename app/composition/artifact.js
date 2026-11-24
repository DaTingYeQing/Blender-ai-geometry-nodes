/* ===== 组装根：产物查看器 =====
 * 只做接线：把已建好的 ArtifactReadModel 和内核交给区域。
 * 打开 / 关闭事件与 artifact.read 命令都在新状态里；正文缓存由 Effects 维护。
 */

import { createArtifactRegion } from '../ui/regions/artifact.js';

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   readModel: ReturnType<typeof import('../ui/effects/artifact-read-model.js').createArtifactReadModel>,
 *   document?: Document,
 *   translate?: (text: string) => string,
 * }} options
 */
export function mountArtifactView({ kernel, readModel, document: doc = globalThis.document, translate }) {
  if (!kernel) throw new Error('mountArtifactView: 需要 kernel');
  if (!readModel) throw new Error('mountArtifactView: 需要 ArtifactReadModel');
  if (!doc) throw new Error('mountArtifactView: 需要 document');

  const { store, focus, root, dispatch } = kernel;

  const region = createArtifactRegion({
    parent: root,
    focus,
    dispatch,
    store,
    readModel,
    document: doc,
    translate,
  });

  return {
    region: region.region,
    refresh: region.refresh,
    destroy: () => region.destroy(),
  };
}
