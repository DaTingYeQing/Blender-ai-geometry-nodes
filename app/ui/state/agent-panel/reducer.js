/* ===== 状态切片：Agent 配置面板（纯 reducer）=====
 * 处理事件、算出下一状态；需要后端时只产出命令。
 * 不调接口、不碰 DOM、不用时间/随机数，所以可以脱离浏览器测试。
 *
 * 行为对齐现有面板：
 *   - 打开面板重置两份草稿；新建和现有各存一份，切页签不丢输入。
 *   - 现有草稿被用户改过后 dirty=true，晚到的配置不得覆盖。
 *   - 创建成功后不关面板：切到现有页签并选中刚创建的 agent。
 *   - 保存成功后不关面板，只清 dirty。
 *   - 过期响应按 requestId 丢弃。
 */

import { EVENTS, COMMANDS } from '../../contracts/events.js';

const AGENT_PANEL = 'agentPanel';

function noChange(state) {
  return { state, commands: [] };
}

function activeTab(state) {
  return state.panelTabs[AGENT_PANEL] === 'existing' ? 'existing' : 'new';
}

function emptyNewDraft() {
  return { name: '', tools: [] };
}

function emptyExistingDraft() {
  return { agentId: null, name: '', tools: [], loadedFor: null, dirty: false };
}

function initialDrafts() {
  return { agentNew: emptyNewDraft(), agentExisting: emptyExistingDraft() };
}

function activeDraft(state) {
  return activeTab(state) === 'existing'
    ? state.drafts.agentExisting
    : state.drafts.agentNew;
}

function withDraft(state, tab, draft) {
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [tab === 'existing' ? 'agentExisting' : 'agentNew']: draft,
    },
  };
}

function withRequest(state, key, value) {
  return { ...state, requests: { ...state.requests, [key]: value } };
}

function requestOf(state, key) {
  return state.requests[key] || { status: 'idle' };
}

/** 只有“正在等这个 requestId”的结果才算数，其余一律过期。 */
function isCurrent(request, requestId) {
  return requestId != null
    && request.status === 'loading'
    && request.requestId === requestId;
}

