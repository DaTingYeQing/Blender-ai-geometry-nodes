/* ===== 状态切片：面板外壳（纯 reducer）=====
 * 面板的显隐与过渡是跨面板的通用事实，不属于任何一个面板的业务切片：
 *   - 打开：panels[id] = true，第一次打开/打断关闭时进 opening；
 *   - 关闭：只进 closing，等动画播完再隐藏；
 *   - anim.done：opening → idle；closing → panels[id] = false + idle。
 *
 * 各面板自己的页签、草稿、在飞请求仍留在各自切片里。
 */

import { EVENTS } from '../contracts/events.js';

const PANEL_IDS = new Set(['logoPanel', 'agentPanel']);

function noChange(state) {
  return { state, commands: [] };
}

function withPanels(state, panels, transitions) {
  return { ...state, panels, transitions };
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
    case EVENTS.PANEL_OPEN_CLICKED: {
      const id = payload.id;
      if (!PANEL_IDS.has(id)) return noChange(state);

      const open = state.panels?.[id] === true;
      const closing = state.transitions?.[id] === 'closing';
      if (open && !closing) return noChange(state);

      return {
        state: withPanels(
          state,
          { ...state.panels, [id]: true },
          { ...state.transitions, [id]: 'opening' },
        ),
        commands: [],
      };
    }

    case EVENTS.PANEL_CLOSE_CLICKED: {
      const id = payload.id;
      if (!PANEL_IDS.has(id)) return noChange(state);
      if (state.panels?.[id] !== true) return noChange(state);
      if (state.transitions?.[id] === 'closing') return noChange(state);

      return {
        state: withPanels(
          state,
          state.panels,
          { ...state.transitions, [id]: 'closing' },
        ),
        commands: [],
      };
    }

    case EVENTS.ANIM_DONE: {
      const name = payload.name;
      if (!PANEL_IDS.has(name)) return noChange(state);

      const current = state.transitions?.[name];
      const phase = payload.phase;
      if (phase) {
        if (current !== phase) return noChange(state);
      } else if (current !== 'closing') {
        return noChange(state);
      }

      if (current === 'opening') {
        return {
          state: withPanels(
            state,
            state.panels,
            { ...state.transitions, [name]: 'idle' },
          ),
          commands: [],
        };
      }

      return {
        state: withPanels(
          state,
          { ...state.panels, [name]: false },
          { ...state.transitions, [name]: 'idle' },
        ),
        commands: [],
      };
    }

    default:
      return noChange(state);
  }
}