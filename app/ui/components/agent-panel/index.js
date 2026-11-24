/* ===== Agent 面板组件注册 =====
 * 类型名集中在这里，区域只按名字取组件，不认识具体实现。
 */

import { AGENT_PANEL_COMPONENT } from '../../contracts/component-types.js';
import { createAgentTabs } from './tabs.js';
import { createAgentList } from './agent-list.js';
import { createNameField } from './name-field.js';
import { createToolPicker } from './tool-picker.js';
import { createActions } from './actions.js';
import { createHeading } from './heading.js';
import { createStatus } from './status.js';

export { AGENT_PANEL_COMPONENT };

/**
 * @param {{ registry: import('../../contracts/components.js').ComponentRegistry, document: Document }} deps
 */
export function registerAgentPanelComponents({ registry, document }) {
  registry.register(AGENT_PANEL_COMPONENT.TABS, createAgentTabs({ document }));
  registry.register(AGENT_PANEL_COMPONENT.LIST, createAgentList({ document }));
  registry.register(AGENT_PANEL_COMPONENT.HEADING, createHeading({ document }));
  registry.register(AGENT_PANEL_COMPONENT.NAME_FIELD, createNameField({ document }));
  registry.register(AGENT_PANEL_COMPONENT.TOOL_PICKER, createToolPicker({ document }));
  registry.register(AGENT_PANEL_COMPONENT.STATUS, createStatus({ document }));
  registry.register(AGENT_PANEL_COMPONENT.ACTIONS, createActions({ document }));
}
