/* ===== 侧栏组件注册 =====
 * 类型名集中在 contracts/component-types.js，区域只按名字取组件。
 */

import { SIDEBAR_COMPONENT } from '../../contracts/component-types.js';
import { createTeamList } from './team-list.js';

export { SIDEBAR_COMPONENT };

/**
 * @param {{ registry: import('../../contracts/components.js').ComponentRegistry, document: Document }} deps
 */
export function registerSidebarComponents({ registry, document }) {
  registry.register(SIDEBAR_COMPONENT.TEAM_LIST, createTeamList({ document }));
}
