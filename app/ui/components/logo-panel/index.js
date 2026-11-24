/* ===== 设置面板组件注册 =====
 * 类型名集中在 contracts/component-types.js，区域只按名字取组件。
 */

import { LOGO_PANEL_COMPONENT } from '../../contracts/component-types.js';
import { createLogoNav } from './nav.js';
import { createLangToggle } from './lang-toggle.js';
import { createModeToggle } from './mode-toggle.js';
import { createWorkspaceList } from './workspace-list.js';
import { createWorkspaceActions } from './workspace-actions.js';

export { LOGO_PANEL_COMPONENT };

/**
 * @param {{ registry: import('../../contracts/components.js').ComponentRegistry, document: Document }} deps
 */
export function registerLogoPanelComponents({ registry, document }) {
  registry.register(LOGO_PANEL_COMPONENT.NAV, createLogoNav({ document }));
  registry.register(LOGO_PANEL_COMPONENT.LANG_TOGGLE, createLangToggle({ document }));
  registry.register(LOGO_PANEL_COMPONENT.MODE_TOGGLE, createModeToggle({ document }));
  registry.register(LOGO_PANEL_COMPONENT.WORKSPACE_LIST, createWorkspaceList({ document }));
  registry.register(LOGO_PANEL_COMPONENT.WORKSPACE_ACTIONS, createWorkspaceActions({ document }));
}
