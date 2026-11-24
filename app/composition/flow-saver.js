/* ===== 组装根：流程保存器 =====
 * 手动保存：节点 / 连线的改动只调 save() 打“未保存”标记，用户点工作区
 * 右上角的 save 才把一个 PUT 发出去（后端只有整份保存）。
 *
 * 保存状态通过 onStateChange 交给组装根（workspace.save.state.changed），
 * 这样保存按钮与标题读同一份事实。
 *
 * 画布事实来自 `canvas` 切片；团队颜色与流程名从读模型传入
 * （`getTeams` / `getFlows`），保存器不直接认识任何读模型实现。
 */

import { toBackendFlow } from '../ui/state/canvas/codec.js';

/**
 * @param {{
 *   flowApi: import('../ui/contracts/ports.js').FlowApi,
 *   getState: () => any,
 *   getTeams?: () => Array<any>,
 *   getFlows?: () => Array<any>,
 *   onStateChange?: (status: 'idle' | 'dirty' | 'saving' | 'saved' | 'failed') => void,
 * }} options
 */
export function createFlowSaver({
  flowApi,
  getState,
  getTeams = () => [],
  getFlows = () => [],
  onStateChange = () => {},
}) {
  let dirty = false;
  let status = 'idle';
  let version = 0;        // 每次改动 +1；用来判断保存期间有没有又改过
  let pending = null;     // 正在进行的保存。并发调用一律复用它，不再当成失败
  let resetTimer = null;

  function setState(next) {
    status = next;
    onStateChange(next);
  }

  /* 业务改动只打标记，不发请求。 */
  function save() {
    if (!getState().workspace?.selectedId) return;
    version += 1;
    if (dirty) return;
    dirty = true;
    setState('dirty');
  }

  /* 真正落盘。返回是否成功；保存期间又有改动就继续保持未保存。
   *
   * 并发时不能直接返回 false —— 关窗 / 切语言 / 连点保存都可能撞上正在进行的
   * 请求，false 会被当成"保存失败"而拦住用户。这里把同一个 Promise 交出去，
   * 所有调用方等的是同一次结果。 */
  async function flush() {
    if (pending) return pending;

    const state = getState();
    const flowId = state.workspace?.selectedId;
    if (!flowId) return true;

    const snapshot = version;
    setState('saving');
    pending = (async () => {
      try {
        const flow = (getFlows() || []).find((item) => item.id === flowId);
        await flowApi.saveFlow({
          id: flowId,
          ...toBackendFlow({
            nodes: state.canvas?.nodes || [],
            edges: state.canvas?.edges || [],
            teams: getTeams() || [],
            name: flow?.name || '',
          }),
        });
        if (version === snapshot) {
          dirty = false;
          setState('saved');
          /* 绿灯亮一会儿就回落成普通 save，别一直挂着。 */
          if (resetTimer) clearTimeout(resetTimer);
          resetTimer = setTimeout(() => {
            if (!dirty) setState('idle');
          }, 1800);
        } else {
          setState('dirty');     // 保存过程中又改了，依旧算未保存
        }
        return true;
      } catch (error) {
        console.warn('[flow-save]', error);
        setState('failed');
        return false;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  function isDirty() {
    return dirty;
  }

  /* 换流程时清掉上一份的绿/红状态。 */
  function reset() {
    dirty = false;
    version = 0;
    if (resetTimer) clearTimeout(resetTimer);
    if (status !== 'idle') setState('idle');
  }

  return { save, flush, isDirty, reset };
}
