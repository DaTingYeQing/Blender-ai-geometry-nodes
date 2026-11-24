/* ===== 组装根：运行控制器 =====
 * 旧业务（画布 / 侧栏意图）只认识「运行这个节点」，真正的运行生命周期在
 * `ui/effects/run.js`：发 runNode、每秒轮询、转录快照、结束条件。
 *
 * 这里负责三件事：
 *   1. 把画布切片 + 当前进入的工作区投影成后端运行体（buildRunRequest，纯函数）；
 *   2. 启动前补拉上游未加载的产物，保证 inputFiles 完整；
 *   3. 把 Effects 发出的事件写回画布切片的运行态字段，并沿用旧的收尾动作
 *      （保存流程、跑完补刷会话）。会话列表写进 AgentReadModel，结果屏正文
 *      由会话控制器按需读取。
 *
 * 跑完补刷只负责“把会话列表写回读模型 + 请求看最新那段”；
 * 读取正文由会话控制器（ui/effects/session.js → session-control）负责。
 */

import { EVENTS } from '../ui/contracts/events.js';
import { t } from '../ui/platform/i18n.js';
import { createRunEffects } from '../ui/effects/run.js';

/** 从画布快照里拼出 runApi.runNode 的请求体；缺字段直接抛业务提示。
 * @param {{ nodes: Array<Object>, edges: Array<Object>, flowId: string | null }} snapshot
 * @param {string} nodeId
 */
export function buildRunRequest(snapshot, nodeId) {
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  const edges = Array.isArray(snapshot?.edges) ? snapshot.edges : [];
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(t('节点不存在'));
  if (!String(node.task || '').trim()) throw new Error(t('请先填写任务，再运行'));

  /* 当前工作区就是进入工作区时选的那个流程。 */
  const flowId = snapshot?.flowId;
  if (!flowId) throw new Error(t('请先选择一个工作区'));

  /* 连线上的产物：把上游选中的文件真实传给这次运行（后端会复制到 inputs/）。 */
  const inputFiles = [];
  for (const edge of edges.filter((item) => item.to === nodeId)) {
    const source = nodes.find((item) => item.id === edge.from);
    for (const name of edge.files || []) {
      const file = (source?.artifacts || []).find((item) => item.name === name);
      if (file?.path) inputFiles.push({ name: file.name, path: file.path });
    }
  }

  return {
    agentId: node.agentId,
    request: {
      flowId,
      node: {
        id: node.id,
        agentId: node.agentId,
        title: node.title || '',
        task: node.task,
        handoffEnabled: node.handoffEnabled !== false,
        sessionMode: node.sessionMode || 'new',
        sessionId: node.sessionId || null,
      },
      inputFiles,
    },
  };
}

function nodesOf(state) {
  return Array.isArray(state?.canvas?.nodes) ? state.canvas.nodes : [];
}

function edgesOf(state) {
  return Array.isArray(state?.canvas?.edges) ? state.canvas.edges : [];
}

function nodeOf(state, nodeId) {
  return nodesOf(state).find((item) => item.id === nodeId) || null;
}

/**
 * @param {{
 *   kernel: ReturnType<typeof import('./ui-kernel.js').createUiKernel>,
 *   agentReadModel: { setSessions: (agentId: string, sessions: Array<Object>) => void },
 *   runApi: import('../ui/contracts/ports.js').RunApi,
 *   agentApi: import('../ui/contracts/ports.js').AgentApi,
 *   artifactApi: import('../ui/contracts/ports.js').ArtifactApi,
 *   runReadModel: ReturnType<typeof import('../ui/effects/run-read-model.js').createRunReadModel>,
 *   saveFlow?: () => void,
 *   scheduler?: { setInterval: (fn: () => any, ms: number) => any, clearInterval: (id: any) => void },
 *   intervalMs?: number,
 * }} options
 */
