/* ===== 状态切片：产物查看器（纯 reducer）=====
 * 只记“打开了哪个文件、预览到哪一步”，正文留在 ArtifactReadModel。
 * 用户点侧栏产物 → artifact.open.clicked（带 requestId）→ 产出 artifact.read；
 * 效果层把结果回成 artifact.opened / artifact.open.failed，按 path 丢弃过期回包。
 */

import { EVENTS, COMMANDS } from '../../contracts/events.js';

function noChange(state) {
  return { state, commands: [] };
}

function pathOf(payload) {
  return typeof payload?.path === 'string' ? payload.path : '';
}

function closed(state) {
  const artifact = state.artifact || {};
  if (!artifact.open) return noChange(state);
  return {
    state: {
      ...state,
      artifact: {
        open: false,
        name: '',
        path: '',
        color: '',
        previewable: true,
        status: 'idle',
        error: '',
      },
    },
    commands: [],
  };
}

/**
 * @param {import('../../contracts/state.js').UiState} state
 * @param {import('../../contracts/events.js').UiEvent} event
 * @returns {import('../../contracts/state.js').UiTransition}
 */
export function reduce(state, event) {
  const type = event?.type;
  const payload = event?.payload || {};
  const requestId = event?.requestId;
  const current = state.artifact || {};

  switch (type) {
    case EVENTS.ARTIFACT_OPEN_CLICKED: {
      const path = pathOf(payload);
      if (!path || requestId == null) return noChange(state);

      return {
        state: {
          ...state,
          artifact: {
            open: true,
            name: typeof payload.name === 'string' && payload.name ? payload.name : path,
            path,
            color: typeof payload.color === 'string' ? payload.color : '',
            previewable: true,
            status: 'loading',
            error: '',
          },
        },
        commands: [{ type: COMMANDS.ARTIFACT_READ, payload: { requestId, path, name: payload.name || '' } }],
      };
    }

    case EVENTS.ARTIFACT_OPENED: {
      if (!current.open || pathOf(payload) !== current.path) return noChange(state);
      return {
        state: {
          ...state,
          artifact: {
            ...current,
            previewable: payload.previewable !== false,
            status: 'success',
            error: '',
          },
        },
        commands: [],
      };
    }

    case EVENTS.ARTIFACT_OPEN_FAILED: {
      if (!current.open || pathOf(payload) !== current.path) return noChange(state);
      /* 换屏取消：在途读取被真正中止，收尾回 idle，不显示成失败。 */
      if (payload.code === 'aborted') {
        return {
          state: {
            ...state,
            artifact: { ...current, status: 'idle', error: '' },
          },
          commands: [],
        };
      }
      return {
        state: {
          ...state,
          artifact: {
            ...current,
            status: 'error',
            error: String(payload.error ?? ''),
          },
        },
        commands: [],
      };
    }

    case EVENTS.ARTIFACT_CLOSE_CLICKED:
      return closed(state);

    /* 退出工作区时画布和查看器一起收掉。 */
    case EVENTS.WORKSPACE_LEFT:
      return closed(state);

    default:
      return noChange(state);
  }
}
