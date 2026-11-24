/* ===== 状态切片：画布（纯 reducer）=====
 * 节点 / 连线的事实来源。规则在 `ui/effects/canvas.js`：控制器把算好的
 * 数组用 CANVAS_PATCHED 写回，本切片只做“整份替换 / 局部替换 / 清空”，
 * 不推断业务。
 *
 * 写入来源（都经组装根控制器）：
 *   - 进入工作区：CANVAS_REPLACED（fromFlow 的结果）；
 *   - 手势与侧栏编辑：CANVAS_PATCHED（新建 / 移动 / 字段 / 删除 / 拉线）；
 *   - 运行与会话：CANVAS_PATCHED（运行态、会话引用）；
 *   - 团队删除：CANVAS_PATCHED（过滤掉该团队的节点与孤儿连线）；
 *   - 离开工作区 / 换屏 / 单人进入：清空。
 *
 * 纯函数：不改传入数组，引用不变时返回原状态。
 */

import { EVENTS } from '../../contracts/events.js';

const EMPTY_NODES = Object.freeze([]);
const EMPTY_EDGES = Object.freeze([]);

function noChange(state) {
  return { state, commands: [] };
}

function canvasOf(state) {
  return state.canvas || { nodes: EMPTY_NODES, edges: EMPTY_EDGES, loaded: false };
}

function sameArray(a, b) {
  return a === b;
}

/**
 * 用给定数组装成新的画布状态；两个数组都没变时返回原状态。
 * @param {import('../../contracts/state.js').UiState} state
 * @param {any[]} nodes
 * @param {any[]} edges
 * @param {boolean} loaded
 */
function apply(state, nodes, edges, loaded) {
  const canvas = canvasOf(state);
  if (sameArray(canvas.nodes, nodes) && sameArray(canvas.edges, edges) && canvas.loaded === loaded) {
    return state;
  }
  return { ...state, canvas: { ...canvas, nodes, edges, loaded } };
}

function clear(state) {
  const canvas = canvasOf(state);
  if (!canvas.loaded && canvas.nodes.length === 0 && canvas.edges.length === 0) return state;
  return apply(state, EMPTY_NODES, EMPTY_EDGES, false);
}

function listOf(value) {
  return Array.isArray(value) ? value : null;
}

/**
 * @param {import('../../contracts/state.js').UiState} state
 * @param {import('../../contracts/events.js').UiEvent} event
 * @returns {import('../../contracts/state.js').UiTransition}
 */
export function reduce(state, event) {
  const type = event?.type;
  const payload = event?.payload || {};

  switch (type) {
    /* 离开工作区 / 单人进入：团队画布没有内容可留。 */
    case EVENTS.WORKSPACE_LEFT: {
      const next = clear(state);
      return next === state ? noChange(state) : { state: next, commands: [] };
    }

    case EVENTS.WORKSPACE_ENTERED: {
      if (payload.mode !== 'solo') return noChange(state);
      const next = clear(state);
      return next === state ? noChange(state) : { state: next, commands: [] };
    }

    /* 切到单人模式：团队画布不再属于当前屏幕。 */
    case EVENTS.SETTINGS_MODE_CHANGED: {
      if (payload.mode !== 'solo') return noChange(state);
      const next = clear(state);
      return next === state ? noChange(state) : { state: next, commands: [] };
    }

    /* 整份装上：进入工作区时由控制器投影 fromFlow。 */
    case EVENTS.CANVAS_REPLACED: {
      const nodes = listOf(payload.nodes);
      const edges = listOf(payload.edges);
      if (!nodes || !edges) return noChange(state);
      const next = apply(state, nodes, edges, true);
      return next === state ? noChange(state) : { state: next, commands: [] };
    }

    /* 局部替换：只认给了的数组，另一个保持原引用。 */
    case EVENTS.CANVAS_PATCHED: {
      const canvas = canvasOf(state);
      const nodes = listOf(payload.nodes) ?? canvas.nodes;
      const edges = listOf(payload.edges) ?? canvas.edges;
      const loaded = payload.loaded === undefined ? canvas.loaded : Boolean(payload.loaded);
      const next = apply(state, nodes, edges, loaded);
      return next === state ? noChange(state) : { state: next, commands: [] };
    }

    default:
      return noChange(state);
  }
}
