/* ===== Effects：运行生命周期 =====
 * startNode / stopNode → RunApi → 事件；轮询节奏、停止条件、转录快照都在这里。
 *
 * 纪律：
 *   - 不碰 DOM / 状态，只认注入的 Port 与 ReadModel。
 *   - 运行体由组装根从当前流程快照投影后传入，不在这里偷读状态。
 *   - 后端没有推送：启动后每秒 getRun，结束/失败/中止/查不到时停表。
 *   - 转录只有真的变了才发事件，避免每秒白触发一轮渲染。
 */

import { EVENTS, EVENT_KINDS } from '../contracts/events.js';

function messageOf(error) {
  return String(error?.message || error || '');
}

/** 转录只比较“条数:最后一条长度:最后一条状态”，够用且不扫全量。 */
function transcriptKeyOf(entries) {
  const last = entries[entries.length - 1];
  return `${entries.length}:${last?.text?.length || 0}:${last?.status || ''}`;
}

/** 默认节奏：真实环境用 setInterval；测试注入手动调度器。 */
const defaultScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
};

/**
 * @param {{
 *   runApi: import('../contracts/ports.js').RunApi,
 *   agentApi: import('../contracts/ports.js').AgentApi,
 *   runReadModel: ReturnType<typeof import('./run-read-model.js').createRunReadModel>,
 *   emit: (event: import('../contracts/events.js').UiEvent) => void,
 *   scheduler?: { setInterval: (fn: () => any, ms: number) => any, clearInterval: (id: any) => void },
 *   intervalMs?: number,
 * }} deps
 */
