/* ===== 状态切片：工作区（纯 reducer）=====
 * 设置面板里的“选中 / 进入 / 新增 / 删除”都先变成事件，再由这里决定
 * 下一状态与要产出的命令。工作区列表本体属于 FlowReadModel，不在这里镜像。
 *
 * 行为对齐旧 business/workspace.js（已删除，现由 composition/workspace-control.js 镜像）：
 *   - 单人模式点“进入”只启动外部终端，不进入团队画布（entered 保持 null）；
 *   - 团队模式进入后 entered 记录 workspaceId，供画布决定要不要拉内容；
 *   - 新增成功后顺手选中新方框；删除掉当前选中就把选中清掉；
 *   - 移除已进入的那个工作区时，同时退出（entered 置空）。
 * 过期回包按 requestId 丢弃；换屏取消在飞请求（回包同样会被丢弃）。
 */

import { EVENTS, COMMANDS } from '../../contracts/events.js';

function noChange(state) {
  return { state, commands: [] };
}

function withRequest(state, key, value) {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      requests: { ...state.workspace.requests, [key]: value },
    },
  };
}

function requestOf(state, key) {
  return state.workspace?.requests?.[key] || { status: 'idle' };
}

/** 只有“正在等这个 requestId”的结果才算数，其余一律过期。 */
function isCurrent(request, requestId) {
  return requestId != null
    && request.status === 'loading'
    && request.requestId === requestId;
}

function isBusy(state, key) {
  return requestOf(state, key).status === 'loading';
}

