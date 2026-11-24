/* ===== 产物查看器组件注册 =====
 * 类型名集中在 contracts/component-types.js，区域只按名字取组件。
 */

import { ARTIFACT_COMPONENT } from '../../contracts/component-types.js';
import { createArtifactView } from './view.js';

export { ARTIFACT_COMPONENT };

/**
 * @param {{ registry: import('../../contracts/components.js').ComponentRegistry, document: Document }} deps
 */
export function registerArtifactComponents({ registry, document }) {
  registry.register(ARTIFACT_COMPONENT.VIEW, createArtifactView({ document }));
}