export function createRunEffects({
  runApi,
  agentApi,
  runReadModel,
  emit,
  scheduler = defaultScheduler,
  intervalMs = 1000,
}) {
  if (typeof emit !== 'function') throw new Error('createRunEffects: 需要注入 emit(event)');
  if (!runApi || typeof runApi.runNode !== 'function') {
    throw new Error('createRunEffects: 需要 runApi');
  }
  if (!runReadModel) throw new Error('createRunEffects: 需要 runReadModel');

  /** nodeId -> { runId, agentId, timer, busy, transcriptKey } */
  const trackers = new Map();
  /** 启动请求进行中：防止连点两次各自发一遍 runNode。 */
  const starting = new Set();

  function fire(type, payload = {}) {
    emit({ type, kind: EVENT_KINDS[type] || 'mutate', payload });
  }

  function failRun({ nodeId, agentId, requestId, error }) {
    const payload = { nodeId, agentId, error: messageOf(error) };
    if (requestId != null) payload.requestId = requestId;
    if (error?.code) payload.code = error.code;
    if (error?.status) payload.status = error.status;
    fire(EVENTS.NODE_RUN_FAILED, payload);
  }

  function stopTimer(tracker) {
    if (tracker?.timer == null) return;
    scheduler.clearInterval(tracker.timer);
    tracker.timer = null;
  }

  function startTimer(nodeId) {
    const tracker = trackers.get(nodeId);
    if (!tracker || tracker.timer != null) return;
    /* 回调返回 Promise，测试调度器可以 await 一轮轮询；真实 setInterval 会忽略返回值。 */
    tracker.timer = scheduler.setInterval(() => tick(nodeId), intervalMs);
  }

  /** 结束并清掉表；completed 才会顺手补刷会话。 */
  async function finish(nodeId, { reason, run = null }) {
    const tracker = trackers.get(nodeId);
    if (!tracker) return;
    stopTimer(tracker);
    trackers.delete(nodeId);

    fire(EVENTS.NODE_RUN_STOPPED, {
      nodeId,
      agentId: tracker.agentId,
      runId: tracker.runId,
      reason,
      status: run?.status ?? null,
      run,
    });

    if (reason === 'completed') await refreshSessions(nodeId, tracker);
  }

  /* 跑完补一次 Agent 列表：这次新产生的会话要立刻出现在结果屏的下拉里。 */
  async function refreshSessions(nodeId, tracker) {
    if (!tracker?.agentId || typeof agentApi?.listAgents !== 'function') return;
    let agent;
    try {
      const agents = await agentApi.listAgents();
      agent = Array.isArray(agents)
        ? agents.find((item) => item.id === tracker.agentId)
        : null;
    } catch {
      return; // 刷新失败不影响运行结果
    }
    if (!agent) return;

    const sessions = Array.isArray(agent.sessions) ? agent.sessions : [];
    const newest = sessions.find((item) => item.piSessionId);
    fire(EVENTS.NODE_RUN_SESSIONS_LOADED, {
      nodeId,
      agentId: tracker.agentId,
      sessions,
      newestSessionId: newest?.piSessionId || null,
    });
  }

  async function tick(nodeId) {
    const tracker = trackers.get(nodeId);
    if (!tracker || tracker.busy) return;
    tracker.busy = true;

    let run;
    try {
      run = await runReadModel.getRun(tracker.runId, { force: true });
    } catch {
      tracker.busy = false;
      /* 查不到运行记录（服务停了 / 记录被清理）：停表，只把环停掉。 */
      if (trackers.get(nodeId) === tracker) await finish(nodeId, { reason: 'lost' });
      return;
    }
    tracker.busy = false;

    /* 查询期间用户点了停止：tracker 已被删，晚到的回包直接丢。 */
    if (trackers.get(nodeId) !== tracker) return;

    if (run?.status === 'running') {
      const entries = Array.isArray(run.transcript) ? run.transcript : [];
      const key = transcriptKeyOf(entries);
      if (key !== tracker.transcriptKey) {
        tracker.transcriptKey = key;
        fire(EVENTS.NODE_RUN_TRANSCRIPT_APPENDED, {
          nodeId,
          runId: tracker.runId,
          transcript: entries,
          transcriptKey: key,
        });
      }
      return;
    }

    await finish(nodeId, { reason: 'completed', run });
  }

  /**
   * 启动一条运行。返回 { ok, data|error }，方便旧业务处理器把启动失败原样抛给总线。
   * 事件照常通过 emit 回到状态层，返回值只用于调用链。
   */
  async function startNode({ nodeId, agentId = null, request, requestId }) {
    if (!nodeId) return { ok: false, error: new Error('run: 需要 nodeId') };
    if (trackers.has(nodeId) || starting.has(nodeId)) {
      return { ok: true, data: null };
    }

    starting.add(nodeId);
    let run;
    try {
      run = await runApi.runNode(request);
    } catch (error) {
      starting.delete(nodeId);
      failRun({ nodeId, agentId, requestId, error });
      return { ok: false, error };
    }
    starting.delete(nodeId);

    if (!run?.runId) {
      const error = new Error('运行没有返回 runId');
      failRun({ nodeId, agentId, requestId, error });
      return { ok: false, error };
    }

    const tracker = {
      nodeId,
      runId: run.runId,
      agentId,
      timer: null,
      busy: false,
      transcriptKey: '',
    };
    trackers.set(nodeId, tracker);
    runReadModel.seedRun(run.runId, run);

    fire(EVENTS.NODE_RUN_STARTED, { nodeId, agentId, run, requestId });
    startTimer(nodeId);
    return { ok: true, data: run };
  }

  /** 停止一条运行：先停表再 abort，abort 失败也把界面上的环停掉。 */
  async function stopNode({ nodeId, runId = null, requestId } = {}) {
    const tracker = trackers.get(nodeId);
    const effectiveRunId = tracker?.runId || runId || null;
    const agentId = tracker?.agentId ?? null;

    if (tracker) {
      stopTimer(tracker);
      trackers.delete(nodeId);
    }

    let error = null;
    if (effectiveRunId) {
      try {
        await runApi.abortRun({ id: effectiveRunId });
      } catch (caught) {
        error = caught;
      }
    }

    fire(EVENTS.NODE_RUN_STOPPED, {
      nodeId,
      agentId,
      runId: effectiveRunId,
      reason: 'aborted',
      status: null,
      run: null,
      requestId,
    });

    return error ? { ok: false, error } : { ok: true };
  }

  /** 页面卸载：只停表，不再产生事件。 */
  function dispose() {
    for (const tracker of trackers.values()) stopTimer(tracker);
    trackers.clear();
    starting.clear();
  }

  return { startNode, stopNode, dispose, readModel: runReadModel };
}