/** 可选字符串：空串与非法值都当作“没有”。 */
function optionalId(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** 当前模式：只认 'solo'，其余按团队处理（与 Effects 的归一化保持一致）。 */
function modeOf(state) {
  return state.settings?.mode === 'solo' ? 'solo' : 'team';
}

function selectId(state, workspaceId) {
  if (state.workspace?.selectedId === workspaceId) return noChange(state);
  return {
    state: { ...state, workspace: { ...state.workspace, selectedId: workspaceId } },
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

  switch (type) {
    /* 模式切换：离开当前团队工作区；正在进入的请求跨了模式，直接作废。
     * 晚到的 WORKSPACE_ENTERED 还会被下面的模式守卫拦一次。 */
    case EVENTS.SETTINGS_MODE_CHANGED: {
      const entered = state.workspace?.entered ?? null;
      const loading = requestOf(state, 'enter').status === 'loading';
      if (!entered && !loading) return noChange(state);

      return {
        state: withRequest(
          { ...state, workspace: { ...state.workspace, entered: null } },
          'enter',
          { status: 'idle' },
        ),
        commands: [],
      };
    }

    /* ---------- 选中 ---------- */

    /* 点选与状态层同步共用同一套规则：只改一个 id。 */
    case EVENTS.WORKSPACE_SELECT_CLICKED:
    case EVENTS.WORKSPACE_SELECTED: {
      const workspaceId = optionalId(payload.workspaceId);
      if (!workspaceId) return noChange(state);
      return selectId(state, workspaceId);
    }

    /* ---------- 进入 ---------- */

    case EVENTS.WORKSPACE_ENTER_CLICKED: {
      if (requestId == null || isBusy(state, 'enter')) return noChange(state);

      const mode = modeOf(state);
      const workspaceId = optionalId(state.workspace?.selectedId);

      /* 团队模式必须有一个方框可进；单人模式不需要选中。 */
      if (mode === 'team' && !workspaceId) return noChange(state);

      const command = { requestId, mode };
      if (mode === 'team') command.workspaceId = workspaceId;

      return {
        state: withRequest(state, 'enter', { status: 'loading', requestId }),
        commands: [{ type: COMMANDS.WORKSPACE_ENTER, payload: command }],
      };
    }

    case EVENTS.WORKSPACE_ENTERED: {
      if (!isCurrent(requestOf(state, 'enter'), requestId)) return noChange(state);

      const mode = payload.mode === 'solo' ? 'solo' : 'team';

      /* 用户在请求在飞期间切了模式：跨模式的回包不能落地，
       * 否则会出现“单人模式 + 已进入团队画布”的矛盾状态。 */
      if (mode !== modeOf(state)) return noChange(state);

      /* 单人模式：终端就是工作区，不进入团队画布。 */
      if (mode === 'solo') {
        return {
          state: withRequest(
            { ...state, workspace: { ...state.workspace, entered: null } },
            'enter',
            { status: 'success', requestId },
          ),
          commands: [],
        };
      }

      const workspaceId = optionalId(payload.workspace?.id) ?? optionalId(state.workspace?.selectedId);
      if (!workspaceId) return noChange(state);

      return {
        state: withRequest(
          {
            ...state,
            workspace: {
              ...state.workspace,
              selectedId: workspaceId,
              entered: { mode: 'team', workspaceId },
            },
          },
          'enter',
          { status: 'success', requestId },
        ),
        commands: [],
      };
    }

    case EVENTS.WORKSPACE_ENTER_FAILED: {
      if (!isCurrent(requestOf(state, 'enter'), requestId)) return noChange(state);
      return {
        state: withRequest(state, 'enter', {
          status: 'error',
          requestId,
          error: String(payload.error ?? ''),
        }),
        commands: [],
      };
    }

    /* 离开工作区：不等回包，直接是业务事实。 */
    case EVENTS.WORKSPACE_LEFT:
      if (!state.workspace?.entered) return noChange(state);
      return {
        state: {
          ...state,
          workspace: {
            ...state.workspace,
            entered: null,
            requests: { ...state.workspace.requests, enter: { status: 'idle' } },
          },
        },
        commands: [],
      };

    /* ---------- 新增 ---------- */

    case EVENTS.WORKSPACE_ADD_CLICKED: {
      if (requestId == null || isBusy(state, 'add')) return noChange(state);

      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      const command = { requestId };
      if (name) command.name = name;

      return {
        state: withRequest(state, 'add', { status: 'loading', requestId }),
        commands: [{ type: COMMANDS.WORKSPACE_ADD, payload: command }],
      };
    }

    case EVENTS.WORKSPACE_ADDED: {
      if (!isCurrent(requestOf(state, 'add'), requestId)) return noChange(state);

      const workspaceId = optionalId(payload.workspace?.id);
      const next = workspaceId
        ? { ...state, workspace: { ...state.workspace, selectedId: workspaceId } }
        : state;

      return {
        state: withRequest(next, 'add', { status: 'success', requestId }),
        commands: [],
      };
    }

    case EVENTS.WORKSPACE_ADD_FAILED: {
      if (!isCurrent(requestOf(state, 'add'), requestId)) return noChange(state);
      return {
        state: withRequest(state, 'add', {
          status: 'error',
          requestId,
          error: String(payload.error ?? ''),
        }),
        commands: [],
      };
    }

    /* ---------- 删除 ---------- */

    case EVENTS.WORKSPACE_REMOVE_CLICKED: {
      if (requestId == null || isBusy(state, 'remove')) return noChange(state);

      const workspaceId = optionalId(payload.workspaceId) ?? optionalId(state.workspace?.selectedId);
      if (!workspaceId) return noChange(state);

      return {
        state: withRequest(state, 'remove', { status: 'loading', requestId }),
        commands: [{
          type: COMMANDS.WORKSPACE_REMOVE,
          payload: { requestId, workspaceId },
        }],
      };
    }

    case EVENTS.WORKSPACE_REMOVED: {
      if (!isCurrent(requestOf(state, 'remove'), requestId)) return noChange(state);

      const workspaceId = optionalId(payload.workspaceId);
      const selectedId = state.workspace?.selectedId === workspaceId ? null : state.workspace?.selectedId;
      const entered = state.workspace?.entered?.workspaceId === workspaceId
        ? null
        : state.workspace?.entered;

      return {
        state: withRequest(
          { ...state, workspace: { ...state.workspace, selectedId, entered } },
          'remove',
          { status: 'success', requestId },
        ),
        commands: [],
      };
    }

    case EVENTS.WORKSPACE_REMOVE_FAILED: {
      if (!isCurrent(requestOf(state, 'remove'), requestId)) return noChange(state);
      return {
        state: withRequest(state, 'remove', {
          status: 'error',
          requestId,
          error: String(payload.error ?? ''),
        }),
        commands: [],
      };
    }

    /* ---------- 重命名 ---------- */

    case EVENTS.WORKSPACE_RENAME_SUBMITTED: {
      if (requestId == null || isBusy(state, 'rename')) return noChange(state);

      const workspaceId = optionalId(payload.workspaceId) ?? optionalId(state.workspace?.selectedId);
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!workspaceId || !name) return noChange(state);

      return {
        state: withRequest(state, 'rename', { status: 'loading', requestId }),
        commands: [{
          type: COMMANDS.WORKSPACE_RENAME,
          payload: { requestId, workspaceId, name },
        }],
      };
    }

    case EVENTS.WORKSPACE_RENAMED: {
      if (!isCurrent(requestOf(state, 'rename'), requestId)) return noChange(state);
      return {
        state: withRequest(state, 'rename', { status: 'success', requestId }),
        commands: [],
      };
    }

    case EVENTS.WORKSPACE_RENAME_FAILED: {
      if (!isCurrent(requestOf(state, 'rename'), requestId)) return noChange(state);
      return {
        state: withRequest(state, 'rename', {
          status: 'error',
          requestId,
          error: String(payload.error ?? ''),
        }),
        commands: [],
      };
    }

    /* 保存由画布 / 保存按钮驱动，本切片目前只观察结果（requests.save 未启用）。 */
    case EVENTS.WORKSPACE_SAVED:
    case EVENTS.WORKSPACE_SAVE_FAILED:
    default:
      return noChange(state);
  }
}
