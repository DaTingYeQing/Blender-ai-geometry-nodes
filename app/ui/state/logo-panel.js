/* ===== 状态切片：设置面板（logoPanel）=====
 * 只管这个面板自己的界面事实：停在哪一页。
 * 打开 / 关闭 / 过渡由 state/panels.js 统一处理；
 * 语言 / 模式是全局设置，归 settings.js；工作区选择归 workspace 切片。
 */

import { EVENTS } from '../contracts/events.js';

const PANEL_ID = 'logoPanel';
const TABS = ['lang', 'workspace'];

function noChange(state) {
  return { state, commands: [] };
}

/**
 * @param {import('../contracts/state.js').UiState} state
 * @param {import('../contracts/events.js').UiEvent} event
 * @returns {import('../contracts/state.js').UiTransition}
 */
export function reduce(state, event) {
  const type = event?.type;
  const payload = event?.payload || {};

  switch (type) {
    case EVENTS.PANEL_TAB_CLICKED: {
      if (payload.id !== PANEL_ID) return noChange(state);
      if (!TABS.includes(payload.tab)) return noChange(state);
      if (state.panelTabs?.[PANEL_ID] === payload.tab) return noChange(state);
      return {
        state: {
          ...state,
          panelTabs: { ...state.panelTabs, [PANEL_ID]: payload.tab },
        },
        commands: [],
      };
    }

    default:
      return noChange(state);
  }
}
