/* ===== 业务：画布对象（节点、连线）=====
 * 数据一致性规则全在这里：删节点连带删线、同方向连线唯一、反向成对分道。
 * 这些以前散在 scene.js 和 interactions.js 里，一半在渲染里、一半在手势里。
 */

import { BIZ } from '../core/intent.js';
import { hsl } from '../core/theme.js';
import { t } from '../core/i18n.js';

const BOW = 40;   // 反向成对的两条线各弯开多少（世界像素）

export function registerCanvas(bus, { api, getState, commit, saveFlow }) {
  const pollers = new Map();   // nodeId -> 定时器（运行进度轮询）

  bus.handle(BIZ.NODE_CREATE, async ({ agentId, x, y }) => {
    const node = await api.createNode({ agentId, x, y });
    commit((s) => {
      s.business.nodes.push(node);
    });
    saveFlow();
    return { ok: true, data: node };
  });

  bus.handle(BIZ.NODE_MOVE, async ({ id, x, y }) => {
    await api.moveNode({ id, x, y });
    commit((s) => {
      const node = s.business.nodes.find((n) => n.id === id);
      if (node) { node.x = x; node.y = y; }
    });
    saveFlow();
    return { ok: true };
  });

  /* 节点任务：节点的"要干什么"。任务属于节点，不属于团队 ——
   * 同一个团队可以放好多个副本，每个副本干的事可以不同。 */
  bus.handle(BIZ.NODE_TASK_SET, async ({ id, task }) => {
    const text = String(task ?? '');
    await api.setTask({ id, task: text });
    commit((s) => {
      const node = s.business.nodes.find((n) => n.id === id);
      if (node) node.task = text;
    });
    saveFlow();
    return { ok: true };
  });

  /* 上游产物开关：决定运行时要不要把上游产物目录告诉这个节点。
   * 后端字段叫 handoffEnabled，默认开。 */
  bus.handle(BIZ.NODE_HANDOFF_SET, async ({ id, handoffEnabled }) => {
    const value = handoffEnabled !== false;
    await api.setHandoff({ id, handoffEnabled: value });
    commit((s) => {
      const node = s.business.nodes.find((n) => n.id === id);
      if (node) node.handoffEnabled = value;
    });
    saveFlow();
    return { ok: true };
  });

  /* 会话模式：这次运行是新开会话，还是接着上一次的会话。
   * 后端字段叫 sessionMode（'new' / 'reuse'）；复用哪个会话由 sessionId 决定。 */
  bus.handle(BIZ.NODE_SESSION_SET, async ({ id, sessionMode }) => {
    const mode = sessionMode === 'reuse' ? 'reuse' : 'new';
    await api.setSessionMode({ id, sessionMode: mode });
    commit((s) => {
      const node = s.business.nodes.find((n) => n.id === id);
      if (node) node.sessionMode = mode;
    });
    saveFlow();
    return { ok: true };
  });

  /* 复用哪一段对话：后端要求的是 Agent 内部的 session.id（不是 pi 的会话 id）。 */
  bus.handle(BIZ.NODE_SESSION_SELECT, async ({ id, sessionId }) => {
    const value = sessionId || null;
    await api.setSession({ id, sessionId: value });
    commit((s) => {
      const node = s.business.nodes.find((n) => n.id === id);
      if (node) node.sessionId = value;
    });
    saveFlow();
    return { ok: true };
  });

  bus.handle(BIZ.NODE_REMOVE, async ({ id }) => {
    await api.removeNode({ id });
    commit((s) => {
      s.business.nodes = s.business.nodes.filter((n) => n.id !== id);
      s.business.edges = s.business.edges.filter((e) => e.from !== id && e.to !== id);

      // 展开归属到具体节点：删掉谁，谁的扩展就关。哪怕同团队还有别的副本也不保留。
      const f = s.business.focus;
      if (f.teamId) {
        const ownedGone = f.nodeId ? !s.business.nodes.some((n) => n.id === f.nodeId) : false;
        const teamGone = !s.business.nodes.some((n) => n.agentId === f.teamId);
        if (ownedGone || teamGone) {
          s.business.focus = { teamId: null, nodeId: null, edgeId: null, pane: 'default' };
        }
      }
    });
    saveFlow();
    return { ok: true };
  });

  /* 节点提醒：raise / clear 只改一个布尔，界面怎么表现不归这里管。
   * 将来"谁触发 raise"由后端推过来（agent 干完了、出错了、有新产物），
   * 现在通过意图就能挂上，UI 那一侧不用改。 */
  bus.handle(BIZ.NODE_ALERT_RAISE, async ({ id }) => {
    await api.raiseAlert({ id });
    commit((s) => {
      const node = s.business.nodes.find((n) => n.id === id);
      if (node) node.alert = true;
    });
    return { ok: true };
  });

  bus.handle(BIZ.NODE_ALERT_CLEAR, async ({ id }) => {
    await api.clearAlert({ id });
    commit((s) => {
      const node = s.business.nodes.find((n) => n.id === id);
      if (node) node.alert = false;
    });
    return { ok: true };
  });

  /* 运行：把节点和当前工作区交给后端，然后定时查进度。
   * 后端没有推送，只能轮询；"在跑 / 跑完 / 失败"只认后端返回的 status。
   * 注意 alert 和 running 争的是立方体右上角同一个位置，
   * 这里先按"跑完把环换成感叹号"处理，两者不会同时为真。
   *
   * TODO(拼装后): 请求体的字段映射搬进 api.js 的 runNode；
   * 后端补推送端点后删掉轮询，改成订阅。业务层只该说"运行这个节点"。 */
  bus.handle(BIZ.NODE_RUN_START, async ({ id }) => {
    const state = getState();
    const node = state.business.nodes.find((n) => n.id === id);
    if (!node) throw new Error(t('节点不存在'));
    if (node.running) return { ok: true };
    if (!String(node.task || '').trim()) throw new Error(t('请先填写任务，再运行'));

    /* 当前工作区就是进入工作区时选的那个流程。 */
    const flowId = state.business.workspace.selectedId;
    if (!flowId) throw new Error(t('请先选择一个工作区'));

    /* 连线上的产物：把上游选中的文件真实传给这次运行（后端会复制到 inputs/）。
     * 上游可能还没加载过产物列表，先按它的 runId 拉一次。 */
    for (const edge of state.business.edges.filter((item) => item.to === node.id)) {
      const source = state.business.nodes.find((n) => n.id === edge.from);
      if (source?.runId && !source.artifactsLoaded) {
        await bus.send(BIZ.ARTIFACTS_LOAD, { id: source.id });
      }
    }

    const latest = getState();
    const inputFiles = [];
    for (const edge of latest.business.edges.filter((item) => item.to === node.id)) {
      const source = latest.business.nodes.find((n) => n.id === edge.from);
      for (const name of edge.files || []) {
        const file = (source?.artifacts || []).find((item) => item.name === name);
        if (file?.path) inputFiles.push({ name: file.name, path: file.path });
      }
    }

    let run;
    try {
      run = await api.runNode({
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
      });
    } catch (error) {
      /* 启动都没成功也算一次失败：节点上留感叹号，提示由总线统一弹。 */
      commit((s) => {
        const target = s.business.nodes.find((n) => n.id === id);
        if (target) {
          target.running = false;
          target.alert = true;
        }
      });
      throw error;
    }

    commit((s) => {
      const target = s.business.nodes.find((n) => n.id === id);
      if (target) {
        target.running = true;
        target.alert = false;
        target.runId = run.runId;
        /* 记住这次用的内部会话 id：默认屏要显示它的名字（会话列表刷新后才存在）。 */
        target.lastSessionId = run.sessionInternalId || null;
        target.transcript = [];
        target.transcriptKey = '';
      }
    });
    watchRun(id, run.runId);
    /* 把这次的 runId 记进流程；用户点保存后，重进工作区还能按它找回产物。 */
    saveFlow();
    return { ok: true, data: run };
  });

  bus.handle(BIZ.NODE_RUN_STOP, async ({ id }) => {
    const node = getState().business.nodes.find((n) => n.id === id);
    if (node?.runId) await api.abortRun({ id: node.runId });
    stopPolling(id);
    commit((s) => {
      const target = s.business.nodes.find((n) => n.id === id);
      if (target) {
        target.running = false;
        target.transcript = [];
        target.transcriptKey = '';
      }
    });
    return { ok: true };
  });

  function stopPolling(nodeId) {
    const timer = pollers.get(nodeId);
    if (timer) clearInterval(timer);
    pollers.delete(nodeId);
  }

  /* 每秒看一次进度；跑完或失败就停表，并把节点右上角换成"需要你看一眼"。
   * 运行中顺手把 transcript 同步到节点上，侧栏「结果屏」直接渲染。
   * TODO(拼装后): 后端有推送后整段删掉，换成订阅 run 状态。 */
  function watchRun(nodeId, runId) {
    stopPolling(nodeId);
    pollers.set(nodeId, setInterval(async () => {
      let run;
      try {
        run = await api.getRun({ id: runId });
      } catch {
        // 查不到运行记录（服务停了 / 记录被清理）：不再轮询，只把环停掉。
        stopPolling(nodeId);
        commit((s) => {
          const node = s.business.nodes.find((n) => n.id === nodeId);
          if (node) {
            node.running = false;
            node.transcript = [];
            node.transcriptKey = '';
          }
        });
        return;
      }

      /* 运行中：只有转录真的变了才 commit，别每秒白触发一轮渲染。 */
      if (run.status === 'running') {
        const entries = Array.isArray(run.transcript) ? run.transcript : [];
        const last = entries[entries.length - 1];
        const key = `${entries.length}:${last?.text?.length || 0}:${last?.status || ''}`;
        const node = getState().business.nodes.find((n) => n.id === nodeId);
        if (node && node.transcriptKey !== key) {
          commit((s) => {
            const target = s.business.nodes.find((n) => n.id === nodeId);
            if (!target) return;
            target.transcript = entries;
            target.transcriptKey = key;
          });
        }
        return;
      }

      stopPolling(nodeId);
      commit((s) => {
        const node = s.business.nodes.find((n) => n.id === nodeId);
        if (node) {
          node.running = false;
          node.alert = true;
          /* 有新产物了：下次打开产物屏要重新读，别拿旧列表。 */
          node.artifactsLoaded = false;
          /* 实时转录收起来，结果屏回到"完整会话"。 */
          node.transcript = [];
          node.transcriptKey = '';
        }
      });

      /* 跑完补一次 Agent 列表：这次新产生的会话要立刻出现在结果屏的下拉里。 */
      refreshSessions(nodeId);
    }, 1000));
  }

  /* 运行结束后刷新这个节点的 Agent 会话，并把结果屏切到最新那段（如果正开着）。 */
  async function refreshSessions(nodeId) {
    const node = getState().business.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    let agent;
    try {
      const agents = await api.listAgents();
      agent = agents.find((item) => item.id === node.agentId);
    } catch {
      return;   // 刷新失败不影响运行结果
    }
    if (!agent) return;

    commit((s) => {
      const team = s.business.teams.find((t) => t.id === node.agentId);
      if (team) team.sessions = agent.sessions || [];
    });

    const state = getState();
    if (state.business.focus.pane !== 'result' || state.business.focus.nodeId !== nodeId) return;
    const newest = (agent.sessions || []).find((item) => item.piSessionId);
    if (newest) bus.send(BIZ.SESSION_LOAD, { agentId: node.agentId, sessionId: newest.piSessionId });
  }

  /* 产物列表：来自这个节点最近一次运行收集到的文件。
   * 没有运行过、或者重启后 runId 丢了，就只能是空列表。 */
  bus.handle(BIZ.ARTIFACTS_LOAD, async ({ id }) => {
    const node = getState().business.nodes.find((n) => n.id === id);
    if (!node || node.artifactsLoaded) return { ok: true, data: [] };

    let artifacts = [];
    if (node.runId) {
      try {
        const run = await api.getRun({ id: node.runId });
        artifacts = run.artifacts || [];
      } catch {
        artifacts = [];      // 运行记录被清理了就当作没有产物
      }
    }

    commit((s) => {
      const target = s.business.nodes.find((n) => n.id === id);
      if (target) {
        target.artifacts = artifacts;
        target.artifactsLoaded = true;
      }
    });
    return { ok: true, data: artifacts };
  });

  bus.handle(BIZ.EDGE_CREATE, async ({ from, to }) => {
    const state = getState();

    // 同方向唯一：1→2 只有一条；2→1 是另一条
    const dup = state.business.edges.some((e) => e.from === from && e.to === to);
    if (dup) return { ok: true, data: null };

    const src = state.business.nodes.find((n) => n.id === from);
    const dst = state.business.nodes.find((n) => n.id === to);
    if (!src || !dst) return { ok: false, error: t('节点不存在') };

    // 一个团队可以放好多次（画布上多个节点），但同一个团队自己的节点之间不连线
    if (src.agentId === dst.agentId) return { ok: false, error: t('同一个团队之间不能相互连接') };

    const team = state.business.teams.find((t) => t.id === src.agentId);
    if (!team) return { ok: false, error: t('起点节点不存在') };

    const edge = await api.createEdge({ from, to, color: hsl(team) });

    commit((s) => {
      // 已经有反向那条了 → 两条各弯向一侧，不叠在一起
      const reverse = s.business.edges.find((e) => e.from === to && e.to === from);
      if (reverse) { reverse.bow = -BOW; edge.bow = BOW; }
      s.business.edges.push(edge);
    });
    saveFlow();

    return { ok: true, data: edge };
  });

  /* 连线传哪些产物：产物属于"线"，不属于节点 ——
   * 上游可能有多条线，每条线带走的文件可以不同。 */
  bus.handle(BIZ.EDGE_FILES_SET, async ({ id, files }) => {
    const list = Array.isArray(files) ? files : [];
    await api.setEdgeFiles({ id, files: list });
    commit((s) => {
      const edge = s.business.edges.find((e) => e.id === id);
      if (edge) edge.files = list;
    });
    saveFlow();

    /* 连线确认 = 把文件交给下游，并立刻激活下游节点。
     * 下游没填任务 / 没工作区时由运行意图自己拦下并提示。 */
    const edge = getState().business.edges.find((e) => e.id === id);
    const target = edge && getState().business.nodes.find((n) => n.id === edge.to);
    if (target) await bus.send(BIZ.NODE_RUN_START, { id: target.id });

    return { ok: true };
  });
}