/** 新建 / 保存共用一个“确定”按钮，任一在飞都不允许重复提交。 */
function isSaving(state) {
  return requestOf(state, 'agentCreate').status === 'loading'
    || requestOf(state, 'agentSave').status === 'loading';
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
    /* ---------- 面板开关与页签 ---------- */

    case EVENTS.PANEL_OPEN_CLICKED: {
      /* 面板显隐/过渡由 state/panels.js 统一处理；这里只做 Agent 面板自己的
       * 打开副作用：重置草稿、第一次打开时拉工具目录。 */
      if (payload.id !== AGENT_PANEL) return noChange(state);

      let next = { ...state, drafts: initialDrafts() };
      const commands = [];

      /* 工具目录只在第一次打开时拉。失败后不在这里自动重试。 */
      if (requestOf(next, 'tools').status === 'idle' && requestId != null) {
        next = withRequest(next, 'tools', { status: 'loading', requestId });
        commands.push({ type: COMMANDS.TOOLS_LOAD, payload: { requestId } });
      }
      return { state: next, commands };
    }

    case EVENTS.PANEL_TAB_CLICKED: {
      const id = payload.id;
      const tab = payload.tab;
      if (id !== AGENT_PANEL) return noChange(state);
      if (tab !== 'new' && tab !== 'existing') return noChange(state);
      return {
        state: { ...state, panelTabs: { ...state.panelTabs, [id]: tab } },
        commands: [],
      };
    }

    /* ---------- 表单输入 ---------- */

    case EVENTS.AGENT_NAME_CHANGED: {
      const tab = activeTab(state);
      const draft = activeDraft(state);
      const nextDraft = { ...draft, name: String(payload.name ?? '') };
      if (tab === 'existing') nextDraft.dirty = true;
      return { state: withDraft(state, tab, nextDraft), commands: [] };
    }

    case EVENTS.AGENT_TOOL_TOGGLED: {
      const tool = payload.tool;
      if (!tool) return noChange(state);
      const tab = activeTab(state);
      const draft = activeDraft(state);
      const selected = draft.tools.includes(tool);
      const nextDraft = {
        ...draft,
        tools: selected ? draft.tools.filter((item) => item !== tool) : [...draft.tools, tool],
      };
      if (tab === 'existing') nextDraft.dirty = true;
      return { state: withDraft(state, tab, nextDraft), commands: [] };
    }

    /* ---------- 现有 agent 列表 ---------- */

    case EVENTS.AGENT_CARD_CLICKED: {
      const agentId = payload.agentId;
      if (!agentId) return noChange(state);

      let next = withDraft(state, 'existing', {
        agentId,
        name: String(payload.name ?? ''),
        tools: [],
        loadedFor: null,
        dirty: false,
      });
      next = { ...next, panelTabs: { ...next.panelTabs, [AGENT_PANEL]: 'existing' } };

      const commands = [];
      if (requestId != null) {
        next = withRequest(next, 'agentConfig', { status: 'loading', requestId });
        commands.push({
          type: COMMANDS.AGENT_CONFIG_LOAD,
          payload: { requestId, agentId },
        });
      }
      return { state: next, commands };
    }

    /* ---------- 确定：新建 / 保存 ---------- */

    case EVENTS.AGENT_CONFIRM_CLICKED: {
      const tab = activeTab(state);
      const draft = activeDraft(state);
      const name = String(draft.name || '').trim();

      /* UI 校验只做体验；真正的权威在后端。 */
      if (!name) return noChange(state);
      if (tab === 'existing' && !draft.agentId) return noChange(state);
      if (requestId == null || isSaving(state)) return noChange(state);

      if (tab === 'existing') {
        return {
          state: withRequest(state, 'agentSave', { status: 'loading', requestId }),
          commands: [{
            type: COMMANDS.AGENT_CONFIG_SAVE,
            payload: { requestId, agentId: draft.agentId, name, tools: draft.tools.slice() },
          }],
        };
      }
      return {
        state: withRequest(state, 'agentCreate', { status: 'loading', requestId }),
        commands: [{
          type: COMMANDS.AGENT_CREATE,
          payload: { requestId, name, tools: draft.tools.slice() },
        }],
      };
    }

    /* ---------- 后端结果 ---------- */

    case EVENTS.TOOLS_LOADED: {
      if (!isCurrent(requestOf(state, 'tools'), requestId)) return noChange(state);
      /* 工具目录本体属于 ReadModel，由 Effects 保存；这里只记请求状态。 */
      return {
        state: withRequest(state, 'tools', { status: 'success', requestId }),
        commands: [],
      };
    }

    case EVENTS.TOOLS_LOAD_FAILED: {
      if (!isCurrent(requestOf(state, 'tools'), requestId)) return noChange(state);
      /* 换屏取消：在途请求被真正中止，收尾回 idle，不显示成失败。 */
      if (payload.code === 'aborted') {
        return {
          state: withRequest(state, 'tools', { status: 'idle' }),
          commands: [],
        };
      }
      return {
        state: withRequest(state, 'tools', {
          status: 'error',
          requestId,
          error: String(payload.error ?? ''),
        }),
        commands: [],
      };
    }

    case EVENTS.AGENT_CONFIG_LOADED: {
      if (!isCurrent(requestOf(state, 'agentConfig'), requestId)) return noChange(state);
      const agentId = payload.agentId;
      const current = state.drafts.agentExisting;
      if (!agentId || current.agentId !== agentId) return noChange(state);

      const tools = Array.isArray(payload.config?.tools)
        ? payload.config.tools.slice()
        : current.tools;
      const name = !current.dirty
        ? String(payload.agent?.name ?? current.name)
        : current.name;

      const draft = current.dirty
        ? { ...current, loadedFor: agentId }
        : { ...current, name, tools, loadedFor: agentId };

      return {
        state: withRequest(withDraft(state, 'existing', draft), 'agentConfig', {
          status: 'success',
          requestId,
        }),
        commands: [],
      };
    }

    case EVENTS.AGENT_CONFIG_LOAD_FAILED: {
      if (!isCurrent(requestOf(state, 'agentConfig'), requestId)) return noChange(state);
      /* 换屏取消：在途请求被真正中止，收尾回 idle，草稿保持原样。 */
      if (payload.code === 'aborted') {
        return {
          state: withRequest(state, 'agentConfig', { status: 'idle' }),
          commands: [],
        };
      }
      const agentId = payload.agentId;
      const current = state.drafts.agentExisting;
      const draft = agentId && current.agentId === agentId
        ? { ...current, loadedFor: agentId }
        : current;

      return {
        state: withRequest(withDraft(state, 'existing', draft), 'agentConfig', {
          status: 'error',
          requestId,
          error: String(payload.error ?? ''),
        }),
        commands: [],
      };
    }

    case EVENTS.AGENT_CREATED: {
      if (!isCurrent(requestOf(state, 'agentCreate'), requestId)) return noChange(state);
      const agent = payload.agent || {};
      const tools = state.drafts.agentNew.tools.slice();

      const next = {
        ...state,
        panelTabs: { ...state.panelTabs, [AGENT_PANEL]: 'existing' },
        drafts: {
          agentNew: emptyNewDraft(),
          agentExisting: {
            agentId: agent.id ?? null,
            name: String(agent.name ?? ''),
            tools,
            loadedFor: agent.id ?? null,
            dirty: false,
          },
        },
      };
      return {
        state: withRequest(next, 'agentCreate', { status: 'success', requestId }),
        commands: [],
      };
    }

    case EVENTS.AGENT_CREATE_FAILED: {
      if (!isCurrent(requestOf(state, 'agentCreate'), requestId)) return noChange(state);
      return {
        state: withRequest(state, 'agentCreate', {
          status: 'error',
          requestId,
          error: String(payload.error ?? ''),
        }),
        commands: [],
      };
    }

    case EVENTS.AGENT_SAVED: {
      if (!isCurrent(requestOf(state, 'agentSave'), requestId)) return noChange(state);
      const current = state.drafts.agentExisting;
      const draft = {
        ...current,
        name: String(payload.agent?.name ?? current.name),
        loadedFor: current.agentId,
        dirty: false,
      };
      return {
        state: withRequest(withDraft(state, 'existing', draft), 'agentSave', {
          status: 'success',
          requestId,
        }),
        commands: [],
      };
    }

    case EVENTS.AGENT_SAVE_FAILED: {
      if (!isCurrent(requestOf(state, 'agentSave'), requestId)) return noChange(state);
      return {
        state: withRequest(state, 'agentSave', {
          status: 'error',
          requestId,
          error: String(payload.error ?? ''),
        }),
        commands: [],
      };
    }

    default:
      return noChange(state);
  }
}
