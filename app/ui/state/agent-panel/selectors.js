/* ===== Selectors：Agent 配置面板的派生数据 =====
 * 纯函数：输入 UiState（以及必要的只读数据），输出展示值或能力判断。
 * 不产生副作用、不调接口、不改 state。
 *
 * “能不能点确定”在这里判断；Effects 不负责这个。
 */

const AGENT_PANEL = 'agentPanel';

/** 当前页签：'new' | 'existing' */
export function agentTab(state) {
  return state.panelTabs[AGENT_PANEL] === 'existing' ? 'existing' : 'new';
}

/** 当前页签对应的草稿 */
export function activeDraft(state) {
  return agentTab(state) === 'existing'
    ? state.drafts.agentExisting
    : state.drafts.agentNew;
}

/** 是否正在保存 / 创建（两者共用一个“确定”按钮的忙碌态） */
export function isSaving(state) {
  return state.requests.agentCreate?.status === 'loading'
    || state.requests.agentSave?.status === 'loading';
}

/** 名称是否有效（只 trim 判断非空，业务校验仍在后端） */
export function isNameValid(state) {
  return String(activeDraft(state).name || '').trim().length > 0;
}

/** 现有页签是否已经选中一个 agent */
export function hasSelectedAgent(state) {
  return agentTab(state) !== 'existing' || Boolean(state.drafts.agentExisting.agentId);
}

/** 确定按钮是否可用 */
export function canConfirm(state) {
  return !isSaving(state) && isNameValid(state) && hasSelectedAgent(state);
}

/** 某个工具在当前草稿里是否被选中 */
export function isToolSelected(state, tool) {
  return activeDraft(state).tools.includes(tool);
}

/** 现有页签选中的 agentId（新建页签为 null） */
export function selectedAgentId(state) {
  return agentTab(state) === 'existing'
    ? state.drafts.agentExisting.agentId
    : null;
}

/** 现有草稿是否被用户改过（决定晚到的配置能不能覆盖） */
export function isExistingDirty(state) {
  return state.drafts.agentExisting.dirty === true;
}

/** 请求状态，找不到时按 idle */
export function requestStatus(state, key) {
  return state.requests[key]?.status || 'idle';
}

/** 请求错误文案，找不到时为空串 */
export function requestError(state, key) {
  return state.requests[key]?.error || '';
}