export function mountRunController({
  kernel,
  agentReadModel,
  runApi,
  agentApi,
  artifactApi,
  runReadModel,
  saveFlow = () => {},
  scheduler,
  intervalMs,
  onReadModelChange = () => {},
}) {
  if (!kernel || typeof kernel.dispatch !== 'function') {
    throw new Error('mountRunController: 需要 kernel');
  }
  if (!agentReadModel || typeof agentReadModel.setSessions !== 'function') {
    throw new Error('mountRunController: 需要 AgentReadModel.setSessions()');
  }

  const effects = createRunEffects({
    runApi,
    agentApi,
    runReadModel,
    emit: (event) => void kernel.dispatch(event),
    scheduler,
    intervalMs,
  });

  let seq = 0;

  const uiState = () => kernel.store.getState();

  /** 把节点数组按 nodeId 局部替换；没命中就什么都不做。 */
  function patchNode(nodeId, fields) {
    const list = nodesOf(uiState());
    let hit = false;
    const next = list.map((node) => {
      if (node.id !== nodeId) return node;
      hit = true;
      return { ...node, ...fields };
    });
    if (!hit) return false;
    void kernel.dispatch({
      type: EVENTS.CANVAS_PATCHED,
      kind: 'mutate',
      payload: { nodes: next },
    });
    return true;
  }

  /** 拉某个节点所属 Agent 的工作区文件；已加载过就返回当前快照。 */
  async function loadArtifacts(nodeId) {
    const node = nodeOf(uiState(), nodeId);
    if (!node || node.artifactsLoaded) return [];

    let artifacts = [];
    try {
      /* 文件都在各自 Agent 的工作区里，不再按 runId 找产物目录。 */
      artifacts = await artifactApi.listFiles({ agentId: node.agentId });
    } catch {
      artifacts = [];
    }

    patchNode(nodeId, { artifacts, artifactsLoaded: true });
    return artifacts;
  }

  /** 启动前把上游节点的工作区文件列表补齐：连线选文件需要它。 */
  async function loadUpstreamArtifacts(nodeId) {
    const state = uiState();
    const nodes = nodesOf(state);
    const edges = edgesOf(state);
    for (const edge of edges.filter((item) => item.to === nodeId)) {
      const source = nodes.find((item) => item.id === edge.from);
      if (source && !source.artifactsLoaded) {
        await loadArtifacts(source.id);
      }
    }
  }

  /** 旧业务处理器调用：校验 + 拼请求 + 交给 Effects。失败抛错，由总线统一提示。 */
  async function start({ id }) {
    const current = nodeOf(uiState(), id);
    if (!current) throw new Error(t('节点不存在'));
    if (current.running) return { ok: true, data: null };

    await loadUpstreamArtifacts(id);

    const state = uiState();
    const { agentId, request } = buildRunRequest({
      nodes: nodesOf(state),
      edges: edgesOf(state),
      flowId: state.workspace?.entered?.workspaceId ?? null,
    }, id);

    seq += 1;
    const result = await effects.startNode({ nodeId: id, agentId, request, requestId: seq });
    if (!result.ok) throw result.error;
    return { ok: true, data: result.data };
  }

  /** 旧业务处理器调用：停表 + abort + 事件；abort 失败也要把环停掉。 */
  async function stop({ id }) {
    const node = nodeOf(uiState(), id);
    seq += 1;
    const result = await effects.stopNode({
      nodeId: id,
      runId: node?.runId || null,
      requestId: seq,
    });
    if (!result.ok) throw result.error;
    return { ok: true };
  }

  /* Effects 结果事件 → 画布切片的运行态 / 读模型的团队会话。 */
  const mirrors = {
    [EVENTS.NODE_RUN_STARTED](payload) {
      const run = payload.run || {};
      patchNode(payload.nodeId, {
        running: true,
        alert: false,
        runId: run.runId || null,
        /* 记住这次用的内部会话 id：默认屏要显示它的名字（会话列表刷新后才存在）。 */
        lastSessionId: run.sessionInternalId || null,
        transcript: [],
        transcriptKey: '',
      });
      /* 把这次的 runId 记进流程；用户点保存后，重进工作区还能按它找回产物。 */
      saveFlow();
    },

    [EVENTS.NODE_RUN_TRANSCRIPT_APPENDED](payload) {
      patchNode(payload.nodeId, {
        transcript: Array.isArray(payload.transcript) ? payload.transcript : [],
        transcriptKey: payload.transcriptKey || '',
      });
    },

    [EVENTS.NODE_RUN_FAILED](payload) {
      patchNode(payload.nodeId, { running: false, alert: true });
      /* 提示由调用链统一负责：旧业务处理器会把启动失败抛回 bus.send，
       * 由总线弹 toast；这里再弹会重复。 */
    },

    [EVENTS.NODE_RUN_STOPPED](payload) {
      const fields = {
        running: false,
        transcript: [],
        transcriptKey: '',
      };
      /* 正常跑完（含后端 failed）才算“需要你看一眼”，并让产物列表下次重读；
       * 中止 / 查不到运行记录只把环停掉。 */
      if (payload.reason === 'completed') {
        fields.alert = true;
        fields.artifactsLoaded = false;
      }
      patchNode(payload.nodeId, fields);
    },

    [EVENTS.TEAM_FOCUS_CHANGED](payload) {
      /* 打开产物屏时才去读起点节点的工作区：
       * 文件属于 Agent 的工作区，不再随运行记录一起返回。 */
      if (payload?.pane !== 'products' || !payload.nodeId) return;
      void loadArtifacts(payload.nodeId);
    },

    [EVENTS.NODE_RUN_SESSIONS_LOADED](payload) {
      agentReadModel.setSessions(payload.agentId, Array.isArray(payload.sessions) ? payload.sessions : []);
      onReadModelChange();

      /* 结果屏正开着这个节点：自动切到最新那段对话。
       * 发新事件即可，会话控制器会先落加载态再读正文。 */
      const focus = uiState().sidebar?.focus;
      if (focus?.pane !== 'result' || focus?.nodeId !== payload.nodeId) return;
      if (!payload.newestSessionId) return;
      void kernel.dispatch({
        type: EVENTS.SESSION_VIEW_CHANGED,
        kind: 'mutate',
        payload: { teamId: payload.agentId, sessionId: payload.newestSessionId },
      });
    },
  };

  const off = kernel.store.subscribeEvent(({ event, accepted }) => {
    if (!accepted) return;
    const mirror = mirrors[event?.type];
    if (!mirror) return;
    mirror(event.payload || {});
  });

  let destroyed = false;
  return {
    start,
    stop,
    loadArtifacts,
    effects,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      off();
      effects.dispose();
    },
  };
}
